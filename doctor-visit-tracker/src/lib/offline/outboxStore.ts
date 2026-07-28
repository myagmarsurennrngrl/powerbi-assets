/**
 * SQLite storage for the outbox.
 *
 * Deliberately thin. Every decision — ordering, retry, collapse, what counts
 * as permanent — lives in src/domain/outbox.ts, which is pure and unit-tested.
 * This file only reads and writes rows.
 */
import {
  applyFailure,
  applyManualRetry,
  applySuccess,
  canCollapseInto,
  type OutboxKind,
  type OutboxOperation,
} from '../../domain/outbox';
import { getDatabase } from './db';

interface Row {
  id: number;
  kind: string;
  client_uuid: string;
  dependency_key: string;
  payload: string;
  created_at: number;
  attempts: number;
  next_attempt_at: number;
  status: string;
  last_error: string | null;
}

function toOperation(row: Row): OutboxOperation {
  return {
    id: row.id,
    kind: row.kind as OutboxKind,
    clientUuid: row.client_uuid,
    dependencyKey: row.dependency_key,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    status: row.status as OutboxOperation['status'],
    lastError: row.last_error,
  };
}

/** Everything not yet accepted by the server, oldest first. */
export async function listOutbox(): Promise<OutboxOperation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Row>(
    "SELECT * FROM outbox WHERE status <> 'sent' ORDER BY id",
  );
  return rows.map(toOperation);
}

export async function getOperation(id: number): Promise<OutboxOperation | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Row>('SELECT * FROM outbox WHERE id = ?', [id]);
  return row ? toOperation(row) : null;
}

export interface EnqueueInput {
  kind: OutboxKind;
  clientUuid: string;
  dependencyKey: string;
  payload: unknown;
}

/**
 * Add an operation, collapsing it into the previous one where that is safe.
 *
 * Typing a visit report produces a save every few seconds; without collapsing,
 * an afternoon offline becomes hundreds of queued writes that all overwrite
 * each other on sync. Only whole-value writes collapse — never a completion,
 * an addendum or an exception request.
 */
export async function enqueue(input: EnqueueInput): Promise<number> {
  const db = await getDatabase();

  const previousRow = await db.getFirstAsync<Row>(
    `SELECT * FROM outbox
     WHERE dependency_key = ? AND kind = ? AND status <> 'sent'
     ORDER BY id DESC LIMIT 1`,
    [input.dependencyKey, input.kind],
  );
  const previous = previousRow ? toOperation(previousRow) : null;

  if (canCollapseInto(previous, input.kind, input.dependencyKey)) {
    await db.runAsync(
      `UPDATE outbox
       SET payload = ?, created_at = ?, attempts = 0, next_attempt_at = 0, last_error = NULL
       WHERE id = ?`,
      [JSON.stringify(input.payload), Date.now(), previous!.id],
    );
    return previous!.id;
  }

  const result = await db.runAsync(
    `INSERT INTO outbox
       (kind, client_uuid, dependency_key, payload, created_at, attempts, next_attempt_at, status)
     VALUES (?, ?, ?, ?, ?, 0, 0, 'pending')`,
    [
      input.kind,
      input.clientUuid,
      input.dependencyKey,
      JSON.stringify(input.payload),
      Date.now(),
    ],
  );
  return result.lastInsertRowId;
}

async function writeOutcome(
  id: number,
  outcome: { status: string; attempts: number; nextAttemptAt: number; lastError: string | null },
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE outbox SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?',
    [outcome.status, outcome.attempts, outcome.nextAttemptAt, outcome.lastError, id],
  );
}

export async function markSending(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("UPDATE outbox SET status = 'sending' WHERE id = ?", [id]);
}

export async function markSucceeded(op: OutboxOperation): Promise<void> {
  await writeOutcome(op.id, applySuccess(op));
}

export async function markFailed(op: OutboxOperation, message: string): Promise<void> {
  await writeOutcome(op.id, applyFailure(op, message, Date.now()));
}

export async function retryNow(op: OutboxOperation): Promise<void> {
  await writeOutcome(op.id, applyManualRetry(op));
}

/**
 * Discard a blocked operation the person has decided to abandon.
 *
 * Only a blocked one: deleting something still in flight would leave the
 * server holding a change the app no longer knows about.
 */
export async function discard(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM outbox WHERE id = ? AND status = 'blocked'", [id]);
}

/**
 * Anything left as 'sending' when the app was killed mid-request is returned
 * to 'pending' at startup. The server call is idempotent on client_uuid, so
 * resending one that did in fact arrive is a no-op rather than a duplicate.
 */
export async function recoverInterrupted(): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    "UPDATE outbox SET status = 'pending' WHERE status = 'sending'",
  );
  return result.changes;
}

/** Housekeeping: forget what was accepted more than a week ago. */
export async function pruneSent(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM outbox WHERE status = 'sent' AND created_at < ?", [
    Date.now() - olderThanMs,
  ]);
}

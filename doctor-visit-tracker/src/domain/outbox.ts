/**
 * The outbox queue — pure decision logic.
 *
 * This file contains NO React, no SQLite and no network. Everything here is a
 * plain function over plain data, so the rules that decide *what gets sent, in
 * what order, and what happens when it fails* are unit-tested rather than
 * hoped about. The SQLite storage and the actual HTTP calls live in
 * src/lib/offline/, which is deliberately thin.
 *
 * THE FOUR RULES THIS FILE ENCODES
 * --------------------------------
 * 1. **Order matters within a visit, not between visits.** A completion must
 *    never be sent before the draft it completes. Two different visits have no
 *    relationship, so one being stuck must not hold the other up.
 *
 * 2. **A blocked operation blocks its own dependency group and nothing else.**
 *    If a draft save is permanently rejected, sending the completion after it
 *    would submit a half-written report. Everything for that visit stops and
 *    the person is told. Other visits keep flowing.
 *
 * 3. **Business refusals are permanent; network failures are not.** "You are
 *    240 m from the clinic" will say the same thing on the hundredth attempt.
 *    "Network request failed" will not. Retrying the first forever would hide
 *    a real problem behind a spinner; giving up on the second would lose work.
 *
 * 4. **Repeated edits to the same thing collapse.** Typing a report generates
 *    a save every few seconds. Only the last one matters, so the queue keeps
 *    the last one. A collapse is only ever allowed for whole-value writes —
 *    never for anything that appends or has a side effect.
 */

/** What the queued operation asks the server to do. */
export type OutboxKind =
  | 'visit_draft_save'    // whole-value update of the report fields
  | 'visit_doctors'       // whole-value replace of the doctor list
  | 'visit_brands'        // whole-value replace of the brand list
  | 'visit_products'      // whole-value replace of the product list
  | 'visit_complete'      // submit the report
  | 'addendum_add'        // append a correction
  | 'exception_request';  // ask a manager for an exception

export type OutboxStatus =
  | 'pending'   // waiting to be sent
  | 'sending'   // in flight right now
  | 'sent'      // accepted by the server
  | 'blocked';  // permanently refused; needs a person

export interface OutboxOperation {
  /** Local row id. Monotonic, so it also expresses insertion order. */
  id: number;
  kind: OutboxKind;
  /**
   * Sent to the server so that a replayed request is recognised as the same
   * request. Every write path this queue uses is idempotent on it.
   */
  clientUuid: string;
  /**
   * What this operation belongs to — a visit id, usually. Operations sharing a
   * key are strictly ordered; operations with different keys are independent.
   */
  dependencyKey: string;
  /** JSON arguments for the call. Opaque here on purpose. */
  payload: unknown;
  createdAt: number;
  attempts: number;
  /** Epoch ms before which this must not be retried. 0 = due now. */
  nextAttemptAt: number;
  status: OutboxStatus;
  /** The last message from the server, shown on the sync screen. */
  lastError: string | null;
}

/**
 * Whole-value writes. Sending an older one after a newer one would undo the
 * newer one, and sending both wastes a round trip, so consecutive operations
 * of these kinds for the same visit collapse to the last.
 *
 * `visit_complete`, `addendum_add` and `exception_request` are deliberately
 * absent: completing twice is not the same as completing once, and an addendum
 * is an append. Those must never be collapsed away.
 */
const COLLAPSIBLE: ReadonlySet<OutboxKind> = new Set<OutboxKind>([
  'visit_draft_save',
  'visit_doctors',
  'visit_brands',
  'visit_products',
]);

export function isCollapsible(kind: OutboxKind): boolean {
  return COLLAPSIBLE.has(kind);
}

// -----------------------------------------------------------------------------
// Failure classification
// -----------------------------------------------------------------------------

export type FailureClass = 'retry' | 'permanent';

/**
 * Was this failure worth trying again?
 *
 * Deliberately conservative: anything not recognised as a business refusal is
 * treated as retryable. Wrongly retrying wastes a request; wrongly giving up
 * loses a representative's work.
 */
export function classifyFailure(message: string | null | undefined): FailureClass {
  if (!message) return 'retry';
  const text = message.toLowerCase();

  // Transport problems. These are the whole reason the queue exists.
  if (
    /network|fetch failed|timeout|timed out|econn|socket|offline|unreachable|dns/.test(text) ||
    /\b(408|425|429|500|502|503|504)\b/.test(text)
  ) {
    return 'retry';
  }

  // A rejected or expired session is retryable: the app refreshes the token and
  // the next attempt carries a valid one.
  if (/jwt expired|token is expired|refresh_token/.test(text)) return 'retry';

  // Business refusals from the database. These are the same every time.
  if (
    /permission denied|row-level security|insufficient|not found|no_data_found/.test(text) ||
    /violates|constraint|duplicate key|check_violation|invalid input/.test(text) ||
    /\b(400|401|403|404|409|422)\b/.test(text)
  ) {
    return 'permanent';
  }

  // Every rule in this project raises its refusal in Mongolian. A Cyrillic
  // message is therefore a deliberate business rule, not a transport failure.
  if (/[Ѐ-ӿ]/.test(message)) return 'permanent';

  return 'retry';
}

/**
 * Some refusals mean "already done", which is success from the queue's point
 * of view. A replayed completion is the obvious case: the server refuses the
 * second one, and treating that as a failure would strand a visit that is in
 * fact submitted.
 */
export function isAlreadyApplied(message: string | null | undefined): boolean {
  if (!message) return false;
  return /аль хэдийн|already (completed|submitted|exists|applied)|duplicate key/i.test(message);
}

// -----------------------------------------------------------------------------
// Retry schedule
// -----------------------------------------------------------------------------

/** Backoff in seconds by attempt number: 5s, 15s, 1m, 5m, 15m, then 30m. */
const BACKOFF_SECONDS = [5, 15, 60, 300, 900];
const MAX_BACKOFF_SECONDS = 1800;

/**
 * After this many failed attempts an operation stops retrying by itself and
 * waits for a person. A queue that retries a broken request forever looks
 * exactly like a queue that is working.
 */
export const MAX_ATTEMPTS = 8;

export function backoffMs(attempts: number): number {
  const index = Math.max(0, attempts - 1);
  const seconds = index < BACKOFF_SECONDS.length
    ? BACKOFF_SECONDS[index]!
    : MAX_BACKOFF_SECONDS;
  return seconds * 1000;
}

export function nextAttemptAt(attempts: number, now: number): number {
  return now + backoffMs(attempts);
}

export function isDue(op: OutboxOperation, now: number): boolean {
  return op.status === 'pending' && op.nextAttemptAt <= now;
}

// -----------------------------------------------------------------------------
// What to send next
// -----------------------------------------------------------------------------

/**
 * Choose the operations to attempt now.
 *
 * At most one per dependency key, because operations for the same visit are
 * strictly ordered. A key whose oldest unsent operation is blocked, still
 * sending, or not yet due contributes nothing this round — its later
 * operations wait rather than overtaking.
 */
export function selectNextBatch(
  operations: readonly OutboxOperation[],
  now: number,
  limit = 10,
): OutboxOperation[] {
  const oldestByKey = new Map<string, OutboxOperation>();

  for (const op of operations) {
    if (op.status === 'sent') continue;
    const current = oldestByKey.get(op.dependencyKey);
    if (!current || op.id < current.id) {
      oldestByKey.set(op.dependencyKey, op);
    }
  }

  return [...oldestByKey.values()]
    .filter((op) => isDue(op, now))
    .sort((a, b) => a.id - b.id)
    .slice(0, limit);
}

/**
 * Is this visit safe to open for editing, or would editing it race a queued
 * write? Used by the report screen to explain, rather than to silently
 * overwrite what is still in the queue.
 */
export function hasPendingWork(
  operations: readonly OutboxOperation[],
  dependencyKey: string,
): boolean {
  return operations.some(
    (op) => op.dependencyKey === dependencyKey && op.status !== 'sent',
  );
}

/** Operations a person has to look at, because nothing will fix them alone. */
export function blockedOperations(
  operations: readonly OutboxOperation[],
): OutboxOperation[] {
  return operations.filter((op) => op.status === 'blocked');
}

// -----------------------------------------------------------------------------
// Applying an outcome
// -----------------------------------------------------------------------------

export interface AttemptOutcome {
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
}

/**
 * The single place that decides what a failed attempt means. Keeping this as
 * one pure function is what makes "does a 403 retry forever?" a question with
 * a tested answer rather than an opinion.
 */
export function applyFailure(
  op: OutboxOperation,
  message: string,
  now: number,
): AttemptOutcome {
  const attempts = op.attempts + 1;

  if (isAlreadyApplied(message)) {
    // The server has it. Anything else would strand finished work.
    return { status: 'sent', attempts, nextAttemptAt: 0, lastError: null };
  }

  if (classifyFailure(message) === 'permanent' || attempts >= MAX_ATTEMPTS) {
    return { status: 'blocked', attempts, nextAttemptAt: 0, lastError: message };
  }

  return {
    status: 'pending',
    attempts,
    nextAttemptAt: nextAttemptAt(attempts, now),
    lastError: message,
  };
}

export function applySuccess(op: OutboxOperation): AttemptOutcome {
  return { status: 'sent', attempts: op.attempts + 1, nextAttemptAt: 0, lastError: null };
}

/**
 * Retry a blocked operation because a person asked. Clears the backoff so it
 * goes out immediately — they are usually pressing the button because they
 * just fixed whatever was wrong.
 */
export function applyManualRetry(op: OutboxOperation): AttemptOutcome {
  return { status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: op.lastError };
}

// -----------------------------------------------------------------------------
// Summary for the sync screen
// -----------------------------------------------------------------------------

export interface OutboxSummary {
  pending: number;
  blocked: number;
  sending: number;
  total: number;
  oldestPendingAt: number | null;
}

export function summarise(operations: readonly OutboxOperation[]): OutboxSummary {
  let pending = 0;
  let blocked = 0;
  let sending = 0;
  let oldestPendingAt: number | null = null;

  for (const op of operations) {
    if (op.status === 'sent') continue;
    if (op.status === 'blocked') blocked += 1;
    else if (op.status === 'sending') sending += 1;
    else {
      pending += 1;
      if (oldestPendingAt === null || op.createdAt < oldestPendingAt) {
        oldestPendingAt = op.createdAt;
      }
    }
  }

  return { pending, blocked, sending, total: pending + blocked + sending, oldestPendingAt };
}

/**
 * Should the newly queued operation replace the previous one instead of being
 * added after it?
 *
 * Only when both are the same collapsible kind for the same thing AND the
 * previous one has not started going out. Replacing something already in
 * flight would leave the server with a value the queue thinks it discarded.
 */
export function canCollapseInto(
  previous: OutboxOperation | null,
  kind: OutboxKind,
  dependencyKey: string,
): boolean {
  if (!previous) return false;
  return (
    isCollapsible(kind) &&
    previous.kind === kind &&
    previous.dependencyKey === dependencyKey &&
    previous.status === 'pending'
  );
}

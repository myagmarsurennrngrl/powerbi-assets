/**
 * Sending the outbox.
 *
 * The dispatch table below is the one place that turns a queued operation back
 * into a server call. Each target is idempotent on the operation's
 * `client_uuid`, or is a whole-value write where sending it twice changes
 * nothing — which is what makes "resend anything we are unsure about" safe.
 *
 * The ORDER and the RETRY decisions are not made here. They come from
 * src/domain/outbox.ts, which is pure and tested. This file walks the batch it
 * is given and records what happened.
 */
import * as Network from 'expo-network';
import { selectNextBatch, type OutboxOperation } from '../../domain/outbox';
import {
  addAddendum,
  saveVisitDraft,
  setVisitBrands,
  setVisitDoctors,
  setVisitProducts,
  submitVisitReport,
} from '../../data/completion';
import { requestException } from '../../data/kpi';
import type { Result } from '../../data/types';
import {
  listOutbox,
  markFailed,
  markSending,
  markSucceeded,
  pruneSent,
  recoverInterrupted,
} from './outboxStore';

export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    // `isInternetReachable` is undefined on some Android builds; treat an
    // unknown answer as "connected" and let the request itself decide. A false
    // negative here would park work in the queue for no reason.
    return Boolean(state.isConnected) && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

/**
 * Turn one queued operation back into the call it stood for.
 *
 * Payload shapes are defined where the operation is enqueued (src/data/offline
 * wrappers). They are `any` here because the queue stores JSON; the alternative
 * is a discriminated union duplicated in three places, which drifts.
 */
async function dispatch(op: OutboxOperation): Promise<Result<unknown>> {
  const payload = op.payload as any;

  switch (op.kind) {
    case 'visit_draft_save':
      return saveVisitDraft(payload.visitId, payload.fields);

    case 'visit_doctors':
      return setVisitDoctors(payload.visitId, payload.doctorIds);

    case 'visit_brands':
      return setVisitBrands(payload.visitId, payload.brandIds);

    case 'visit_products':
      return setVisitProducts(payload.visitId, payload.productIds);

    case 'visit_complete':
      return submitVisitReport(payload.visitId);

    case 'addendum_add':
      return addAddendum(payload.visitId, payload.correctionText, payload.reason);

    case 'exception_request':
      return requestException(payload.input);

    default: {
      // An operation queued by a newer version of the app than the one now
      // running. Blocking it is right: guessing what it meant is not.
      const unknownKind: string = op.kind;
      return { data: null, error: `Unknown queued operation: ${unknownKind}` };
    }
  }
}

export interface SyncReport {
  attempted: number;
  succeeded: number;
  failed: number;
  /** True when nothing was tried because the device has no connection. */
  skippedOffline: boolean;
}

let running = false;

/**
 * Send whatever is due.
 *
 * Guarded against re-entry: the app triggers this from several places (app
 * start, regaining connectivity, the sync screen, pull-to-refresh) and two
 * overlapping runs would send the same operation twice. Idempotency would make
 * that survivable, but not sending it twice is better than surviving it.
 */
export async function runSync(options: { force?: boolean } = {}): Promise<SyncReport> {
  const empty: SyncReport = { attempted: 0, succeeded: 0, failed: 0, skippedOffline: false };
  if (running) return empty;

  running = true;
  try {
    if (!options.force && !(await isOnline())) {
      return { ...empty, skippedOffline: true };
    }

    await recoverInterrupted();

    const batch = selectNextBatch(await listOutbox(), Date.now());
    if (batch.length === 0) {
      await pruneSent();
      return empty;
    }

    let succeeded = 0;
    let failed = 0;

    // Sequential on purpose. Operations for one visit are ordered, and sending
    // several at once to a phone's connection is not faster in any case.
    for (const op of batch) {
      await markSending(op.id);
      try {
        const result = await dispatch(op);
        if (result.error) {
          await markFailed(op, result.error);
          failed += 1;
        } else {
          await markSucceeded(op);
          succeeded += 1;
        }
      } catch (error) {
        await markFailed(op, error instanceof Error ? error.message : 'unknown error');
        failed += 1;
      }
    }

    await pruneSent();
    return { attempted: batch.length, succeeded, failed, skippedOffline: false };
  } finally {
    running = false;
  }
}

/**
 * Keep sending while progress is being made.
 *
 * One pass sends at most one operation per visit, so a visit with a draft, a
 * doctor list and a completion needs three passes. Looping until a pass
 * achieves nothing finishes the queue in one go when the connection allows,
 * and stops immediately when it does not.
 */
export async function drainSync(maxPasses = 8): Promise<SyncReport> {
  const total: SyncReport = { attempted: 0, succeeded: 0, failed: 0, skippedOffline: false };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const report = await runSync();
    total.attempted += report.attempted;
    total.succeeded += report.succeeded;
    total.failed += report.failed;

    if (report.skippedOffline) {
      total.skippedOffline = true;
      break;
    }
    // No progress means everything left is blocked, in backoff, or done.
    if (report.succeeded === 0) break;
  }

  return total;
}

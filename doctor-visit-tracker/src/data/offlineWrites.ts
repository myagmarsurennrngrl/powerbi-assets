/**
 * Writes that survive losing signal.
 *
 * Each function here tries the server first and queues on failure. The screen
 * calling it gets back whether the change is `synced` or `queued`, and says so
 * — a report that silently sits in a queue looks exactly like one that was
 * submitted, and that difference matters to the person whose KPI it is.
 *
 * WHAT IS DELIBERATELY NOT HERE: check-in and check-out.
 * -----------------------------------------------------
 * Those two are the evidence that somebody was at a clinic at a time. Their
 * value comes entirely from the SERVER computing the distance and stamping the
 * clock. A check-in queued on a phone and sent three hours later has neither —
 * the only timestamp would be the device's, which this project explicitly does
 * not trust, and the server would be recording a presence it cannot vouch for.
 *
 * So check-in and check-out require a connection, and the screens say so
 * plainly rather than pretending. Everything that is a *statement by the
 * representative* — the report, corrections, exception requests — queues
 * happily, because a statement is just as true an hour later.
 *
 * This is recorded as an accepted limitation in docs/95-known-limitations.md
 * with the trade-off spelled out, so it is a decision management can revisit
 * rather than a gap nobody noticed.
 */
import * as Crypto from 'expo-crypto';
import { enqueue } from '../lib/offline/outboxStore';
import { isOnline } from '../lib/offline/sync';
import { classifyFailure } from '../domain/outbox';
import {
  addAddendum,
  saveVisitDraft,
  setVisitBrands,
  setVisitDoctors,
  setVisitProducts,
  submitVisitReport,
  type VisitReport,
} from './completion';
import { requestException, type RequestExceptionInput } from './kpi';
import type { Result } from './types';

export type WriteState = 'synced' | 'queued';

export interface OfflineResult<T = unknown> {
  state: WriteState | null;
  data: T | null;
  /** Set only when the write both failed AND could not be queued. */
  error: string | null;
}

/**
 * The shared shape: attempt, and queue only what is worth queueing.
 *
 * A business refusal is NOT queued. "You must write a comment" will be refused
 * identically in an hour, so putting it in the queue would turn a message the
 * person can act on into a silent failure they discover days later.
 */
async function attemptThenQueue<T>(
  online: () => Promise<Result<T>>,
  queued: () => Promise<void>,
): Promise<OfflineResult<T>> {
  if (await isOnline()) {
    let result: Result<T>;
    try {
      result = await online();
    } catch (error) {
      result = { data: null, error: error instanceof Error ? error.message : 'network' };
    }

    if (!result.error) return { state: 'synced', data: result.data, error: null };

    if (classifyFailure(result.error) === 'permanent') {
      // Tell them now. This is the case the queue must not swallow.
      return { state: null, data: null, error: result.error };
    }
  }

  try {
    await queued();
    return { state: 'queued', data: null, error: null };
  } catch (error) {
    return {
      state: null,
      data: null,
      error: error instanceof Error ? error.message : 'queue write failed',
    };
  }
}

// -----------------------------------------------------------------------------
// Visit report
// -----------------------------------------------------------------------------

type DraftFields = Parameters<typeof saveVisitDraft>[1];

export async function saveDraftOffline(
  visitId: string,
  fields: DraftFields,
): Promise<OfflineResult<true>> {
  return attemptThenQueue(
    () => saveVisitDraft(visitId, fields),
    () =>
      enqueue({
        kind: 'visit_draft_save',
        clientUuid: Crypto.randomUUID(),
        dependencyKey: visitId,
        payload: { visitId, fields },
      }).then(() => undefined),
  );
}

export async function setDoctorsOffline(
  visitId: string,
  doctorIds: string[],
): Promise<OfflineResult<true>> {
  return attemptThenQueue(
    () => setVisitDoctors(visitId, doctorIds),
    () =>
      enqueue({
        kind: 'visit_doctors',
        clientUuid: Crypto.randomUUID(),
        dependencyKey: visitId,
        payload: { visitId, doctorIds },
      }).then(() => undefined),
  );
}

export async function setBrandsOffline(
  visitId: string,
  brandIds: string[],
): Promise<OfflineResult<true>> {
  return attemptThenQueue(
    () => setVisitBrands(visitId, brandIds),
    () =>
      enqueue({
        kind: 'visit_brands',
        clientUuid: Crypto.randomUUID(),
        dependencyKey: visitId,
        payload: { visitId, brandIds },
      }).then(() => undefined),
  );
}

export async function setProductsOffline(
  visitId: string,
  productIds: string[],
): Promise<OfflineResult<true>> {
  return attemptThenQueue(
    () => setVisitProducts(visitId, productIds),
    () =>
      enqueue({
        kind: 'visit_products',
        clientUuid: Crypto.randomUUID(),
        dependencyKey: visitId,
        payload: { visitId, productIds },
      }).then(() => undefined),
  );
}

/**
 * Submit the report.
 *
 * Note that the completeness rules are checked by the SERVER
 * (`fn_visit_completion_issues`). Offline, the form's own copy of those rules
 * decides whether submission is even offered — and the server re-checks on
 * sync. If the server then refuses, the operation is blocked and shown on the
 * sync screen with the reason, rather than being retried forever.
 */
export async function submitReportOffline(
  visitId: string,
): Promise<OfflineResult<VisitReport>> {
  return attemptThenQueue(
    () => submitVisitReport(visitId),
    () =>
      enqueue({
        kind: 'visit_complete',
        clientUuid: Crypto.randomUUID(),
        dependencyKey: visitId,
        payload: { visitId },
      }).then(() => undefined),
  );
}

export async function addAddendumOffline(
  visitId: string,
  correctionText: string,
  reason: string,
): Promise<OfflineResult<unknown>> {
  return attemptThenQueue(
    () => addAddendum(visitId, correctionText, reason),
    () =>
      enqueue({
        kind: 'addendum_add',
        clientUuid: Crypto.randomUUID(),
        dependencyKey: visitId,
        payload: { visitId, correctionText, reason },
      }).then(() => undefined),
  );
}

// -----------------------------------------------------------------------------
// Exception requests
// -----------------------------------------------------------------------------

/**
 * Queued under the planned visit, not the visit, because an exception is
 * usually requested for a stop that never became a visit at all.
 */
export async function requestExceptionOffline(
  input: RequestExceptionInput,
): Promise<OfflineResult<unknown>> {
  return attemptThenQueue(
    () => requestException(input),
    () =>
      enqueue({
        kind: 'exception_request',
        clientUuid: input.clientUuid,
        dependencyKey: `planned:${input.plannedVisitId}`,
        payload: { input },
      }).then(() => undefined),
  );
}

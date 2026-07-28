/**
 * The outbox queue rules.
 *
 * These matter more than they look. Every one of them is a way a
 * representative's afternoon of work could silently disappear, or a half-written
 * report could be submitted to a manager as finished.
 */
import { describe, expect, it } from 'vitest';
import {
  applyFailure,
  applyManualRetry,
  applySuccess,
  backoffMs,
  blockedOperations,
  canCollapseInto,
  classifyFailure,
  hasPendingWork,
  isAlreadyApplied,
  isCollapsible,
  isDue,
  MAX_ATTEMPTS,
  selectNextBatch,
  summarise,
  type OutboxKind,
  type OutboxOperation,
  type OutboxStatus,
} from '../../src/domain/outbox';

const NOW = 1_800_000_000_000;

function op(overrides: Partial<OutboxOperation> = {}): OutboxOperation {
  return {
    id: 1,
    kind: 'visit_draft_save',
    clientUuid: '11111111-1111-1111-1111-111111111111',
    dependencyKey: 'visit-a',
    payload: {},
    createdAt: NOW - 1000,
    attempts: 0,
    nextAttemptAt: 0,
    status: 'pending',
    lastError: null,
    ...overrides,
  };
}

describe('classifying a failure', () => {
  const retryable = [
    'Network request failed',
    'fetch failed',
    'TypeError: Failed to fetch',
    'connect ECONNREFUSED 10.0.0.1:443',
    'The request timed out',
    'upstream connect error 503',
    'Too many requests (429)',
    'JWT expired',
  ];

  it.each(retryable)('retries: %s', (message) => {
    expect(classifyFailure(message)).toBe('retry');
  });

  const permanent = [
    'permission denied for table visit',
    'new row violates row-level security policy',
    'duplicate key value violates unique constraint',
    'null value in column "objective" violates not-null constraint',
    'Уулзалт олдсонгүй.',
    'Та эмнэлгээс 240 м зайд байна. Зөвшөөрөгдөх зай 150 м.',
  ];

  it.each(permanent)('gives up on: %s', (message) => {
    expect(classifyFailure(message)).toBe('permanent');
  });

  it('retries an unrecognised message rather than losing the work', () => {
    // Wrongly retrying costs a request. Wrongly giving up costs a visit report.
    expect(classifyFailure('something nobody anticipated')).toBe('retry');
    expect(classifyFailure('')).toBe('retry');
    expect(classifyFailure(null)).toBe('retry');
  });

  it('treats any Mongolian message as a deliberate business rule', () => {
    // Every RAISE EXCEPTION a representative can trigger is written in
    // Mongolian, so Cyrillic text is a rule, not a network problem.
    expect(classifyFailure('Тайлбараа бичнэ үү.')).toBe('permanent');
  });
});

describe('already applied', () => {
  it('recognises a replayed completion as success', () => {
    expect(isAlreadyApplied('Энэ уулзалт аль хэдийн дууссан байна.')).toBe(true);
    expect(isAlreadyApplied('already completed')).toBe(true);
  });

  it('does not treat an ordinary refusal as success', () => {
    expect(isAlreadyApplied('Тайлбараа бичнэ үү.')).toBe(false);
  });

  it('a replayed operation is marked sent, not failed', () => {
    const outcome = applyFailure(op({ kind: 'visit_complete' }), 'already completed', NOW);
    expect(outcome.status).toBe('sent');
    expect(outcome.lastError).toBeNull();
  });
});

describe('backoff', () => {
  it('grows and then flattens', () => {
    const schedule = [1, 2, 3, 4, 5, 6, 7].map((attempt) => backoffMs(attempt) / 1000);
    expect(schedule).toEqual([5, 15, 60, 300, 900, 1800, 1800]);
  });

  it('never returns zero, so a failing operation cannot spin', () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(backoffMs(attempt)).toBeGreaterThan(0);
    }
  });

  it('a retryable failure schedules the next attempt in the future', () => {
    const outcome = applyFailure(op(), 'Network request failed', NOW);
    expect(outcome.status).toBe('pending');
    expect(outcome.nextAttemptAt).toBeGreaterThan(NOW);
  });

  it('gives up after MAX_ATTEMPTS even on a retryable error', () => {
    // Otherwise a permanently broken request looks identical to a working queue.
    const outcome = applyFailure(
      op({ attempts: MAX_ATTEMPTS - 1 }),
      'Network request failed',
      NOW,
    );
    expect(outcome.status).toBe('blocked');
    expect(outcome.lastError).toBe('Network request failed');
  });

  it('blocks immediately on a business refusal, without burning attempts', () => {
    const outcome = applyFailure(op(), 'Уулзалт олдсонгүй.', NOW);
    expect(outcome.status).toBe('blocked');
    expect(outcome.attempts).toBe(1);
  });
});

describe('choosing what to send', () => {
  it('sends the oldest operation for each visit, and only that one', () => {
    const batch = selectNextBatch(
      [
        op({ id: 1, dependencyKey: 'visit-a' }),
        op({ id: 2, dependencyKey: 'visit-a', kind: 'visit_complete' }),
        op({ id: 3, dependencyKey: 'visit-b' }),
      ],
      NOW,
    );
    expect(batch.map((o) => o.id)).toEqual([1, 3]);
  });

  it('NEVER sends a completion before the draft it completes', () => {
    // The whole point of the dependency key. If this ever regresses, managers
    // start receiving half-written reports marked as finished.
    const operations = [
      op({ id: 10, dependencyKey: 'visit-a', kind: 'visit_draft_save' }),
      op({ id: 11, dependencyKey: 'visit-a', kind: 'visit_complete' }),
    ];
    expect(selectNextBatch(operations, NOW).map((o) => o.id)).toEqual([10]);
  });

  it('a blocked operation stops its own visit', () => {
    const operations = [
      op({ id: 10, dependencyKey: 'visit-a', status: 'blocked' }),
      op({ id: 11, dependencyKey: 'visit-a', kind: 'visit_complete' }),
    ];
    expect(selectNextBatch(operations, NOW)).toHaveLength(0);
  });

  it('a blocked visit does NOT stop a different visit', () => {
    const operations = [
      op({ id: 10, dependencyKey: 'visit-a', status: 'blocked' }),
      op({ id: 11, dependencyKey: 'visit-b' }),
    ];
    expect(selectNextBatch(operations, NOW).map((o) => o.id)).toEqual([11]);
  });

  it('an operation already in flight is not sent twice', () => {
    const operations = [op({ id: 10, status: 'sending' }), op({ id: 11 })];
    expect(selectNextBatch(operations, NOW)).toHaveLength(0);
  });

  it('skips operations still inside their backoff window', () => {
    const operations = [op({ id: 10, nextAttemptAt: NOW + 60_000 })];
    expect(selectNextBatch(operations, NOW)).toHaveLength(0);
    expect(selectNextBatch(operations, NOW + 61_000).map((o) => o.id)).toEqual([10]);
  });

  it('ignores operations already sent', () => {
    const operations = [
      op({ id: 10, dependencyKey: 'visit-a', status: 'sent' }),
      op({ id: 11, dependencyKey: 'visit-a', kind: 'visit_complete' }),
    ];
    expect(selectNextBatch(operations, NOW).map((o) => o.id)).toEqual([11]);
  });

  it('respects the batch limit', () => {
    const operations = Array.from({ length: 25 }, (_, i) =>
      op({ id: i + 1, dependencyKey: `visit-${i}` }),
    );
    expect(selectNextBatch(operations, NOW, 5)).toHaveLength(5);
  });

  it('returns them oldest first', () => {
    const operations = [
      op({ id: 30, dependencyKey: 'c' }),
      op({ id: 10, dependencyKey: 'a' }),
      op({ id: 20, dependencyKey: 'b' }),
    ];
    expect(selectNextBatch(operations, NOW).map((o) => o.id)).toEqual([10, 20, 30]);
  });
});

describe('collapsing repeated edits', () => {
  it('collapses whole-value writes', () => {
    const kinds: OutboxKind[] = [
      'visit_draft_save',
      'visit_doctors',
      'visit_brands',
      'visit_products',
    ];
    for (const kind of kinds) {
      expect(isCollapsible(kind)).toBe(true);
      expect(canCollapseInto(op({ kind }), kind, 'visit-a')).toBe(true);
    }
  });

  it('NEVER collapses a completion, an addendum or an exception request', () => {
    // Completing twice is not completing once, and an addendum is an append.
    const kinds: OutboxKind[] = ['visit_complete', 'addendum_add', 'exception_request'];
    for (const kind of kinds) {
      expect(isCollapsible(kind)).toBe(false);
      expect(canCollapseInto(op({ kind }), kind, 'visit-a')).toBe(false);
    }
  });

  it('does not collapse across different visits', () => {
    expect(canCollapseInto(op({ dependencyKey: 'visit-a' }), 'visit_draft_save', 'visit-b'))
      .toBe(false);
  });

  it('does not collapse across different kinds', () => {
    expect(canCollapseInto(op({ kind: 'visit_doctors' }), 'visit_brands', 'visit-a')).toBe(false);
  });

  it('does not collapse into something already going out', () => {
    // The server would end up holding a value the queue believes it discarded.
    const statuses: OutboxStatus[] = ['sending', 'sent', 'blocked'];
    for (const status of statuses) {
      expect(canCollapseInto(op({ status }), 'visit_draft_save', 'visit-a')).toBe(false);
    }
  });

  it('does not collapse when there is nothing to collapse into', () => {
    expect(canCollapseInto(null, 'visit_draft_save', 'visit-a')).toBe(false);
  });
});

describe('outcomes', () => {
  it('success clears the error and counts the attempt', () => {
    const outcome = applySuccess(op({ attempts: 2, lastError: 'earlier failure' }));
    expect(outcome).toEqual({ status: 'sent', attempts: 3, nextAttemptAt: 0, lastError: null });
  });

  it('a manual retry sends immediately and resets the attempt count', () => {
    // The person is pressing the button because they just fixed something.
    const outcome = applyManualRetry(op({ status: 'blocked', attempts: 8, lastError: 'x' }));
    expect(outcome.status).toBe('pending');
    expect(outcome.attempts).toBe(0);
    expect(outcome.nextAttemptAt).toBe(0);
  });

  it('a manual retry keeps the last error visible until it succeeds', () => {
    expect(applyManualRetry(op({ lastError: 'boom' })).lastError).toBe('boom');
  });
});

describe('what the sync screen shows', () => {
  it('counts each state and finds the oldest waiting item', () => {
    const summary = summarise([
      op({ id: 1, status: 'pending', createdAt: NOW - 5000 }),
      op({ id: 2, status: 'pending', createdAt: NOW - 9000 }),
      op({ id: 3, status: 'sending' }),
      op({ id: 4, status: 'blocked' }),
      op({ id: 5, status: 'sent' }),
    ]);
    expect(summary).toEqual({
      pending: 2,
      blocked: 1,
      sending: 1,
      total: 4,
      oldestPendingAt: NOW - 9000,
    });
  });

  it('an empty queue is all zeroes, not nulls to guard against', () => {
    expect(summarise([])).toEqual({
      pending: 0, blocked: 0, sending: 0, total: 0, oldestPendingAt: null,
    });
  });

  it('lists exactly the operations needing a person', () => {
    const blocked = blockedOperations([
      op({ id: 1, status: 'pending' }),
      op({ id: 2, status: 'blocked' }),
      op({ id: 3, status: 'blocked' }),
    ]);
    expect(blocked.map((o) => o.id)).toEqual([2, 3]);
  });
});

describe('guarding an open form', () => {
  it('reports unsent work for a visit', () => {
    const operations = [op({ dependencyKey: 'visit-a', status: 'pending' })];
    expect(hasPendingWork(operations, 'visit-a')).toBe(true);
    expect(hasPendingWork(operations, 'visit-b')).toBe(false);
  });

  it('fully synced work is not pending', () => {
    expect(hasPendingWork([op({ dependencyKey: 'visit-a', status: 'sent' })], 'visit-a'))
      .toBe(false);
  });
});

describe('isDue', () => {
  it('is true only for pending operations past their backoff', () => {
    expect(isDue(op({ status: 'pending', nextAttemptAt: 0 }), NOW)).toBe(true);
    expect(isDue(op({ status: 'pending', nextAttemptAt: NOW + 1 }), NOW)).toBe(false);
    expect(isDue(op({ status: 'blocked', nextAttemptAt: 0 }), NOW)).toBe(false);
    expect(isDue(op({ status: 'sending', nextAttemptAt: 0 }), NOW)).toBe(false);
  });
});

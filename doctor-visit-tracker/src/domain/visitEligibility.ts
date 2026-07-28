/**
 * The eight conditions that must hold before a visit may start.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * This file is a MIRROR of public.fn_visit_start_eligibility(). Its only job
 * is to let the app disable a button and explain why, immediately, without a
 * round trip — which matters when a representative is standing in a corridor
 * on a weak connection.
 *
 * It is NOT a security control. The server re-evaluates every condition from
 * scratch inside fn_start_visit(), using the server clock and a server-computed
 * distance, and rejects anything that fails. If the two ever disagree, the
 * server wins and this file is the one that is wrong.
 *
 * tests/domain/visitEligibility.test.ts asserts that both implementations
 * agree, case for case, against a real database.
 */
import { haversineMetres, isValidCoordinate, type Coordinates } from './geo';

export type BlockingReason =
  | 'not_found'
  | 'not_owner'
  | 'wrong_status'
  | 'not_today'
  | 'other_visit_in_progress'
  | 'no_location'
  | 'poor_accuracy'
  | 'outside_radius';

export interface EligibilityInput {
  /** Is the signed-in user the owner of this planned visit? */
  isOwner: boolean;
  /** The planned date, YYYY-MM-DD, as a business date in Ulaanbaatar. */
  plannedDate: string;
  /** Today in Ulaanbaatar, YYYY-MM-DD. */
  today: string;
  /** Current status of the planned visit. */
  status: string;
  /** Does the representative already have another visit running? */
  hasOtherVisitInProgress: boolean;
  /** Latest one-shot position reading, or null if none has been taken. */
  position: (Coordinates & { accuracyM: number | null }) | null;
  clinic: Coordinates;
  clinicRadiusM: number;
  accuracyThresholdM: number;
}

export interface EligibilityResult {
  canStart: boolean;
  isOwner: boolean;
  isToday: boolean;
  isStatusPlanned: boolean;
  noOtherInProgress: boolean;
  hasLocation: boolean;
  accuracyOk: boolean;
  withinRadius: boolean;
  /** Metres from the clinic, or null when there is no usable fix. */
  distanceM: number | null;
  radiusM: number;
  accuracyThresholdM: number;
  /** The single most useful reason to show the user first. */
  blockingReason: BlockingReason | null;
}

export function evaluateStartEligibility(input: EligibilityInput): EligibilityResult {
  const isOwner = input.isOwner;
  const isToday = input.plannedDate === input.today;
  const isStatusPlanned = input.status === 'planned';
  const noOtherInProgress = !input.hasOtherVisitInProgress;

  const hasLocation = input.position !== null && isValidCoordinate(input.position);

  // A missing accuracy value counts as unacceptable rather than assumed good:
  // an unknown error radius is not evidence of being anywhere in particular.
  const accuracyOk =
    hasLocation &&
    input.position!.accuracyM !== null &&
    input.position!.accuracyM <= input.accuracyThresholdM;

  const distanceM = hasLocation ? haversineMetres(input.position!, input.clinic) : null;

  const withinRadius = distanceM !== null && distanceM <= input.clinicRadiusM;

  const canStart =
    isOwner && isToday && isStatusPlanned && noOtherInProgress &&
    hasLocation && accuracyOk && withinRadius;

  // Same precedence as the SQL function, so the two never show different
  // reasons for the same situation.
  const blockingReason: BlockingReason | null = !isOwner
    ? 'not_owner'
    : !isStatusPlanned
      ? 'wrong_status'
      : !isToday
        ? 'not_today'
        : !noOtherInProgress
          ? 'other_visit_in_progress'
          : !hasLocation
            ? 'no_location'
            : !accuracyOk
              ? 'poor_accuracy'
              : !withinRadius
                ? 'outside_radius'
                : null;

  return {
    canStart,
    isOwner,
    isToday,
    isStatusPlanned,
    noOtherInProgress,
    hasLocation,
    accuracyOk,
    withinRadius,
    distanceM,
    radiusM: input.clinicRadiusM,
    accuracyThresholdM: input.accuracyThresholdM,
    blockingReason,
  };
}

/**
 * Can the representative ask for an exception instead?
 *
 * Being out of radius or unable to get a fix is exactly the situation the
 * exception workflow exists for — the visit may be entirely genuine and the
 * clinic's coordinates simply wrong. Being on the wrong day, or not owning the
 * visit, is not something an exception can fix.
 */
export function canRequestException(result: EligibilityResult): boolean {
  return (
    result.blockingReason === 'outside_radius' ||
    result.blockingReason === 'poor_accuracy' ||
    result.blockingReason === 'no_location'
  );
}

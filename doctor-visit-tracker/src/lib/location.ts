/**
 * Location access.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (docs/07-risks.md P1, P5, G6):
 * the app never tracks anyone. There is no background task, no geofencing
 * service, no watcher. Location is read as a ONE-SHOT, and only when the
 * representative is doing something that genuinely needs it:
 *
 *   1. showing how far away the clinic is on today's route
 *   2. starting a visit          (Phase 3)
 *   3. finishing a visit         (Phase 3)
 *   4. submitting an exception, if they choose to attach their position
 *
 * Permission requested is "when in use" only. ACCESS_BACKGROUND_LOCATION is
 * explicitly blocked in app.json, so the app cannot acquire it even by
 * accident through a dependency.
 */
import * as Location from 'expo-location';

export type LocationFailure =
  | 'permission_denied'      // the person said no
  | 'services_disabled'      // location is switched off on the phone
  | 'unavailable'            // no fix (indoors, underground)
  | 'timeout';

export interface LocationReading {
  latitude: number;
  longitude: number;
  /** Radius of 68% confidence, in metres. Larger = less certain. */
  accuracyM: number | null;
  /** Device clock at the moment of the fix. The server never trusts this. */
  deviceTimestamp: string;
  /**
   * Android reports when a reading came from a mock-location app. We record it
   * rather than blocking: the app cannot reliably prevent spoofing, so it makes
   * it visible and auditable instead. See docs/07-risks.md G1.
   */
  isMocked: boolean;
}

export type LocationResult =
  | { ok: true; reading: LocationReading }
  | { ok: false; failure: LocationFailure };

/**
 * Ask for permission if we do not already have it.
 * Returns false without prompting again if the person has permanently refused.
 */
export async function ensureForegroundPermission(): Promise<
  { granted: true } | { granted: false; failure: LocationFailure }
> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    return { granted: false, failure: 'services_disabled' };
  }

  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.granted) return { granted: true };

  if (!existing.canAskAgain) {
    return { granted: false, failure: 'permission_denied' };
  }

  const requested = await Location.requestForegroundPermissionsAsync();
  return requested.granted ? { granted: true } : { granted: false, failure: 'permission_denied' };
}

/** Do we already have permission? Used to decide whether to show distances at all. */
export async function hasForegroundPermission(): Promise<boolean> {
  const existing = await Location.getForegroundPermissionsAsync();
  return existing.granted;
}

/**
 * Take a single position reading.
 *
 * @param accuracy  'balanced' is enough to show a distance on a list and is
 *                  much faster and cheaper on battery. Phase 3 uses 'high' for
 *                  the check-in decision, where precision actually matters.
 */
export async function readCurrentPosition(
  accuracy: 'balanced' | 'high' = 'balanced',
  timeoutMs = 15_000,
): Promise<LocationResult> {
  const permission = await ensureForegroundPermission();
  if (!permission.granted) return { ok: false, failure: permission.failure };

  try {
    const position = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy:
          accuracy === 'high'
            ? Location.Accuracy.BestForNavigation
            : Location.Accuracy.Balanced,
      }),
      timeoutMs,
    );

    if (!position) return { ok: false, failure: 'timeout' };

    return {
      ok: true,
      reading: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM: position.coords.accuracy ?? null,
        deviceTimestamp: new Date(position.timestamp).toISOString(),
        isMocked: position.mocked ?? false,
      },
    };
  } catch {
    return { ok: false, failure: 'unavailable' };
  }
}

/**
 * expo-location has no timeout option, and a phone in a concrete hospital
 * basement can hang indefinitely waiting for a fix. Racing against a timer
 * means the UI always resolves.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

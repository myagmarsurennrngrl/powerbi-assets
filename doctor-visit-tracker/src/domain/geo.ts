/**
 * Geographic helpers.
 *
 * IMPORTANT: this file exists so the app can disable the "Уулзалт эхлүүлэх"
 * button and show a live distance BEFORE the user taps it. It is a usability
 * aid, not a security control.
 *
 * The decision that actually permits a visit to start is made by
 * public.fn_haversine_metres() inside fn_start_visit() on the server, from the
 * coordinates the phone submits. A distance calculated here is never sent to
 * the server, and would be ignored if it were. See docs/07-risks.md G4.
 *
 * tests/domain/geo.test.ts asserts that this implementation and the SQL one
 * agree to within a centimetre, so the button state never disagrees with the
 * server's verdict.
 */

/** Mean Earth radius in metres (IUGG). Identical to the constant used in SQL. */
export const EARTH_RADIUS_M = 6371008.8;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in metres.
 *
 * Uses the Haversine formula, which is numerically stable for the short
 * distances this app deals with (metres to tens of kilometres).
 */
export function haversineMetres(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Are the coordinates real values a GPS chip could produce? */
export function isValidCoordinate(point: Coordinates): boolean {
  const { latitude, longitude } = point;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    // 0,0 is the classic "no fix yet" placeholder, not a location in Mongolia.
    !(latitude === 0 && longitude === 0)
  );
}

/** Bounding box of Mongolia — used to warn about mistyped clinic coordinates. */
export function isPlausiblyInMongolia(point: Coordinates): boolean {
  return (
    point.latitude >= 41.0 &&
    point.latitude <= 52.5 &&
    point.longitude >= 87.0 &&
    point.longitude <= 120.0
  );
}

/** Format a distance the way it is shown in the Mongolian UI. */
export function formatDistanceMn(metres: number): string {
  if (!Number.isFinite(metres)) return '—';
  if (metres < 1000) return `${Math.round(metres)} м`;
  return `${(metres / 1000).toFixed(1)} км`;
}

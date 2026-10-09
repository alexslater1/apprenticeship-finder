const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

/** Nearest distance from home to any of a listing's locations, or null if none are geocoded. */
export function nearestMiles(
  home: { lat: number; lon: number } | null,
  locations: Array<{ lat?: number; lon?: number }>,
): number | null {
  if (!home) return null;
  let best: number | null = null;
  for (const l of locations) {
    if (typeof l.lat !== 'number' || typeof l.lon !== 'number') continue;
    const d = haversineMiles(home.lat, home.lon, l.lat, l.lon);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** Normalise a UK postcode: ' ls14bn ' → 'LS1 4BN'. Returns null if it doesn't look like one. */
export function normalisePostcode(pc: string): string | null {
  const s = pc.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(s)) return null;
  return `${s.slice(0, -3)} ${s.slice(-3)}`;
}

export const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

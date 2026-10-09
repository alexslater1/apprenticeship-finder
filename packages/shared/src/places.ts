import placesJson from '../../../config/uk-places.json';
import { haversineMiles } from './geo.ts';
import type { Nation } from './types.ts';

export interface Place {
  name: string;
  aliases: string[];
  lat: number | null;
  lon: number | null;
  region: string | null;
  nation: Nation;
  county: string | null;
  kind: 'city' | 'town' | 'county' | 'region' | 'nation' | 'remote' | 'national';
}

export const places = (placesJson as { places: Place[] }).places;

const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\bst\.\s*/g, 'st ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const index = new Map<string, Place>();
for (const p of places) {
  for (const n of [p.name, ...p.aliases]) {
    const k = key(n);
    const existing = index.get(k);
    // Towns/cities win over areas with the same name.
    if (!existing || (existing.lat === null && p.lat !== null)) index.set(k, p);
  }
}

export function placeByName(name: string): Place | undefined {
  return index.get(key(name));
}

const NOISE =
  /\b(hybrid|remote working|office|campus|head office|hq|based|site|area|centre|center|region)\b/gi;

/**
 * Best gazetteer match for a free-text location such as 'London, Barclays Campus',
 * 'Glasgow (Hybrid)', 'Crawley / Templecombe'. Point places beat areas.
 */
export function findPlace(text: string): Place | undefined {
  const whole = placeByName(text);
  if (whole) return whole;
  const tokens = text
    .split(/[,;/()|]|\s[-–]\s|\bor\b|\band\b|\n/i)
    .map((t) => t.replace(NOISE, ' ').trim())
    .filter(Boolean);
  let area: Place | undefined;
  for (const t of tokens) {
    const p = placeByName(t) ?? placeWithin(t);
    if (p && p.lat !== null) return p;
    if (p && !area) area = p;
  }
  return area;
}

/** Any known town/city name appearing as whole words inside `text`. */
function placeWithin(text: string): Place | undefined {
  const k = ` ${key(text)} `;
  for (const p of places) {
    if (p.lat === null) continue;
    for (const n of [p.name, ...p.aliases]) if (k.includes(` ${key(n)} `)) return p;
  }
  return undefined;
}

/** Nearest town/city to a point, within `maxMiles`. */
export function nearestPlace(lat: number, lon: number, maxMiles = 15): Place | undefined {
  let best: Place | undefined;
  let bestD = Infinity;
  for (const p of places) {
    if (p.lat === null || p.lon === null) continue;
    const d = haversineMiles(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return bestD <= maxMiles ? best : undefined;
}

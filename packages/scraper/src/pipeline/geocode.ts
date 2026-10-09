import {
  normalisePostcode,
  POSTCODE_RE,
  type Location,
  type Nation,
  type RawListing,
} from '@af/shared';
import { findPlace, nearestPlace, placeByName, places } from '@af/shared/places';
import type { Ctx } from '../types.ts';

/** What we keep per postcode from postcodes.io (cached in source_state 'geo:postcodes'). */
export interface PostcodeInfo {
  lat: number;
  lon: number;
  district: string | null;
  region: string | null;
  country: string | null;
}
export type PostcodeCache = Record<string, PostcodeInfo | null>;

const CACHE_KEY = 'geo:postcodes';
const NATIONS = new Set<Nation>(['England', 'Scotland', 'Wales', 'Northern Ireland']);
const STREETY =
  /\d|\b(street|st|road|rd|lane|ln|avenue|ave|close|way|drive|court|place|park|house|farm|estate|industrial|unit|floor|building|centre|center|square|crescent|terrace|grove|hill|walk|row|mews|gardens|business|office|campus)\b/i;

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

// postcodes.io says 'Yorkshire and The Humber'; the gazetteer (OS Open Names) says 'the'.
const REGIONS = new Map(
  places.filter((p) => p.kind === 'region').map((p) => [p.name.toLowerCase(), p.name]),
);
const canonicalRegion = (r: string | null | undefined) =>
  r ? (REGIONS.get(r.toLowerCase()) ?? r) : undefined;

/** Pick a human city name for one location (PLAN.md §5.2). */
export function cityFor(loc: Location, info: PostcodeInfo | null): string | undefined {
  const lines = loc.lines ?? [];
  for (const line of [...lines].reverse()) {
    const p = placeByName(line);
    if (p && p.lat !== null) return p.name;
  }
  if (info?.region === 'London') return 'London';
  // The address's last line is usually the post town ('Liphook'), unless it's a county.
  const last = lines.at(-1);
  if (last && !STREETY.test(last) && !placeByName(last)) return titleCase(last);
  const lat = loc.lat ?? info?.lat;
  const lon = loc.lon ?? info?.lon;
  if (lat !== undefined && lon !== undefined) {
    const near = nearestPlace(lat, lon, 6);
    if (near) return near.name;
  }
  const town = [...lines].reverse().find((l) => !STREETY.test(l) && !placeByName(l));
  if (town) return titleCase(town);
  return info?.district ?? undefined;
}

function nationFrom(country: string | null | undefined): Nation | undefined {
  return country && NATIONS.has(country as Nation) ? (country as Nation) : undefined;
}

/** Fill postcode, lat/lon, city, region and nation on every location, in place. */
export function enrichLocation(loc: Location, cache: PostcodeCache): void {
  if (!loc.postcode) {
    const m = POSTCODE_RE.exec(loc.text);
    if (m) loc.postcode = `${m[1]} ${m[2]}`.toUpperCase();
  }
  const pc = loc.postcode ? normalisePostcode(loc.postcode) : null;
  if (pc) loc.postcode = pc;
  const info = pc ? (cache[pc] ?? null) : null;

  if (info) {
    loc.lat ??= info.lat;
    loc.lon ??= info.lon;
    loc.nation = nationFrom(info.country) ?? loc.nation;
    loc.region = canonicalRegion(info.region) ?? info.country ?? loc.region;
  }

  if (!info && !loc.lines?.length) {
    // Free-text location from a job board, e.g. 'Glasgow (Hybrid)'.
    const place = findPlace(loc.text);
    if (place) {
      loc.city ??= place.lat !== null ? place.name : undefined;
      loc.lat ??= place.lat ?? undefined;
      loc.lon ??= place.lon ?? undefined;
      loc.region ??= place.region ?? undefined;
      loc.nation = place.nation;
    }
    return;
  }

  loc.city ??= cityFor(loc, info);
  if (!loc.region && loc.city) {
    const p = placeByName(loc.city);
    loc.region = p?.region ?? undefined;
    loc.nation = loc.nation ?? p?.nation;
  }
  // Human-friendly label for cards: 'Crawley, RH10 9HA'.
  if (loc.city) loc.text = [loc.city, loc.postcode].filter(Boolean).join(', ');
}

/** Look up any postcodes we haven't seen before (postcodes.io bulk, 100 per call). */
export async function lookupPostcodes(
  postcodes: string[],
  ctx: Ctx,
  cache: PostcodeCache,
): Promise<number> {
  const missing = [...new Set(postcodes)].filter((pc) => !(pc in cache));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    try {
      const res = await ctx.http.json<{
        result: Array<{
          query: string;
          result: {
            latitude: number;
            longitude: number;
            admin_district: string | null;
            region: string | null;
            country: string | null;
          } | null;
        }>;
      }>('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch }),
      });
      for (const r of res.result) {
        const pc = normalisePostcode(r.query);
        if (!pc) continue;
        cache[pc] = r.result
          ? {
              lat: r.result.latitude,
              lon: r.result.longitude,
              district: r.result.admin_district,
              region: r.result.region,
              country: r.result.country,
            }
          : null;
      }
    } catch (err) {
      ctx.log.warn(`postcodes.io: ${(err as Error).message}`);
    }
  }
  return missing.length;
}

export async function geocodeAll(listings: RawListing[], ctx: Ctx): Promise<void> {
  const cache = (await ctx.state.get<PostcodeCache>(CACHE_KEY)) ?? {};
  const pcs = listings
    .flatMap((l) => l.locations)
    .map((loc) => loc.postcode ?? POSTCODE_RE.exec(loc.text)?.[0])
    .map((pc) => (pc ? normalisePostcode(pc) : null))
    .filter((pc): pc is string => !!pc);
  const looked = await lookupPostcodes(pcs, ctx, cache);
  if (looked) await ctx.state.set(CACHE_KEY, cache);
  for (const l of listings) for (const loc of l.locations) enrichLocation(loc, cache);
}

import { createHash } from 'node:crypto';
import { classify, decodeEntities, haversineMiles } from '@af/shared';
import { placeByName } from '@af/shared/places';

/**
 * Cross-source dedupe (PLAN.md §5.3). The same Thales vacancy is
 * "2027 Data Science Apprentice - Crawley" on FAA and "Level 6 Data Science Degree
 * Apprenticeship" on Higherin, so exact titles don't work. We compare the meaningful words
 * instead: same employer + same place + (equal word sets, one a subset of the other, or
 * Jaccard ≥ 0.7).
 */

const STOP = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'uk',
  'apprentice',
  'apprentices',
  'apprenticeship',
  'apprenticeships',
  'programme',
  'program',
  'scheme',
  'degree',
  'level',
  'higher',
  'advanced',
  'intermediate',
  'register',
  'your',
  'interest',
  'trainee',
  'junior',
  'entry',
  'opportunity',
  'role',
  'position',
  'job',
  'september',
  'intake',
  'start',
  'hybrid',
  'remote',
  'based',
]);

const STEM: Record<string, string> = {
  scientist: 'science',
  scientists: 'science',
  sciences: 'science',
  analyst: 'analysis',
  analysts: 'analysis',
  analytics: 'analysis',
  analytical: 'analysis',
  analyse: 'analysis',
  analysing: 'analysis',
  engineering: 'engineer',
  engineers: 'engineer',
  developer: 'develop',
  developers: 'develop',
  development: 'develop',
  technologies: 'technology',
  technologist: 'technology',
  technical: 'technology',
  solutions: 'solution',
  systems: 'system',
};

function stem(w: string): string {
  if (STEM[w]) return STEM[w];
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss'))
    return STEM[w.slice(0, -1)] ?? w.slice(0, -1);
  return w;
}

/** A trailing ' - Cheadle' / ' - Bell Integration' style segment that names a place or client, not the role. */
function isTrailingTag(segment: string): boolean {
  const s = segment.trim();
  if (!s || s.split(/\s+/).length > 3 || /\d|apprentic/i.test(s)) return false;
  const c = classify({ title: s });
  return c.roleVia !== 'title' && c.roleVia !== 'title_weak';
}

/** Meaningful title words, minus years, levels, scheme words and the listing's own place names. */
export function titleTokens(
  title: string,
  places: Array<string | null | undefined> = [],
): Set<string> {
  const placeWords = new Set(
    places.flatMap((p) => (p ?? '').toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean),
  );
  const segments = decodeEntities(title).split(/\s+[-–|]\s+/);
  while (segments.length > 1 && isTrailingTag(segments.at(-1)!)) segments.pop();
  const words = segments
    .join(' ')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(machine)\s*(learning)\b/g, 'machinelearning')
    .replace(/\bartificial\s+intelligence\b/g, 'ai')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !/^l\d$/.test(w) && !STOP.has(w) && !placeWords.has(w))
    .map(stem);
  return new Set(words);
}

export function similarTitles(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const small = Math.min(a.size, b.size);
  if (inter === small && small >= 2) return true; // one is a subset of the other
  return inter / (a.size + b.size - inter) >= 0.7;
}

/** 'airbus' ~ 'airbus operations'; 'thales' ~ 'thales'. */
export function sameEmployer(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

const placeKey = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const NEAR_MILES = 12;

/** Same town, or two towns close enough to be one site (Thales Cheadle is 'Stockport' on FAA, 'Manchester' on Higherin). */
export function samePlace(a: string[], b: string[]): boolean {
  const A = a.map(placeKey).filter(Boolean);
  const B = b.map(placeKey).filter(Boolean);
  if (!A.length || !B.length) return true; // unknown location on one side: don't block a match
  if (A.some((x) => B.includes(x))) return true;
  const pts = (xs: string[]) =>
    xs.map((x) => placeByName(x)).filter((p) => p && p.lat !== null && p.lon !== null) as Array<{
      lat: number;
      lon: number;
    }>;
  const PA = pts(a);
  const PB = pts(b);
  return PA.some((p) => PB.some((q) => haversineMiles(p.lat, p.lon, q.lat, q.lon) <= NEAR_MILES));
}

/** Stable key: employer | sorted title words | primary place. Word order doesn't matter. */
export function dedupeKey(
  employerNorm: string,
  title: string,
  city: string | null | undefined,
  places: Array<string | null | undefined> = [city],
): string {
  const words = [...titleTokens(title, places)].sort().join(' ');
  return createHash('sha1')
    .update(`${employerNorm}|${words}|${placeKey(city)}`)
    .digest('hex');
}

export interface Matchable {
  dedupeKey: string;
  employerNorm: string;
  title: string;
  cities: string[];
}

/**
 * For each incoming listing, adopt the dedupe key of an existing (or earlier incoming)
 * listing that's the same vacancy. Returns new keys in input order.
 */
export function assignKeys(incoming: Matchable[], existing: Matchable[]): string[] {
  const pool: Array<Matchable & { tokens: Set<string> }> = existing.map((e) => ({
    ...e,
    tokens: titleTokens(e.title, e.cities),
  }));
  const byKey = new Set(existing.map((e) => e.dedupeKey));
  return incoming.map((l) => {
    if (byKey.has(l.dedupeKey)) return l.dedupeKey;
    const tokens = titleTokens(l.title, l.cities);
    const hit = pool.find(
      (p) =>
        sameEmployer(p.employerNorm, l.employerNorm) &&
        samePlace(p.cities, l.cities) &&
        similarTitles(p.tokens, tokens),
    );
    if (hit) return hit.dedupeKey;
    pool.push({ ...l, tokens });
    byKey.add(l.dedupeKey);
    return l.dedupeKey;
  });
}

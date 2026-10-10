import { MIN_LEVEL } from '@af/shared';
import { db, must } from '../db.ts';
import { samePlace, similarTitles, titleTokens } from './dedupe.ts';

/**
 * Some copies of an advert don't say its level while another copy does: Adzuna's summary of
 * Howden's "Data Analyst Apprenticeship Programme 2027 - Cheltenham" against Find an
 * Apprenticeship's Level 3 "Data Analyst Apprenticeship Programme" (Alex, 10 Oct). They don't
 * merge because the Level 3 one was already closed. When a live listing has no level and the same
 * employer has a matching advert that does, take its level, and close the listing when that is
 * below the minimum.
 */

interface Row {
  id: string;
  title: string;
  employer_name_norm: string;
  primary_city: string | null;
  locations: Array<{ city?: string }> | null;
  level?: number | null;
  is_degree?: boolean | null;
}

const cities = (r: Row) =>
  [r.primary_city, ...(r.locations ?? []).map((l) => l.city)].filter((c): c is string => !!c);

/** Same employer, same words, and the same place (or the other advert's city in the title). */
export function sameAdvert(blank: Row, other: Row): boolean {
  if (blank.employer_name_norm !== other.employer_name_norm) return false;
  if (
    !similarTitles(titleTokens(blank.title, cities(blank)), titleTokens(other.title, cities(other)))
  )
    return false;
  const a = cities(blank);
  const b = cities(other);
  if (a.length && b.length) return samePlace(a, b);
  return b.some((c) => blank.title.toLowerCase().includes(c.toLowerCase()));
}

export async function inheritLevels(
  opts: { dryRun?: boolean } = {},
): Promise<{ filled: number; closed: number }> {
  const blank = must<Row[]>(
    await db()
      .from('listings')
      .select('id,title,employer_name_norm,primary_city,locations,is_degree')
      .eq('is_active', true)
      .is('level', null),
    'listings without a level',
  );
  if (!blank.length) return { filled: 0, closed: 0 };
  const known = must<Row[]>(
    await db()
      .from('listings')
      .select('id,title,employer_name_norm,primary_city,locations,level,is_degree')
      .in('employer_name_norm', [...new Set(blank.map((b) => b.employer_name_norm))])
      .not('level', 'is', null),
    'adverts with a level',
  );
  let filled = 0;
  let closed = 0;
  for (const b of blank) {
    const matches = known.filter((k) => k.id !== b.id && sameAdvert(b, k));
    const levels = new Set(matches.map((m) => m.level));
    if (levels.size !== 1) continue; // none, or copies that disagree
    const level = matches[0]!.level!;
    const below = level < MIN_LEVEL;
    filled++;
    if (below) closed++;
    if (!opts.dryRun)
      must(
        await db()
          .from('listings')
          .update({
            level,
            level_source: 'other_advert',
            is_degree: b.is_degree ?? matches[0]!.is_degree ?? null,
            ...(below ? { is_active: false, closed_reason: 'below_min_level' } : {}),
          })
          .eq('id', b.id),
        'save level from another advert',
      );
  }
  return { filled, closed };
}

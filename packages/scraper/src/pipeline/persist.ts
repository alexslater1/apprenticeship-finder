import { MIN_LEVEL, baseScore, londonDate } from '@af/shared';
import { db, must } from '../db.ts';
import type { Ctx } from '../types.ts';
import type { Matchable } from './dedupe.ts';
import { plausibleDeadline, type NormalisedListing } from './normalise.ts';

export interface ExistingRow {
  id: string;
  dedupe_key: string;
  first_seen_at: string;
  description_html: string | null;
  description_text: string | null;
  posted_date: string | null;
  closing_date: string | null;
  apply_url?: string | null;
  level?: number | null;
  level_source?: string | null;
  is_degree?: boolean | null;
  lars_code?: number | null;
  standard_title?: string | null;
  provider_name?: string | null;
  employer_id?: string | null;
  university?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_text?: string | null;
  start_date?: string | null;
  locations?: NormalisedListing['locations'];
  primary_city?: string | null;
  region?: string | null;
  nation?: NormalisedListing['nation'];
  details?: Record<string, unknown> | null;
}

const EXISTING_COLUMNS =
  'id,dedupe_key,first_seen_at,description_html,description_text,posted_date,closing_date,apply_url,level,level_source,is_degree,lars_code,standard_title,provider_name,employer_id,university,salary_min,salary_max,salary_text,start_date,locations,primary_city,region,nation,details';

const chunk = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function loadExisting(keys: string[]): Promise<Map<string, ExistingRow>> {
  const out = new Map<string, ExistingRow>();
  for (const part of chunk(keys, 100)) {
    const rows = must<ExistingRow[]>(
      await db().from('listings').select(EXISTING_COLUMNS).in('dedupe_key', part),
      'load existing listings',
    );
    for (const r of rows) out.set(r.dedupe_key, r);
  }
  return out;
}

/** Combine this run's view of a listing with what's stored (PLAN.md §5 step 7). */
export function toRow(
  l: NormalisedListing,
  ex: ExistingRow | undefined,
  today: string,
  nowIso: string,
) {
  const keepOldDescription =
    !!ex?.description_text && ex.description_text.length > (l.descriptionText?.length ?? 0);
  const descriptionHtml = keepOldDescription ? ex!.description_html : l.descriptionHtml;
  const descriptionText = keepOldDescription ? ex!.description_text : l.descriptionText;
  const postedDate =
    [l.postedDate, ex?.posted_date].filter((d): d is string => !!d).sort()[0] ?? null;
  const closingDate = l.closingDate ?? plausibleDeadline(ex?.closing_date ?? undefined);
  const firstSeen = ex ? londonDate(new Date(ex.first_seen_at)) : today;
  const score = baseScore({
    title: l.title,
    descriptionText: descriptionText ?? undefined,
    classification: l.classification,
    postedOrFirstSeen: postedDate ?? firstSeen,
    closingDate,
    isLead: l.isLead,
    today,
  });
  const c = l.classification;
  const level = c.level ?? ex?.level ?? null;
  const closedReason =
    closingDate && closingDate < today
      ? 'closing_date_passed'
      : level !== null && level < MIN_LEVEL
        ? 'below_min_level'
        : null;
  // Fill gaps, never blank out what another source told us (e.g. Higherin has no apply link
  // for a Thales job FAA links straight to Workday).
  const keepLocation = !l.locations.length && !!ex?.locations?.length;
  return {
    dedupe_key: l.dedupeKey,
    title: l.title,
    employer_name: l.employerName,
    employer_name_norm: l.employerNameNorm,
    url: l.url,
    apply_url: l.applyUrl ?? ex?.apply_url ?? null,
    description_html: descriptionHtml,
    description_text: descriptionText,
    level,
    level_source: c.level !== null ? c.levelSource : (ex?.level_source ?? null),
    is_degree: c.isDegree ?? ex?.is_degree ?? null,
    lars_code: l.larsCode ?? ex?.lars_code ?? null,
    standard_title: l.standardTitle ?? ex?.standard_title ?? null,
    employer_id: l.employerId ?? ex?.employer_id ?? null,
    provider_name: l.providerName ?? ex?.provider_name ?? null,
    university: l.university ?? ex?.university ?? null,
    role_type: c.roleType,
    score: score.total,
    score_breakdown: score,
    salary_min: l.salaryMin ?? ex?.salary_min ?? null,
    salary_max: l.salaryMin !== null ? l.salaryMax : (ex?.salary_max ?? null),
    salary_text: l.salaryText ?? ex?.salary_text ?? null,
    posted_date: postedDate,
    closing_date: closingDate,
    start_date: l.startDate ?? ex?.start_date ?? null,
    locations: keepLocation ? ex!.locations! : l.locations,
    primary_city: keepLocation ? (ex?.primary_city ?? null) : l.primaryCity,
    region: keepLocation ? (ex?.region ?? null) : l.region,
    nation: keepLocation ? (ex?.nation ?? l.nation) : l.nation,
    is_national: l.isNational,
    details: l.details || ex?.details ? { ...(ex?.details ?? {}), ...(l.details ?? {}) } : null,
    last_seen_at: nowIso,
    // Still advertised but past its deadline (or a level we don't show): keep it closed rather
    // than flip it back on.
    is_active: !closedReason,
    closed_reason: closedReason,
  };
}

export interface PersistResult {
  inserted: number;
  updated: number;
  newIds: string[];
}

export async function persist(listings: NormalisedListing[], ctx: Ctx): Promise<PersistResult> {
  if (ctx.dryRun) {
    for (const l of listings) {
      const s = baseScore({
        title: l.title,
        descriptionText: l.descriptionText ?? undefined,
        classification: l.classification,
        postedOrFirstSeen: l.postedDate,
        closingDate: l.closingDate,
        today: ctx.today,
      });
      ctx.log.info(
        `[dry] ${String(s.total).padStart(3)} L${l.classification.level ?? '?'} ${l.classification.roleType.padEnd(16)} ${l.title} — ${l.employerName} (${l.primaryCity ?? l.nation})`,
      );
    }
    return { inserted: 0, updated: 0, newIds: [] };
  }

  const nowIso = new Date().toISOString();
  const existing = await loadExisting(listings.map((l) => l.dedupeKey));
  const rows = listings.map((l) => toRow(l, existing.get(l.dedupeKey), ctx.today, nowIso));

  const idByKey = new Map<string, string>();
  for (const part of chunk(rows, 200)) {
    const saved = must<Array<{ id: string; dedupe_key: string }>>(
      await db()
        .from('listings')
        .upsert(part, { onConflict: 'dedupe_key' })
        .select('id,dedupe_key'),
      'upsert listings',
    );
    for (const r of saved) idByKey.set(r.dedupe_key, r.id);
  }

  const sourceRows = listings.flatMap((l) =>
    l.sources.map((s) => ({
      listing_id: idByKey.get(l.dedupeKey),
      source: s.source,
      source_id: s.sourceId,
      url: s.url,
      last_seen_at: nowIso,
      missed_runs: 0,
      raw: s.raw ?? null,
    })),
  );
  for (const part of chunk(sourceRows, 200)) {
    must(
      await db().from('listing_sources').upsert(part, { onConflict: 'source,source_id' }),
      'upsert listing_sources',
    );
  }

  const newIds = listings
    .filter((l) => !existing.has(l.dedupeKey))
    .map((l) => idByKey.get(l.dedupeKey))
    .filter((id): id is string => !!id);
  return { inserted: newIds.length, updated: listings.length - newIds.length, newIds };
}

/** Deactivate listings with no closing date whose every source went quiet `days` ago. */
export async function expireStale(days: number): Promise<number> {
  const res = must<Array<{ deactivated: number }>>(
    await db().rpc('expire_stale', { p_days: days }),
    'expire_stale',
  );
  return res[0]?.deactivated ?? 0;
}

/** After a complete sync of `source`, count misses and deactivate gone/closed listings. */
export async function markMissing(
  source: string,
  runStartedIso: string,
  incremental: string[],
): Promise<number> {
  const res = must<Array<{ deactivated: number }>>(
    await db().rpc('mark_missing', {
      p_source: source,
      p_run_started: runStartedIso,
      p_incremental: incremental,
    }),
    `mark_missing ${source}`,
  );
  return res[0]?.deactivated ?? 0;
}

/** Active listings in the shape the cross-source matcher needs (dedupe.ts). */
export async function loadMatchables(): Promise<Matchable[]> {
  const out: Matchable[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must<
      Array<{
        dedupe_key: string;
        title: string;
        employer_name_norm: string;
        primary_city: string | null;
        locations: Array<{ city?: string }>;
      }>
    >(
      await db()
        .from('listings')
        .select('dedupe_key,title,employer_name_norm,primary_city,locations')
        .eq('is_active', true)
        .range(from, from + 999),
      'load active listings',
    );
    for (const r of rows) {
      const cities = [r.primary_city, ...(r.locations ?? []).map((l) => l.city)].filter(
        (c): c is string => !!c,
      );
      out.push({
        dedupeKey: r.dedupe_key,
        employerNorm: r.employer_name_norm,
        title: r.title,
        cities,
      });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

export async function knownSourceIds(source: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const rows = must<Array<{ source_id: string }>>(
      await db()
        .from('listing_sources')
        .select('source_id')
        .eq('source', source)
        .range(from, from + 999),
      `known ids ${source}`,
    );
    for (const r of rows) ids.add(r.source_id);
    if (rows.length < 1000) break;
  }
  return ids;
}

/** Stored job ids for every employer connector, keyed by source (`employer:{id}`). */
export async function knownEmployerIds(): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (let from = 0; ; from += 1000) {
    const rows = must<Array<{ source: string; source_id: string }>>(
      await db()
        .from('listing_sources')
        .select('source,source_id')
        .like('source', 'employer:%')
        .range(from, from + 999),
      'known employer ids',
    );
    for (const r of rows) {
      let set = out.get(r.source);
      if (!set) out.set(r.source, (set = new Set()));
      set.add(r.source_id);
    }
    if (rows.length < 1000) break;
  }
  return out;
}

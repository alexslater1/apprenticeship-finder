import {
  MIN_LEVEL,
  daysBetween,
  excludedByPrefs,
  gradeFit,
  type GradeFit,
  londonToday,
  nearestMiles,
  personalScore,
  type ListingRow,
  type PersonalPrefs,
  ROLE_LABELS,
  type SettingsRow,
  type TrackStatus,
} from '@af/shared';
import type { Filters, SortKey } from '@/store/filters';
import { locationLabel } from './format';

export interface Derived {
  row: ListingRow;
  /** Base score + personal boosts from settings, 0–100 (shown). */
  score: number;
  /** The same before capping at 100 (sorted on). */
  rank: number;
  distance: number | null;
  daysToClose: number | null;
  isNew: boolean;
  /** Hidden by a 'No' role or level in Settings (or a level we no longer collect). */
  excluded: 'role' | 'level' | null;
  /** His predicted grades against the entry requirements (null when either is unknown). */
  fit: GradeFit | null;
}

export function prefsFrom(s: SettingsRow | undefined): PersonalPrefs {
  return {
    roles: s?.role_prefs ?? {},
    levels: s?.level_prefs ?? {},
    defaultDistanceMiles: s ? s.default_distance_miles : null,
    score: s?.score_prefs ?? {},
  };
}

export function homeFrom(s: SettingsRow | undefined): { lat: number; lon: number } | null {
  return s?.home_lat != null && s?.home_lon != null ? { lat: s.home_lat, lon: s.home_lon } : null;
}

export function derive(
  rows: ListingRow[],
  settings: SettingsRow | undefined,
  today = londonToday(),
): Derived[] {
  const prefs = prefsFrom(settings);
  const home = homeFrom(settings);
  return rows.map((row) => {
    const distance = nearestMiles(home, row.locations ?? []);
    return {
      row,
      distance,
      score: personalScore(row, prefs, distance),
      rank: personalScore(row, prefs, distance, { clamp: false }),
      daysToClose: row.closing_date ? daysBetween(today, row.closing_date) : null,
      isNew: daysBetween(row.first_seen_at.slice(0, 10), today) <= 3,
      excluded: row.level !== null && row.level < MIN_LEVEL ? 'level' : excludedByPrefs(row, prefs),
      fit: gradeFit(row.entry, prefs.score?.predictedGrades, prefs.score?.subjects ?? []),
    };
  });
}

export function matches(d: Derived, f: Filters, today = londonToday()): boolean {
  const r = d.row;
  if (d.excluded) return false;
  if (!f.includeHidden && r.hidden) return false;
  if (!f.includeClosed && !r.is_active) return false;
  if (!f.includeInterest && r.pre_register) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay =
      `${r.title} ${r.employer_name} ${r.primary_city ?? ''} ${r.standard_title ?? ''} ${r.provider_name ?? ''} ${r.university ?? ''}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (f.roles.length && !f.roles.includes(r.role_type)) return false;
  if (f.levels.length && (r.level === null || !f.levels.includes(r.level))) return false;
  if (f.nations.length && !f.nations.includes(r.nation)) return false;
  if (f.region && r.region !== f.region && !(r.locations ?? []).some((l) => l.region === f.region))
    return false;
  if (f.city && r.primary_city !== f.city && !(r.locations ?? []).some((l) => l.city === f.city))
    return false;
  if (f.maxDistance !== null) {
    if (d.distance === null) {
      if (f.onlyKnownLocation) return false;
    } else if (d.distance > f.maxDistance) return false;
  } else if (f.onlyKnownLocation && d.distance === null) {
    return false;
  }
  if (f.salaryMin !== null && (r.salary_max ?? r.salary_min ?? 0) < f.salaryMin) return false;
  if (f.closingWithinDays !== null) {
    if (d.daysToClose === null || d.daysToClose < 0 || d.daysToClose > f.closingWithinDays)
      return false;
  }
  if (f.postedWithinDays !== null) {
    const posted = r.posted_date ?? r.first_seen_at.slice(0, 10);
    if (daysBetween(posted, today) > f.postedWithinDays) return false;
  }
  if (f.sources.length && !r.sources.some((s) => f.sources.includes(sourceKey(s.source))))
    return false;
  if (f.degreeOnly && !r.is_degree) return false;
  if (f.employerId && r.employer_id !== f.employerId) return false;
  if (f.withinGrades && (d.fit === 'below' || d.fit === 'subject')) return false;
  return true;
}

type SortValue = number | string | null;

const FIT_ORDER: Record<GradeFit, number> = { meets: 0, close: 1, below: 2, subject: 3 };
const STATUS_ORDER: Partial<Record<TrackStatus, number>> = {
  offer: 0,
  interview: 1,
  applied: 2,
  saved: 3,
  rejected: 4,
};

/** What each sort compares, and its natural direction (1 = smallest / A first). */
const SORTS: Record<SortKey, { value: (d: Derived) => SortValue; dir: 1 | -1 }> = {
  score: { value: (d) => d.rank, dir: -1 },
  closing: { value: (d) => d.daysToClose, dir: 1 },
  newest: { value: (d) => d.row.first_seen_at, dir: -1 },
  salary: { value: (d) => d.row.salary_max ?? d.row.salary_min, dir: -1 },
  distance: { value: (d) => d.distance, dir: 1 },
  title: { value: (d) => d.row.title.toLowerCase(), dir: 1 },
  location: {
    value: (d) => {
      const l = locationLabel(d.row);
      return l === 'Location unknown' ? null : l.toLowerCase();
    },
    dir: 1,
  },
  level: { value: (d) => d.row.level, dir: -1 },
  role: { value: (d) => ROLE_LABELS[d.row.role_type], dir: 1 },
  // Adverts his grades meet first, then close, then below; adverts that don't say, last.
  grades: { value: (d) => (d.fit ? FIT_ORDER[d.fit] : null), dir: 1 },
  posted: { value: (d) => d.row.posted_date ?? d.row.first_seen_at.slice(0, 10), dir: -1 },
  start: { value: (d) => d.row.start_date, dir: 1 },
  status: { value: (d) => STATUS_ORDER[d.row.status] ?? null, dir: 1 },
};

/** Whether this sort puts the smallest value (or A) first: which way the header arrow points. */
export function sortsAscending(sort: SortKey, reverse: boolean): boolean {
  return (SORTS[sort] ?? SORTS.score).dir * (reverse ? -1 : 1) === 1;
}

/** Sorted copy. `reverse` flips the order; unknown values stay at the bottom either way. */
export function sortDerived(list: Derived[], sort: SortKey, reverse = false): Derived[] {
  const { value, dir } = SORTS[sort] ?? SORTS.score;
  const sign = reverse ? -dir : dir;
  const tie = (a: Derived, b: Derived) => b.rank - a.rank || a.row.title.localeCompare(b.row.title);
  return list
    .map((d) => ({ d, v: value(d) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) {
        if (a.v !== b.v) return a.v === null ? 1 : -1;
        return tie(a.d, b.d);
      }
      const c = typeof a.v === 'string' ? a.v.localeCompare(b.v as string) : a.v - (b.v as number);
      return c * sign || tie(a.d, b.d);
    })
    .map((x) => x.d);
}

/** 'employer:barclays' → 'employer'; everything else as-is. */
export function sourceKey(source: string): string {
  return source.startsWith('employer:') ? 'employer' : source;
}

export const SOURCE_LABELS: Record<string, string> = {
  faa: 'Find an Apprenticeship',
  higherin: 'Higherin',
  reed: 'Reed',
  adzuna: 'Adzuna',
  employer: 'Employer site',
  google_jobs: 'Google Jobs',
  web_search: 'Web search',
  scot: 'apprenticeships.scot',
  wales: 'Careers Wales',
  ni: 'JobApplyNI',
  amazing: 'Amazing Apprenticeships',
  ngtu: 'Not Going To Uni',
};

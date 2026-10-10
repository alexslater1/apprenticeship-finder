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
  type SettingsRow,
} from '@af/shared';
import type { Filters } from '@/store/filters';

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

const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
};

export function sortDerived(list: Derived[], sort: Filters['sort']): Derived[] {
  const out = [...list];
  const tie = (a: Derived, b: Derived) => b.rank - a.rank || a.row.title.localeCompare(b.row.title);
  out.sort((a, b) => {
    switch (sort) {
      case 'closing':
        return nullsLast(a.daysToClose, b.daysToClose, 1) || tie(a, b);
      case 'newest':
        return b.row.first_seen_at.localeCompare(a.row.first_seen_at) || tie(a, b);
      case 'salary':
        return (
          nullsLast(
            a.row.salary_max ?? a.row.salary_min,
            b.row.salary_max ?? b.row.salary_min,
            -1,
          ) || tie(a, b)
        );
      case 'distance':
        return nullsLast(a.distance, b.distance, 1) || tie(a, b);
      default:
        return tie(a, b);
    }
  });
  return out;
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

export const SOURCE_SHORT: Record<string, string> = {
  faa: 'FAA',
  higherin: 'Higherin',
  reed: 'Reed',
  adzuna: 'Adzuna',
  employer: 'Employer',
  google_jobs: 'Google',
  web_search: 'Web',
  scot: 'Scotland',
  wales: 'Wales',
  ni: 'NI',
  amazing: 'Amazing',
  ngtu: 'NGTU',
};

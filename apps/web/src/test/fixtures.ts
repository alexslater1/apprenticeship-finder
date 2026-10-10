import type { ListingRow, RoleType, ScoreBreakdown, SettingsRow } from '@af/shared';

const ROLE_POINTS: Partial<Record<RoleType, number>> = {
  data_science: 45,
  ml_ai: 40,
  data_analyst: 38,
  data_engineering: 32,
  software_tech: 12,
};
const LEVEL_POINTS: Record<string, number> = { '4': 18, '5': 22, '6': 25, '7': 10 };

/** A breakdown that adds up to `total` with the usual role/level points. */
function breakdown(total: number, role: RoleType, level: number | null): ScoreBreakdown {
  const r = ROLE_POINTS[role] ?? 0;
  const l = LEVEL_POINTS[String(level)] ?? 10;
  return {
    role: r,
    level: l,
    degree: 0,
    specificity: total - r - l,
    freshness: 0,
    penalties: 0,
    penaltyLabels: [],
    total,
  };
}

export function listing(over: Partial<ListingRow> = {}): ListingRow {
  const score = over.score ?? 80;
  const role = over.role_type ?? 'data_science';
  const level = over.level === undefined ? 6 : over.level;
  return {
    id: over.id ?? 'id-1',
    dedupe_key: 'k',
    title: '2027 Data Science Apprentice - Crawley',
    employer_id: null,
    employer_name: 'Thales UK Limited',
    url: 'https://www.findapprenticeship.service.gov.uk/apprenticeship/reference/2000057249',
    apply_url: 'https://thales.wd3.myworkdayjobs.com/x',
    level: 6,
    level_source: 'source',
    is_degree: true,
    lars_code: 337,
    standard_title: 'Data scientist (integrated degree)',
    provider_name: 'University of Nottingham',
    university: null,
    role_type: 'data_science',
    score,
    score_breakdown: breakdown(score, role, level),
    salary_min: 24000,
    salary_max: null,
    salary_text: '£24,000 a year',
    posted_date: '2026-10-01',
    closing_date: '2027-02-17',
    start_date: '2027-09-01',
    locations: [
      {
        text: 'Crawley, RH10 9HA',
        city: 'Crawley',
        region: 'South East',
        nation: 'England',
        lat: 51.11,
        lon: -0.18,
      },
    ],
    primary_city: 'Crawley',
    region: 'South East',
    nation: 'England',
    is_national: false,
    first_seen_at: '2026-10-09T06:30:00Z',
    last_seen_at: '2026-10-09T06:30:00Z',
    is_active: true,
    closed_reason: null,
    status: 'none',
    hidden: false,
    hidden_at: null,
    applied_at: null,
    tracking_updated_at: null,
    sources: [{ source: 'faa', url: 'https://www.findapprenticeship.service.gov.uk/x' }],
    notes_count: 0,
    pre_register: false,
    is_lead: false,
    entry: null,
    start_precision: null,
    skills: [
      { id: 'python', ctx: 'taught' },
      { id: 'teamwork', ctx: 'asked' },
    ],
    ...over,
  };
}

export const settings: SettingsRow = {
  id: 1,
  home_postcode: 'LS1 4BN',
  home_lat: 53.7948,
  home_lon: -1.5537,
  role_prefs: { data_science: 'high', data_analyst: 'high', ml_ai: 'maybe', software_tech: 'no' },
  level_prefs: { '4': 'maybe', '5': 'high', '6': 'high', '7': 'maybe' },
  score_prefs: {},
  default_distance_miles: 50,
  digest_min_score: 40,
  digest_enabled: true,
  updated_at: '2026-10-09T00:00:00Z',
};

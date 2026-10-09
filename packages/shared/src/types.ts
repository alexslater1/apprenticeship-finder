export const ROLE_TYPES = [
  'data_science',
  'ml_ai',
  'data_analyst',
  'data_engineering',
  'software_tech',
  'business_analyst',
  'other',
] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

export const ROLE_LABELS: Record<RoleType, string> = {
  data_science: 'Data science',
  ml_ai: 'ML / AI',
  data_analyst: 'Data analyst',
  data_engineering: 'Data engineering',
  software_tech: 'Software / tech',
  business_analyst: 'Business analyst',
  other: 'Other',
};

export const NATIONS = [
  'England',
  'Scotland',
  'Wales',
  'Northern Ireland',
  'UK-wide',
  'Remote',
  'Unknown',
] as const;
export type Nation = (typeof NATIONS)[number];

export const TRACK_STATUSES = [
  'none',
  'saved',
  'applied',
  'interview',
  'offer',
  'rejected',
] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

export const STATUS_LABELS: Record<TrackStatus, string> = {
  none: 'Not tracked',
  saved: 'Saved',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

export interface Location {
  text: string;
  postcode?: string;
  lat?: number;
  lon?: number;
  city?: string;
  region?: string;
  nation?: Nation;
}

/** What every source/connector returns before normalisation (PLAN.md §6.1). */
export interface RawListing {
  source: string; // 'faa' | 'higherin' | ... | `employer:${id}`
  sourceId: string;
  url: string;
  applyUrl?: string;
  title: string;
  employerName: string;
  employerId?: string;
  descriptionHtml?: string;
  descriptionText?: string;
  level?: number;
  larsCode?: number;
  standardTitle?: string;
  providerName?: string;
  salaryText?: string;
  salaryMin?: number;
  salaryMax?: number;
  postedDate?: string; // ISO date
  closingDate?: string;
  startDate?: string;
  locations: Location[];
  isNational?: boolean;
  /** Source-specific facts shown on the detail page (duration, hours, qualifications…). */
  details?: Record<string, unknown>;
  /** Source says this is an apprenticeship regardless of title (FAA, Scot GA…). */
  knownApprenticeship?: boolean;
  /** Page-hash leads get their score capped. */
  isLead?: boolean;
  raw?: unknown;
}

export interface Standard {
  lars: number;
  ref: string;
  title: string;
  level: number;
  degree: boolean;
  role: RoleType;
  core: boolean;
}

export type RoleVia = 'title' | 'title_weak' | 'standard' | 'description';
export type LevelSource = 'source' | 'lars' | 'title' | 'text';

export interface Classification {
  isApprenticeship: boolean;
  noise: string | null;
  level: number | null;
  levelSource: LevelSource | null;
  isDegree: boolean | null;
  roleType: RoleType;
  roleVia: RoleVia | null;
  /** software_tech whose description talks about data (DTS data specialism etc.). */
  dataWordsInText: boolean;
  standard: Standard | null;
  /** Worth storing: a known standard, or the title/description points at a data/tech role. */
  relevant: boolean;
}

export interface ScoreBreakdown {
  role: number;
  level: number;
  degree: number;
  specificity: number;
  freshness: number;
  penalties: number;
  penaltyLabels: string[];
  total: number;
}

/** Row shape of the `v_listings` view used by the dashboard. */
export interface ListingRow {
  id: string;
  dedupe_key: string;
  title: string;
  employer_id: string | null;
  employer_name: string;
  url: string;
  apply_url: string | null;
  level: number | null;
  level_source: string | null;
  is_degree: boolean | null;
  lars_code: number | null;
  standard_title: string | null;
  provider_name: string | null;
  role_type: RoleType;
  score: number;
  score_breakdown: ScoreBreakdown | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_text: string | null;
  posted_date: string | null;
  closing_date: string | null;
  start_date: string | null;
  locations: Location[];
  primary_city: string | null;
  region: string | null;
  nation: Nation;
  is_national: boolean;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
  closed_reason: string | null;
  status: TrackStatus;
  hidden: boolean;
  hidden_at: string | null;
  applied_at: string | null;
  tracking_updated_at: string | null;
  sources: Array<{ source: string; url: string }>;
  notes_count: number;
}

export interface SettingsRow {
  id: 1;
  home_postcode: string | null;
  home_lat: number | null;
  home_lon: number | null;
  preferred_levels: number[];
  preferred_roles: RoleType[];
  default_distance_miles: number;
  digest_min_score: number;
  digest_enabled: boolean;
  updated_at: string;
}

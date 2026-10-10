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

/** How much he wants a role type or level (Settings). 'no' hides it everywhere. */
export const PREFS = ['high', 'maybe', 'no'] as const;
export type Pref = (typeof PREFS)[number];

export const PREF_LABELS: Record<Pref, string> = { high: 'High', maybe: 'Maybe', no: 'No' };

/** Levels we keep at all; 2–3 are dropped by the scraper. */
export const LEVELS = [4, 5, 6, 7] as const;
export const MIN_LEVEL = 4;

export type RolePrefs = Record<RoleType, Pref>;
export type LevelPrefs = Record<`${(typeof LEVELS)[number]}`, Pref>;

/** BRIEF.md: L6 and L5 first, then L4; data science and data analyst, maybe ML/AI. */
export const DEFAULT_ROLE_PREFS: RolePrefs = {
  data_science: 'high',
  data_analyst: 'high',
  ml_ai: 'maybe',
  data_engineering: 'maybe',
  software_tech: 'maybe',
  business_analyst: 'maybe',
  other: 'maybe',
};

export const DEFAULT_LEVEL_PREFS: LevelPrefs = {
  '4': 'maybe',
  '5': 'high',
  '6': 'high',
  '7': 'maybe',
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
  /** Raw address lines from the source; used for city detection, dropped before saving. */
  lines?: string[];
  postcode?: string;
  lat?: number;
  lon?: number;
  city?: string;
  region?: string;
  nation?: Nation;
  /** Country as the source gives it ('GB', 'United Kingdom', 'France'); non-UK jobs are dropped. */
  country?: string;
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
  /** Source says this is a degree apprenticeship (Scottish Graduate Apprenticeships). */
  isDegree?: boolean;
  /** Page-hash leads get their score capped. */
  isLead?: boolean;
  /** A source's own category, e.g. Higherin 'Data analysis'; used for role when the title says nothing. */
  roleHint?: string;
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

export type RoleVia = 'title' | 'title_weak' | 'standard' | 'category' | 'description';
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
  /** Degree partner named by the provider or the advert, e.g. 'University of Exeter'. */
  university: string | null;
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
  /** Higherin "Register your interest" advert: not open for applications yet. */
  pre_register: boolean;
  /** A line on a careers page ("applications open in November"), not a job advert. */
  is_lead: boolean;
  /** Entry requirements read from the advert (fit.ts `EntryReq`). */
  entry: { summary: string; ucas: number | null; subjects: string[] } | null;
}

/** Settings → "Your grades and start" and "What else counts" (all optional). */
export interface ScorePrefs {
  /** Predicted A-level grades, e.g. 'A*AB'. */
  predictedGrades?: string;
  /** His A-level subjects ('Maths', 'Computer Science', …). */
  subjects?: string[];
  /** ISO date: listings starting earlier rank lower (he's in Year 13 until summer 2027). */
  earliestStart?: string | null;
  universityWeight?: 'off' | 'some' | 'lots';
  preferDegree?: boolean;
  minSalary?: number | null;
  /** Starred employer ids. */
  favourites?: string[];
}

export interface SettingsRow {
  id: 1;
  home_postcode: string | null;
  home_lat: number | null;
  home_lon: number | null;
  role_prefs: Partial<RolePrefs>;
  level_prefs: Partial<LevelPrefs>;
  score_prefs: ScorePrefs;
  /** Null: anywhere in the UK (happy to move). */
  default_distance_miles: number | null;
  digest_min_score: number;
  digest_enabled: boolean;
  updated_at: string;
}

export const EMPLOYER_STATUSES = [
  'unknown',
  'open',
  'closed',
  'blocked',
  'error',
  'manual',
] as const;
export type EmployerStatus = (typeof EMPLOYER_STATUSES)[number];

/** Row shape of the `v_employers` view (Companies page). */
export interface EmployerRow {
  id: string;
  name: string;
  aliases: string[];
  origin: 'seed' | 'discovered' | 'manual';
  sector: string | null;
  relevance: 'core' | 'adjacent' | null;
  confidence: string | null;
  early_careers_url: string | null;
  job_search_url: string | null;
  ats_family: string | null;
  connector: string | null;
  manual_url: string | null;
  manual_reason: string | null;
  data_schemes: string[] | null;
  typical_window: string | null;
  opens_month: number | null;
  closes_month: number | null;
  locations: string[] | null;
  training_provider: string | null;
  watch: boolean;
  status: EmployerStatus;
  last_checked_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_total_jobs: number | null;
  last_apprentice_jobs: number | null;
  last_relevant_jobs: number | null;
  opened_at: string | null;
  notes_md: string | null;
  active_listings: number;
  next_closing: string | null;
  last_season_first_seen: string | null;
  last_season_closed: string | null;
  notes_count: number;
  /** Active register-interest pages (not counted in active_listings). */
  interest_listings: number;
}

export const SUGGESTION_STATUSES = ['pending', 'approved', 'dismissed', 'added'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export interface SuggestionEvidence {
  source: string;
  url?: string;
  title?: string;
  listing_id?: string;
  seen_at?: string;
  note?: string;
}

/** `employer_suggestions` (discovery queue, PLAN.md §6.5). */
export interface SuggestionRow {
  id: string;
  name: string | null;
  name_norm: string | null;
  careers_url: string | null;
  origin: 'listing' | 'google_jobs' | 'web_search' | 'lists' | 'ai' | 'manual';
  evidence: SuggestionEvidence[];
  detected_connector: string | null;
  detected_config: Record<string, unknown> | null;
  status: SuggestionStatus;
  auto: boolean;
  dismiss_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  employer_id: string | null;
  created_at: string;
  updated_at: string;
}

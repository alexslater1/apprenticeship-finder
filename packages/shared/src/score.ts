import { rules } from './config.ts';
import { daysBetween } from './dates.ts';
import {
  DEFAULT_LEVEL_PREFS,
  DEFAULT_ROLE_PREFS,
  type Classification,
  type LevelPrefs,
  type Pref,
  type RolePrefs,
  type RoleType,
  type ScoreBreakdown,
} from './types.ts';

export interface ScoreInput {
  title: string;
  descriptionText?: string;
  classification: Classification;
  /** ISO date the listing was posted (or first seen). */
  postedOrFirstSeen?: string | null;
  closingDate?: string | null;
  isLead?: boolean;
  /** ISO date treated as "today" (Europe/London); injectable for tests. */
  today: string;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Base relevance 0–100 (PLAN.md §7). Personal boosts are added in the UI. */
export function baseScore(input: ScoreInput): ScoreBreakdown {
  const p = rules.points;
  const c = input.classification;

  let role: number;
  if (c.roleVia === 'title_weak') role = p.weakTitleRole;
  else if (c.roleType === 'software_tech' && c.dataWordsInText) role = p.role.software_tech_data;
  else role = p.role[c.roleType];
  if (c.roleVia === 'description') role = Math.round(role * p.descriptionRoleFactor);

  const level = p.level[String(c.level)] ?? p.level.null ?? 0;
  const degree = c.isDegree ? p.degree : 0;
  const specificity =
    (c.roleVia === 'title' ? p.titleSpecific : 0) + (c.standard ? p.larsKnown : 0);
  const freshness =
    input.postedOrFirstSeen && daysBetween(input.postedOrFirstSeen, input.today) <= p.freshDays
      ? p.fresh
      : 0;

  let penalties = 0;
  const penaltyLabels: string[] = [];
  const haystack = `${input.title}\n${input.descriptionText ?? ''}`;
  for (const pen of rules.penalties) {
    // Admin/data-centre penalties only apply to the title; "internal only" anywhere.
    const target = pen.points <= -60 ? haystack : input.title;
    if (pen.re.test(target)) {
      penalties += pen.points;
      penaltyLabels.push(pen.label);
    }
  }
  if (input.closingDate && input.closingDate < input.today) {
    penalties += p.closingPassed;
    penaltyLabels.push('closing date passed');
  }

  let total = clamp(role + level + degree + specificity + freshness + penalties);
  if (input.isLead) total = Math.min(total, p.leadCap);
  return { role, level, degree, specificity, freshness, penalties, penaltyLabels, total };
}

export interface PersonalPrefs {
  roles: Partial<RolePrefs>;
  levels: Partial<LevelPrefs>;
  defaultDistanceMiles: number;
}

export function rolePref(prefs: PersonalPrefs, role: RoleType): Pref {
  return prefs.roles[role] ?? DEFAULT_ROLE_PREFS[role];
}

/** Null for an unknown level: those are never hidden or boosted. */
export function levelPref(prefs: PersonalPrefs, level: number | null): Pref | null {
  if (level === null) return null;
  const key = String(level) as keyof LevelPrefs;
  return prefs.levels[key] ?? DEFAULT_LEVEL_PREFS[key] ?? 'maybe';
}

/** Why a listing is hidden by the Settings preferences ('No' role or level), or null. */
export function excludedByPrefs(
  listing: { level: number | null; role_type: RoleType },
  prefs: PersonalPrefs,
): 'role' | 'level' | null {
  if (rolePref(prefs, listing.role_type) === 'no') return 'role';
  if (levelPref(prefs, listing.level) === 'no') return 'level';
  return null;
}

/**
 * The score shown to him: the base score with its role and level points swapped for ones from
 * his Settings ('High' roles and levels outrank 'Maybe' ones), plus a bonus within his distance.
 * Role points keep the base score's confidence (a title match counts more than a weak one).
 */
export function personalScore(
  listing: {
    score: number;
    level: number | null;
    role_type: RoleType;
    score_breakdown?: ScoreBreakdown | null;
  },
  prefs: PersonalPrefs,
  distanceMiles: number | null,
  opts: { clamp?: boolean } = {},
): number {
  if (listing.score <= 0) return 0;
  const w = rules.personal;
  const b = listing.score_breakdown;
  let s = listing.score;
  if (b) {
    const p = rules.points;
    const full =
      listing.role_type === 'software_tech' ? p.role.software_tech_data : p.role[listing.role_type];
    const confidence = full > 0 ? Math.min(1, b.role / full) : 0;
    const lp = levelPref(prefs, listing.level);
    const role = w.role[rolePref(prefs, listing.role_type) === 'high' ? 'high' : 'maybe'];
    const level = lp === null ? (p.level.null ?? 0) : w.level[lp === 'high' ? 'high' : 'maybe'];
    const raw = b.role + b.level + b.degree + b.specificity + b.freshness + b.penalties;
    s = raw - b.role - b.level + Math.round(role * confidence) + level;
    // A capped base score (leads) stays capped.
    if (b.total < clamp(raw)) s = Math.min(s, b.total);
    if (s <= 0) return 0;
  }
  if (distanceMiles !== null && distanceMiles <= prefs.defaultDistanceMiles) s += w.withinDistance;
  // Unclamped values keep the ranking when several listings pass 100.
  return opts.clamp === false ? s : clamp(s);
}

export type MatchTier = 'high' | 'medium' | 'low';

export function matchTier(score: number): MatchTier {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

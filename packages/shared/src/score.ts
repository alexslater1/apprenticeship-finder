import { rules } from './config.ts';
import { daysBetween } from './dates.ts';
import type { Classification, RoleType, ScoreBreakdown } from './types.ts';

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
  preferredLevels: number[];
  preferredRoles: RoleType[];
  defaultDistanceMiles: number;
}

/** Base score + boosts from the shared settings row. */
export function personalScore(
  listing: { score: number; level: number | null; role_type: RoleType },
  prefs: PersonalPrefs,
  distanceMiles: number | null,
): number {
  const b = rules.personal;
  let s = listing.score;
  if (listing.score <= 0) return 0;
  if (listing.level !== null && prefs.preferredLevels.includes(listing.level))
    s += b.preferredLevel;
  if (prefs.preferredRoles.includes(listing.role_type)) s += b.preferredRole;
  if (distanceMiles !== null && distanceMiles <= prefs.defaultDistanceMiles) s += b.withinDistance;
  return clamp(s);
}

export type MatchTier = 'high' | 'medium' | 'low';

export function matchTier(score: number): MatchTier {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

import { SKILL_BY_ID, SKILLS, type SkillCategory, type SkillContext } from '@af/shared';
import type { Derived } from './derive';

export interface SkillStat {
  id: string;
  label: string;
  category: SkillCategory;
  blurb?: string;
  /** Share of the (weighted) adverts that mention it, 0–1. */
  share: number;
  /** How many adverts mention it. */
  count: number;
  asked: number;
  taught: number;
  job: number;
  /** The adverts behind it, best match first. */
  listings: Array<{ d: Derived; ctx: SkillContext }>;
}

export interface SkillRanking {
  stats: SkillStat[];
  /** Adverts with enough description to read skills from. */
  basis: number;
  /** Live adverts left out because their description is a summary or missing. */
  skipped: number;
}

/** The adverts that count: live, not hidden by him or by a "No" preference, not interest pages. */
function inPool(d: Derived): boolean {
  return d.row.is_active && !d.excluded && !d.row.hidden && !d.row.pre_register && !d.row.is_lead;
}

/**
 * Every skill's share of the adverts, each advert weighted by its match score (so a skill the
 * best-fitting adverts mention ranks above one only poor fits mention). `weighted: false`
 * counts every advert the same.
 */
export function rankSkills(derived: Derived[], { weighted = true } = {}): SkillRanking {
  const pool = derived.filter(inPool);
  const basis = pool.filter((d) => d.row.skills !== null && d.row.skills !== undefined);
  const weight = (d: Derived) => (weighted ? d.score : 1);
  const total = basis.reduce((n, d) => n + weight(d), 0);
  const byId = new Map<string, SkillStat>();
  for (const d of basis) {
    for (const m of d.row.skills ?? []) {
      const def = SKILL_BY_ID[m.id];
      if (!def) continue; // removed from the dictionary since the advert was tagged
      let s = byId.get(m.id);
      if (!s) {
        s = {
          id: def.id,
          label: def.label,
          category: def.category,
          blurb: def.blurb,
          share: 0,
          count: 0,
          asked: 0,
          taught: 0,
          job: 0,
          listings: [],
        };
        byId.set(m.id, s);
      }
      s.share += weight(d);
      s.count++;
      s[m.ctx]++;
      s.listings.push({ d, ctx: m.ctx });
    }
  }
  const order = new Map(SKILLS.map((s, i) => [s.id, i]));
  const stats = [...byId.values()]
    .map((s) => ({
      ...s,
      share: total > 0 ? s.share / total : 0,
      listings: s.listings.sort((a, b) => b.d.rank - a.d.rank),
    }))
    .sort((a, b) => b.share - a.share || b.count - a.count || order.get(a.id)! - order.get(b.id)!);
  return { stats, basis: basis.length, skipped: pool.length - basis.length };
}

/** Whether a skill is mostly something they ask for, teach, or just part of the job. */
export function mostly(s: Pick<SkillStat, 'asked' | 'taught' | 'job'>): SkillContext {
  if (s.asked >= s.taught && s.asked >= s.job) return 'asked';
  return s.taught >= s.job ? 'taught' : 'job';
}

export const CONTEXT_LABELS: Record<SkillContext, string> = {
  asked: 'Asked for',
  taught: 'Taught',
  job: 'Part of the job',
};

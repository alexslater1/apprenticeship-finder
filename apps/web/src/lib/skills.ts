import { SKILL_BY_ID, SKILLS, type SkillCategory, type SkillContext } from '@af/shared';
import type { Derived } from './derive';

/**
 * How an advert treats a skill, as the page shows it: asked for (have it already), or not
 * required (the training covers it, or it's just one of the duties). The tags keep the finer
 * taught / part-of-the-job split; Alex found the difference not worth showing.
 */
export type SkillKind = 'asked' | 'not_required';

export const SKILL_KINDS = ['asked', 'not_required'] as const;

export const kindOf = (ctx: SkillContext): SkillKind =>
  ctx === 'asked' ? 'asked' : 'not_required';

export interface SkillStat {
  id: string;
  label: string;
  category: SkillCategory;
  blurb?: string;
  /** Share of the (weighted) adverts that mention it, 0–1. */
  share: number;
  /** The same share split by kind (adds up to `share`). */
  byKind: Record<SkillKind, number>;
  /** How many adverts mention it, and how many of each kind. */
  count: number;
  asked: number;
  not_required: number;
  /** The adverts behind it, best match first. */
  listings: Array<{ d: Derived; kind: SkillKind }>;
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
 * counts every advert the same; `kind` counts only mentions of that kind (just what's asked for).
 */
export function rankSkills(
  derived: Derived[],
  { weighted = true, kind }: { weighted?: boolean; kind?: SkillKind } = {},
): SkillRanking {
  const pool = derived.filter(inPool);
  const basis = pool.filter((d) => d.row.skills !== null && d.row.skills !== undefined);
  const weight = (d: Derived) => (weighted ? d.score : 1);
  const total = basis.reduce((n, d) => n + weight(d), 0);
  const byId = new Map<string, SkillStat>();
  for (const d of basis) {
    for (const m of d.row.skills ?? []) {
      const k = kindOf(m.ctx);
      if (kind && k !== kind) continue;
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
          byKind: { asked: 0, not_required: 0 },
          count: 0,
          asked: 0,
          not_required: 0,
          listings: [],
        };
        byId.set(m.id, s);
      }
      s.share += weight(d);
      s.byKind[k] += weight(d);
      s.count++;
      s[k]++;
      s.listings.push({ d, kind: k });
    }
  }
  const frac = (n: number) => (total > 0 ? n / total : 0);
  const order = new Map(SKILLS.map((s, i) => [s.id, i]));
  const stats = [...byId.values()]
    .map((s) => ({
      ...s,
      share: frac(s.share),
      byKind: { asked: frac(s.byKind.asked), not_required: frac(s.byKind.not_required) },
      listings: s.listings.sort((a, b) => b.d.rank - a.d.rank),
    }))
    .sort((a, b) => b.share - a.share || b.count - a.count || order.get(a.id)! - order.get(b.id)!);
  return { stats, basis: basis.length, skipped: pool.length - basis.length };
}

/** Whether a skill is mostly asked for or mostly not required. */
export function mostly(s: Pick<SkillStat, 'asked' | 'not_required'>): SkillKind {
  return s.asked >= s.not_required ? 'asked' : 'not_required';
}

export const KIND_LABELS: Record<SkillKind, string> = {
  asked: 'Asked for',
  not_required: 'Not required',
};

/** What each kind means, for the key on the Skills page. */
export const KIND_HINTS: Record<SkillKind, string> = {
  asked:
    'listed as something to have already, even if only “useful” (“you’ll need…”, “experience with… would be an advantage”)',
  not_required:
    'not asked for beforehand: the training covers it (“you’ll learn…”, “training provided”) or it’s one of the duties (“what you’ll do…”)',
};

/** Bar and dot colours, shared by the page and its key. */
export const KIND_COLOURS: Record<SkillKind, string> = {
  asked: 'bg-amber-500',
  not_required: 'bg-sky-500',
};

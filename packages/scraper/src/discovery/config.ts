import { readFileSync } from 'node:fs';
import { normaliseEmployerName } from '@af/shared';
import { z } from 'zod';
import { REPO_ROOT } from '../env.ts';
import type { Ctx } from '../types.ts';
import type { Detection } from '../connectors/detect.ts';

/** config/discovery.json (queries, budgets, names that are never employers). */
const Config = z.object({
  googleJobs: z.object({
    monthlyBudget: z.number(),
    dateFilter: z.string(),
    queries: z.array(z.string()),
    weeklyQueries: z.array(z.string()).default([]),
  }),
  tavily: z.object({
    monthlyBudget: z.number(),
    maxPageFetches: z.number(),
    excludeDomains: z.array(z.string()).default([]),
    queries: z.array(
      z.object({ query: z.string(), include_domains: z.array(z.string()).optional() }),
    ),
  }),
  ignoreEmployers: z.array(z.string()),
  /** Names that are providers or boards, not employers ('University of X: Apprenticeships'). */
  ignoreNamePattern: z.string().optional(),
  aggregatorHosts: z.array(z.string()),
});
export type DiscoveryConfig = z.infer<typeof Config>;

let cached: DiscoveryConfig | undefined;
export function discoveryConfig(): DiscoveryConfig {
  cached ??= Config.parse(JSON.parse(readFileSync(`${REPO_ROOT}config/discovery.json`, 'utf8')));
  return cached;
}

/** Names never to suggest: job boards, "Unknown employer", and the seed's checked-and-excluded list. */
export function ignoredNames(): Set<string> {
  const excluded = JSON.parse(
    readFileSync(`${REPO_ROOT}config/employers.excluded.json`, 'utf8'),
  ) as Array<{ name: string }>;
  return new Set(
    [...discoveryConfig().ignoreEmployers, ...excluded.map((e) => e.name)].map(
      normaliseEmployerName,
    ),
  );
}

export function ignoredName(name: string): boolean {
  const p = discoveryConfig().ignoreNamePattern;
  return !!p && new RegExp(p, 'i').test(name);
}

export function isAggregator(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return discoveryConfig().aggregatorHosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return true;
  }
}

/**
 * Monthly search budget kept in source_state (`budget:serpapi`, `budget:tavily`). Returns false
 * (and spends nothing) when the next search would go over.
 */
export async function spend(ctx: Ctx, key: string, limit: number, cost = 1): Promise<boolean> {
  const month = ctx.today.slice(0, 7);
  const b = (await ctx.state.get<{ month: string; used: number }>(key)) ?? { month, used: 0 };
  const used = b.month === month ? b.used : 0;
  if (used + cost > limit) return false;
  await ctx.state.set(key, { month, used: used + cost, limit });
  return true;
}

/** A company worth watching that the run came across (D1–D3, PLAN.md §6.5). */
export interface SuggestionInput {
  name: string;
  origin: 'listing' | 'google_jobs' | 'web_search' | 'lists' | 'ai' | 'manual';
  careersUrl?: string;
  evidence: { source: string; url?: string; title?: string; listing_id?: string; seen_at: string };
  detected?: Detection | null;
  /** The job board a page sits on, used only to skip boards we already watch (never auto-watched). */
  board?: Detection | null;
}

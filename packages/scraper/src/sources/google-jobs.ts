import { createHash } from 'node:crypto';
import { collapseSpaces, normaliseEmployerName, type RawListing } from '@af/shared';
import { z } from 'zod';
import { discoveryConfig, ignoredNames, isAggregator, spend } from '../discovery/config.ts';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * Google for Jobs via SerpApi (PLAN.md §6.5 D1, research/discovery.md): Google indexes JobPosting
 * markup from nearly every careers site and ATS, so a handful of searches a day finds adverts
 * at companies we don't watch. First page of each query only; monthly budget in source_state.
 */

const Job = z
  .object({
    title: z.string(),
    company_name: z.string().nullish(),
    location: z.string().nullish(),
    via: z.string().nullish(),
    description: z.string().nullish(),
    extensions: z.array(z.string()).nullish(),
    job_id: z.string().nullish(),
    share_link: z.string().nullish(),
    apply_options: z
      .array(z.object({ title: z.string().nullish(), link: z.string() }).loose())
      .nullish(),
  })
  .loose();
type Job = z.infer<typeof Job>;

const Body = z
  .object({ error: z.string().nullish(), jobs_results: z.array(z.unknown()).nullish() })
  .loose();

/** "5 days ago" / "21 hours ago" → ISO date. */
export function agoToDate(ext: string[] | null | undefined, today: string): string | undefined {
  for (const e of ext ?? []) {
    const m = /^(\d+)\+?\s+(hour|day|week|month)s?\s+ago$/i.exec(e.trim());
    if (!m) continue;
    const n = Number(m[1]);
    const days = { hour: 0, day: n, week: n * 7, month: n * 30 }[m[2]!.toLowerCase() as 'day'];
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }
  return undefined;
}

export function toRawListing(j: Job, today: string): RawListing | null {
  const company = j.company_name?.trim();
  if (!company || ignoredNames().has(normaliseEmployerName(company))) return null;
  const links = (j.apply_options ?? []).map((a) => a.link);
  // Prefer the employer's own careers site / ATS over the boards Google copied it from.
  const own = links.find((l) => !isAggregator(l));
  const url = own ?? links[0] ?? j.share_link;
  if (!url) return null;
  const location = j.location?.replace(/\s*\(\+\d+ others?\)\s*$/, '').trim();
  return {
    source: 'google_jobs',
    sourceId: createHash('sha1')
      .update(
        `${normaliseEmployerName(company)}|${j.title.toLowerCase()}|${(location ?? '').toLowerCase()}`,
      )
      .digest('hex')
      .slice(0, 20),
    url,
    applyUrl: own,
    title: collapseSpaces(j.title),
    employerName: company,
    descriptionText: j.description ?? undefined,
    postedDate: agoToDate(j.extensions, today),
    locations: location && !/^anywhere$/i.test(location) ? [{ text: location }] : [],
    details: { via: j.via ?? undefined },
    raw: { ...j, description: undefined, job_id: undefined },
  };
}

export const googleJobs: Source = {
  id: 'google_jobs',
  incremental: true,
  enabled: (env) => !!env.SERPAPI_KEY,
  async run(ctx: Ctx): Promise<SourceResult> {
    const cfg = discoveryConfig().googleJobs;
    const monday = new Date(`${ctx.today}T12:00:00Z`).getUTCDay() === 1;
    let queries = [...cfg.queries, ...(monday ? cfg.weeklyQueries : [])];
    if (ctx.dryRun) queries = queries.slice(0, 1); // each search costs real budget
    const found = new Map<string, RawListing>();
    let searched = 0;
    let budgetStop = 'no';
    let errors = 0;
    for (const q of queries) {
      if (!(await spend(ctx, 'budget:serpapi', cfg.monthlyBudget))) {
        budgetStop = 'yes';
        break;
      }
      const params = new URLSearchParams({
        engine: 'google_jobs',
        q: q + cfg.dateFilter,
        location: 'United Kingdom',
        gl: 'uk',
        hl: 'en',
        api_key: ctx.env.SERPAPI_KEY!,
      });
      try {
        const body = Body.parse(await ctx.http.json(`https://serpapi.com/search.json?${params}`));
        searched++;
        if (body.error && !/hasn't returned any results/i.test(body.error))
          throw new Error(body.error);
        for (const item of body.jobs_results ?? []) {
          const r = Job.safeParse(item);
          const l = r.success ? toRawListing(r.data, ctx.today) : null;
          if (l) found.set(l.sourceId, l);
        }
      } catch (err) {
        errors++;
        ctx.log.warn(`query "${q}": ${(err as Error).message}`);
      }
    }
    if (errors && errors === queries.length) throw new Error('every Google Jobs query failed');
    return {
      listings: [...found.values()],
      complete: false,
      stats: { queries: searched, results: found.size, errors, budgetStop },
    };
  },
};

import { collapseSpaces, decodeEntities, parseDate, type RawListing } from '@af/shared';
import { z } from 'zod';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * Adzuna API (research/job-sites.md §A1). Free tier: 25/min, 250/day; we use ≤ 16 a day.
 * Adzuna's search treats "apprentice" and "intern" as near-synonyms, so the classifier (which
 * needs "apprentic" in the title) does the real filtering. Terms: personal research use, and
 * every displayed Adzuna ad must carry an "Adzuna" label linked to adzuna.co.uk (see the UI).
 */
const BASE = 'https://api.adzuna.com/v1/api/jobs/gb/search';
const STATE_KEY = 'adzuna:last_ok';

export const QUERIES = [
  'data apprentice',
  'data science apprentice',
  'data engineer apprentice',
  'analyst apprentice',
  'AI apprentice',
  'machine learning apprentice',
  'degree apprentice',
  'software apprentice',
];

const Job = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string(),
    description: z.string().nullish(),
    created: z.string().nullish(),
    redirect_url: z.string(),
    salary_min: z.number().nullish(),
    salary_max: z.number().nullish(),
    salary_is_predicted: z.union([z.string(), z.number()]).nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
    location: z
      .object({ display_name: z.string().nullish(), area: z.array(z.string()).nullish() })
      .loose()
      .nullish(),
    company: z.object({ display_name: z.string().nullish() }).loose().nullish(),
    category: z.object({ label: z.string().nullish() }).loose().nullish(),
    contract_type: z.string().nullish(),
    contract_time: z.string().nullish(),
  })
  .loose();
type Job = z.infer<typeof Job>;

const Page = z.object({ count: z.number().optional(), results: z.array(z.unknown()) });

export function toRawListing(j: Job): RawListing {
  // Adzuna fills in estimated salaries; only keep real ones.
  const realSalary = String(j.salary_is_predicted ?? '0') === '0';
  const where = j.location?.display_name?.trim();
  return {
    source: 'adzuna',
    sourceId: j.id,
    url: j.redirect_url,
    title: collapseSpaces(decodeEntities(j.title)),
    employerName: collapseSpaces(decodeEntities(j.company?.display_name ?? 'Unknown employer')),
    descriptionText: j.description ? collapseSpaces(decodeEntities(j.description)) : undefined,
    salaryMin: realSalary && j.salary_min ? Math.round(j.salary_min) : undefined,
    salaryMax:
      realSalary && j.salary_max && j.salary_max !== j.salary_min
        ? Math.round(j.salary_max)
        : undefined,
    postedDate: parseDate(j.created) ?? undefined,
    locations:
      where && !/^uk$/i.test(where)
        ? [{ text: where, lat: j.latitude ?? undefined, lon: j.longitude ?? undefined }]
        : [],
    details: {
      contract: [j.contract_type, j.contract_time].filter(Boolean).join(', ') || undefined,
      category: j.category?.label ?? undefined,
    },
    raw: j,
  };
}

export const adzuna: Source = {
  id: 'adzuna',
  incremental: true,
  enabled: (env) => !!env.ADZUNA_APP_ID && !!env.ADZUNA_APP_KEY,
  async run(ctx: Ctx): Promise<SourceResult> {
    const lastOk = await ctx.state.get<string>(STATE_KEY);
    // Look back far enough to cover missed days, at least 3 and at most 30.
    const days = lastOk
      ? Math.min(
          30,
          Math.max(3, Math.ceil((Date.parse(ctx.today) - Date.parse(lastOk)) / 86_400_000) + 2),
        )
      : 30;
    const pages = days > 7 ? 2 : 1;
    const seen = new Map<string, Job>();
    let calls = 0;
    let errors = 0;
    for (const q of QUERIES) {
      for (let page = 1; page <= pages; page++) {
        const params = new URLSearchParams({
          app_id: ctx.env.ADZUNA_APP_ID!,
          app_key: ctx.env.ADZUNA_APP_KEY!,
          title_only: q,
          max_days_old: String(days),
          results_per_page: '50',
          sort_by: 'date',
        });
        try {
          calls++;
          const body = Page.parse(await ctx.http.json(`${BASE}/${page}?${params}`));
          for (const r of body.results) {
            const j = Job.safeParse(r);
            if (j.success) seen.set(j.data.id, j.data);
          }
          if ((body.count ?? 0) <= page * 50) break;
        } catch (err) {
          errors++;
          // Don't log the URL: it carries the key.
          ctx.log.warn(
            `query "${q}" page ${page}: ${(err as Error).message.replace(/app_key=[^&\s]+/g, 'app_key=…')}`,
          );
          break;
        }
      }
    }
    if (errors < QUERIES.length) await ctx.state.set(STATE_KEY, ctx.today);
    if (errors === QUERIES.length) throw new Error('every Adzuna query failed');
    return {
      listings: [...seen.values()].map(toRawListing),
      complete: false,
      stats: { days, calls, errors, results: seen.size },
    };
  },
};

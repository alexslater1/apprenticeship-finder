import { classify, collapseSpaces, decodeEntities, parseDate, type RawListing } from '@af/shared';
import { z } from 'zod';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * Reed Jobseeker API (research/job-sites.md §A2): HTTP Basic with the key as username.
 * Field names follow Reed's docs; not yet checked against a live response (no key yet), so
 * parsing is lenient and the source stays off until REED_API_KEY is set.
 */
const BASE = 'https://www.reed.co.uk/api/1.0';

export const QUERIES = [
  'data apprentice',
  'data analyst apprenticeship',
  'data science apprenticeship',
  'data engineer apprenticeship',
  'AI apprentice',
  'machine learning apprentice',
  'degree apprenticeship data',
];

const Result = z
  .object({
    jobId: z.union([z.number(), z.string()]).transform(String),
    employerName: z.string().nullish(),
    jobTitle: z.string(),
    locationName: z.string().nullish(),
    minimumSalary: z.number().nullish(),
    maximumSalary: z.number().nullish(),
    expirationDate: z.string().nullish(),
    date: z.string().nullish(),
    jobDescription: z.string().nullish(),
    jobUrl: z.string().nullish(),
  })
  .loose();
type Result = z.infer<typeof Result>;

const Detail = Result.extend({
  externalUrl: z.string().nullish(),
  datePosted: z.string().nullish(),
  salary: z.string().nullish(),
  contractType: z.string().nullish(),
  jobType: z.string().nullish(),
  salaryType: z.string().nullish(),
  yearlyMinimumSalary: z.number().nullish(),
  yearlyMaximumSalary: z.number().nullish(),
});
type Detail = z.infer<typeof Detail>;

/** Reed dates are UK style dd/mm/yyyy. */
export function reedDate(s: string | null | undefined): string | undefined {
  const m = s ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s.trim()) : null;
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return parseDate(s) ?? undefined;
}

export function toRawListing(r: Result, d?: Detail): RawListing {
  const full = d ?? r;
  const html = d?.jobDescription && /<[a-z]/i.test(d.jobDescription) ? d.jobDescription : undefined;
  const min = d?.yearlyMinimumSalary ?? full.minimumSalary ?? undefined;
  const max = d?.yearlyMaximumSalary ?? full.maximumSalary ?? undefined;
  return {
    source: 'reed',
    sourceId: r.jobId,
    url: full.jobUrl || `https://www.reed.co.uk/jobs/${r.jobId}`,
    applyUrl: d?.externalUrl || undefined,
    title: collapseSpaces(decodeEntities(r.jobTitle)),
    employerName: collapseSpaces(decodeEntities(full.employerName ?? 'Unknown employer')),
    descriptionHtml: html,
    descriptionText: html
      ? undefined
      : full.jobDescription
        ? collapseSpaces(decodeEntities(full.jobDescription))
        : undefined,
    salaryMin: min ? Math.round(min) : undefined,
    salaryMax: max && max !== min ? Math.round(max) : undefined,
    salaryText: d?.salary ?? undefined,
    postedDate: reedDate(d?.datePosted ?? r.date),
    closingDate: reedDate(full.expirationDate),
    locations: full.locationName ? [{ text: full.locationName }] : [],
    details: { contract: [d?.contractType, d?.jobType].filter(Boolean).join(', ') || undefined },
    raw: { ...r, ...(d ? { detail: { ...d, jobDescription: undefined } } : {}) },
  };
}

export const reed: Source = {
  id: 'reed',
  incremental: true,
  enabled: (env) => !!env.REED_API_KEY,
  async run(ctx: Ctx): Promise<SourceResult> {
    const auth = {
      Authorization: `Basic ${Buffer.from(`${ctx.env.REED_API_KEY}:`).toString('base64')}`,
    };
    const found = new Map<string, Result>();
    let errors = 0;
    for (const q of QUERIES) {
      try {
        const body = z
          .object({ results: z.array(z.unknown()) })
          .parse(
            await ctx.http.json(
              `${BASE}/search?${new URLSearchParams({ keywords: q, resultsToTake: '100' })}`,
              { headers: auth },
            ),
          );
        for (const item of body.results) {
          const r = Result.safeParse(item);
          if (r.success) found.set(r.data.jobId, r.data);
        }
      } catch (err) {
        errors++;
        ctx.log.warn(`query "${q}": ${(err as Error).message}`);
      }
    }
    if (errors === QUERIES.length) throw new Error('every Reed query failed');

    // Reed search is very noisy (coaches, assessors); only spend detail calls on likely keepers.
    const keepers = [...found.values()].filter((r) => classify({ title: r.jobTitle }).relevant);
    const known = await ctx.knownSourceIds('reed');
    const listings: RawListing[] = [];
    let detailed = 0;
    for (const r of keepers) {
      let d: Detail | undefined;
      if (!known.has(r.jobId)) {
        try {
          d = Detail.parse(await ctx.http.json(`${BASE}/jobs/${r.jobId}`, { headers: auth }));
          detailed++;
        } catch (err) {
          ctx.log.warn(`detail ${r.jobId}: ${(err as Error).message}`);
        }
      }
      listings.push(toRawListing(r, d));
    }
    return {
      listings,
      complete: false,
      stats: { results: found.size, kept: keepers.length, detailFetched: detailed, errors },
    };
  },
};

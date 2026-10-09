import { parseDate, type Location } from '@af/shared';
import { z } from 'zod';
import { htmlToText } from '../pipeline/normalise.ts';
import { employerListing, isCandidateTitle, isUk, parseJobPosting, withDetails } from './common.ts';
import { defineConnector } from './types.ts';

/**
 * Phenom "TXM" career sites (research §16): POST `/widgets` with `ddoKey: refineSearch`, 100 a
 * page. The country filter is leaky at some tenants (Mars, Allianz), so locations are checked
 * again here. Job pages carry JSON-LD with the full description.
 */
const Config = z.object({
  host: z.string(),
  cc: z.string(),
  lang: z.string(),
  pageId: z.string(),
  /** Widget `lang`, e.g. 'en_gb' (default `${lang}_${cc}`). */
  locale: z.string().optional(),
  /** Value of the country facet ('United Kingdom'; Ageas uses 'UK'); omit for all jobs. */
  countryValue: z.string().optional(),
});

const SIZE = 100;
const MAX_PAGES = 15;

const Job = z
  .object({
    jobId: z.union([z.string(), z.number()]).transform(String),
    title: z.string(),
    location: z.string().nullish(),
    country: z.string().nullish(),
    multi_location: z.array(z.string()).nullish(),
    postedDate: z.string().nullish(),
    applyUrl: z.string().nullish(),
    descriptionTeaser: z.string().nullish(),
  })
  .loose();
type Job = z.infer<typeof Job>;

const Body = z
  .object({
    refineSearch: z
      .object({
        totalHits: z.number().nullish(),
        data: z.object({ jobs: z.array(z.unknown()).nullish() }).loose().nullish(),
      })
      .loose(),
  })
  .loose();

function jobLocations(j: Job): Location[] {
  const all = j.multi_location?.length ? j.multi_location : j.location ? [j.location] : [];
  return all.map((text) => ({ text, country: /,\s*([^,]+)$/.exec(text)?.[1]?.trim() }));
}

export const phenom = defineConnector({
  id: 'phenom',
  config: Config,
  async run(c, ctx) {
    const jobs: Job[] = [];
    let total: number | null = null;
    let full = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = Body.parse(
        await ctx.http.json(`https://${c.host}/widgets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          robots: true,
          body: JSON.stringify({
            lang: c.locale ?? `${c.lang}_${c.cc}`,
            deviceType: 'desktop',
            country: c.cc,
            pageName: 'search-results',
            ddoKey: 'refineSearch',
            from: page * SIZE,
            size: SIZE,
            jobs: true,
            counts: false,
            pageId: c.pageId,
            siteType: 'external',
            keywords: '',
            global: true,
            selected_fields: c.countryValue ? { country: [c.countryValue] } : {},
          }),
        }),
      );
      if (page === 0) total = body.refineSearch.totalHits ?? null;
      const batch = (body.refineSearch.data?.jobs ?? []).map((j) => Job.safeParse(j)).filter((r) => r.success);
      jobs.push(...batch.map((r) => r.data));
      if (batch.length < SIZE || (total !== null && jobs.length >= total)) {
        full = true;
        break;
      }
    }
    const candidates = jobs.filter((j) => isCandidateTitle(j.title));
    const url = (j: Job) => `https://${c.host}/${c.cc}/${c.lang}/job/${j.jobId}`;
    const base = (j: Job) =>
      employerListing(ctx, {
        sourceId: j.jobId,
        url: url(j),
        applyUrl: j.applyUrl ?? undefined,
        title: j.title,
        descriptionText: j.descriptionTeaser ?? undefined,
        postedDate: parseDate(j.postedDate) ?? undefined,
        locations: jobLocations(j),
        raw: { ...j, ml_job_parser: undefined, ml_skills: undefined },
      });
    const { listings, detailed, errors } = await withDetails(ctx, candidates, {
      id: (j) => j.jobId,
      sig: (j) => j.title,
      detail: async (j) => {
        const p = parseJobPosting(await ctx.http.text(url(j), { robots: true }));
        const b = base(j);
        return {
          ...b,
          descriptionHtml: p?.descriptionHtml,
          descriptionText: p?.descriptionHtml ? htmlToText(p.descriptionHtml) : b.descriptionText,
          closingDate: p?.closingDate,
        };
      },
      fallback: base,
    });
    const uk = listings.filter((l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false));
    return {
      jobs: uk,
      total,
      complete: full && errors === 0,
      stats: { listed: jobs.length, candidates: candidates.length, detailed },
    };
  },
  detect(url, html) {
    if (!/phApp\.ddo|phenom/i.test(html ?? '')) return null;
    const m = /\/\/([\w.-]+)\/([a-z]{2,6})\/([a-z]{2})\//.exec(url);
    const pageId = /"pageId"\s*:\s*"(page\d+)"/.exec(html ?? '')?.[1];
    return m ? { host: m[1], cc: m[2], lang: m[3], pageId } : null;
  },
});

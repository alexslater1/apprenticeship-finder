import { parseDate, type RawListing } from '@af/shared';
import { z } from 'zod';
import { htmlToText } from '../pipeline/normalise.ts';
import { employerListing, isCandidateTitle, isUk } from './common.ts';
import { defineConnector, type ConnectorResult } from './types.ts';

/**
 * Employer-specific feeds found during the 2026-10-09 employer checks, where the employer's own
 * careers front-end exposes a cleaner JSON feed than its ATS (or the ATS is unreachable).
 */

function finish(all: RawListing[], total = all.length, complete = true): ConnectorResult {
  const uk = all.filter((l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false));
  const jobs = uk.filter((l) => l.knownApprenticeship || isCandidateTitle(l.title));
  return { jobs, total, complete, stats: { listed: all.length, uk: uk.length, candidates: jobs.length } };
}

const desc = (h: string | null | undefined) => (h ? { descriptionHtml: h, descriptionText: htmlToText(h) } : {});

/** careers.sky.com/jobs embeds every UK job in its Next.js payload (79 of 80 apply via Sky's talent community, not Workday). */
export const skycareers = defineConnector({
  id: 'skycareers',
  config: z.object({ url: z.string() }),
  async run(c, ctx) {
    const page = (await ctx.http.text(c.url, { robots: true })).replace(/\\"/g, '"');
    const jobs = new Map<string, RawListing>();
    const re =
      /\{"id":"(\d+)","title":"([^"]+)","team":"([^"]*)","contract":"([^"]*)","location":"([^"]*)","description":"([^"]*)","application_link":"([^"]+)"/g;
    for (const m of page.matchAll(re)) {
      const [, id, title, team, contract, location, description, link] = m;
      jobs.set(
        id!,
        employerListing(ctx, {
          sourceId: id!,
          url: link!.replace(/\\u0026/g, '&'),
          title: title!,
          descriptionText: description ? JSON.parse(`"${description}"`) : undefined,
          locations: location ? [{ text: location }] : [],
          details: { team: team || undefined, contract: contract || undefined },
        }),
      );
    }
    if (!jobs.size) throw new Error('no jobs found in the careers page payload (layout changed?)');
    return finish([...jobs.values()]);
  },
});

/** Capgemini's careers search API (indexes its SuccessFactors jobs, UK-only with country_code). */
export const cgJobstream = defineConnector({
  id: 'cg-jobstream',
  config: z.object({ apiBase: z.string(), countryCode: z.string() }),
  async run(c, ctx) {
    const Page = z
      .object({
        total: z.number().nullish(),
        count: z.number().nullish(),
        data: z.array(
          z
            .object({
              id: z.string(),
              ref: z.string().nullish(),
              title: z.string(),
              location: z.string().nullish(),
              experience_level: z.string().nullish(),
              description: z.string().nullish(),
              apply_job_url: z.string().nullish(),
              updated_at: z.string().nullish(),
            })
            .loose(),
        ),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let page = 1; page <= 15; page++) {
      const body = Page.parse(
        await ctx.http.json(`${c.apiBase}/job-search?country_code=${c.countryCode}&page=${page}&size=100`),
      );
      total ??= body.count ?? body.total ?? null;
      for (const j of body.data)
        all.push(
          employerListing(ctx, {
            sourceId: j.ref ?? j.id,
            url: j.apply_job_url ?? `https://www.capgemini.com/gb-en/careers/`,
            title: j.title,
            ...desc(j.description),
            postedDate: parseDate(j.updated_at) ?? undefined,
            locations: (j.location ?? '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
              .map((text) => ({ text, country: 'GB' })),
            details: { experienceLevel: j.experience_level?.replace(/​/g, '') || undefined },
          }),
        );
      if (body.data.length < 100 || (total !== null && all.length >= total)) break;
    }
    return finish(all, total ?? all.length);
  },
});

/** entaincareers.com's own search API (a mirror of its SmartRecruiters board). */
export const entainApi = defineConnector({
  id: 'entain-api',
  config: z.object({ url: z.string(), country: z.string() }),
  async run(c, ctx) {
    const Page = z
      .object({
        data: z.array(
          z
            .object({
              id: z.union([z.string(), z.number()]).transform(String),
              url: z.string(),
              post_date: z.string().nullish(),
              job_title: z.string(),
              job_external_apply_url: z.string().nullish(),
              job_custom_location: z.string().nullish(),
              job_custom_country_code: z.string().nullish(),
            })
            .loose(),
        ),
        pagination: z.object({ lastPage: z.number().nullish(), totalItems: z.number().nullish() }).loose().nullish(),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let page = 1; page <= 10; page++) {
      const body = Page.parse(
        await ctx.http.json(
          `${c.url}?country%5B%5D=${encodeURIComponent(c.country)}&perPage=100&page=${page}`,
          { robots: true },
        ),
      );
      total ??= body.pagination?.totalItems ?? null;
      for (const j of body.data)
        all.push(
          employerListing(ctx, {
            sourceId: j.id,
            url: j.url,
            applyUrl: j.job_external_apply_url ?? undefined,
            title: j.job_title,
            postedDate: parseDate(j.post_date) ?? undefined,
            locations: j.job_custom_location
              ? [{ text: j.job_custom_location, country: j.job_custom_country_code ?? undefined }]
              : [],
          }),
        );
      if (page >= (body.pagination?.lastPage ?? 1)) break;
    }
    return finish(all, total ?? all.length);
  },
});

/** Lidl GB's careers portal search API (over SuccessFactors career5, which is script-only). */
export const lidl = defineConnector({
  id: 'lidl',
  config: z.object({ host: z.string() }),
  async run(c, ctx) {
    const Page = z
      .object({
        jobs: z.array(
          z
            .object({
              title: z.string(),
              requisitionId: z.union([z.string(), z.number()]).transform(String),
              jobDetailUrl: z.string(),
              onlineFrom: z.string().nullish(),
              onlineUntil: z.string().nullish(),
              location: z.object({ name: z.string().nullish(), city: z.string().nullish() }).loose().nullish(),
              entryLevel: z.string().nullish(),
              descResponsibilities: z.string().nullish(),
            })
            .loose(),
        ),
        meta: z.object({ totalCount: z.number().nullish() }).loose().nullish(),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let page = 1; page <= 20; page++) {
      const general = JSON.stringify({ page, resultsPerPage: 50, sortField: '', sortOrder: 'asc' });
      const body = Page.parse(
        await ctx.http.json(`https://${c.host}/api/v1/search?general=${encodeURIComponent(general)}`, { robots: true }),
      );
      total ??= body.meta?.totalCount ?? null;
      for (const j of body.jobs)
        all.push(
          employerListing(ctx, {
            sourceId: j.requisitionId,
            url: j.jobDetailUrl,
            title: j.title,
            ...desc(j.descResponsibilities),
            postedDate: parseDate(j.onlineFrom) ?? undefined,
            closingDate: parseDate(j.onlineUntil) ?? undefined,
            locations: j.location?.city || j.location?.name ? [{ text: (j.location.city ?? j.location.name)!, country: 'GB' }] : [],
            details: { entryLevel: j.entryLevel ?? undefined },
          }),
        );
      if (body.jobs.length < 50 || (total !== null && all.length >= total)) break;
    }
    return finish(all, total ?? all.length);
  },
});


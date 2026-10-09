import { collapseSpaces, decodeEntities } from '@af/shared';
import { findPlace } from '@af/shared/places';
import { z } from 'zod';
import { htmlToText } from '../pipeline/normalise.ts';
import {
  employerListing,
  isCandidateTitle,
  isUk,
  pageTitle,
  parseJobPosting,
  sitemapUrls,
  slugWords,
  withDetails,
  type SitemapEntry,
} from './common.ts';
import { defineConnector, type EmployerCtx } from './types.ts';

/**
 * SAP SuccessFactors Career Site Builder (research §13). Hosts come in three layouts (table
 * rows, tiles, and the script-rendered "Unify" one whose search is robots-disallowed), but every
 * one publishes `/sitemap.xml` with each job's URL, and job URLs carry the title in the slug. So:
 * sitemap → keep slugs that look like apprenticeships → job page (schema.org microdata) for new
 * ones. The HTML search is the fallback when a host has no sitemap.
 */
const Config = z.object({
  host: z.string(),
  /** Board under a path ('/tfl', '/emergingtalent'): keep only job URLs below it. */
  pathPrefix: z.string().optional(),
  basePath: z.string().optional(),
  sitemapUrl: z.string().optional(),
  locale: z.string().optional(),
  /** HTML search fallback: `locationsearch` value ('GB' is exact; 'United Kingdom' is fuzzy). */
  locationsearch: z.string().optional(),
  noLocationFilter: z.boolean().optional(),
  listMode: z.enum(['sitemap', 'search']).optional(),
});
type Config = z.infer<typeof Config>;

const JOB_URL = /\/job\/[^/]+\/[\w-]+\/?$/;

export interface SfJob {
  id: string;
  url: string;
  slug: string;
  lastmod: string | null;
  title?: string;
  location?: string;
}

export const sfJobId = (url: string) =>
  /\/job\/[^/]+\/([\w-]+?)(?:-[a-z]{2}_[A-Z]{2})?\/?$/.exec(url)?.[1] ?? url;

export function jobsFromSitemap(entries: SitemapEntry[], prefix?: string): SfJob[] {
  const out = new Map<string, SfJob>();
  for (const e of entries) {
    const path = new URL(e.url).pathname;
    if (!JOB_URL.test(path) || (prefix && !path.startsWith(prefix))) continue;
    const id = sfJobId(e.url);
    const slug = slugWords(path.replace(/^.*\/job\//, '/').replace(/\/[\w-]+\/?$/, ''));
    out.set(id, { id, url: e.url, slug, lastmod: e.lastmod });
  }
  return [...out.values()];
}

/** Rows from the search page: classic `tr.data-row` and the `li.job-tile` layout. */
export function parseSfSearch(html: string, host: string): { jobs: SfJob[]; total: number | null } {
  const jobs: SfJob[] = [];
  for (const m of html.matchAll(
    /<a[^>]*class=["'][^"']*jobTitle-link[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = new URL(decodeEntities(m[1]!), `https://${host}`).toString();
    const after = html.slice(m.index, m.index + 3000);
    const location = /class=["'][^"']*jobLocation[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
      after,
    )?.[1];
    jobs.push({
      id: sfJobId(url),
      url,
      slug: slugWords(new URL(url).pathname),
      lastmod: null,
      title: collapseSpaces(htmlToText(m[2]!)),
      location: location ? collapseSpaces(htmlToText(location)) : undefined,
    });
  }
  const text = htmlToText(html);
  const total =
    /Results\s+[\d,]+\s*[–-]\s*[\d,]+\s+of\s+([\d,]+)/i.exec(text)?.[1] ??
    /Showing\s+[\d,]+\s+to\s+[\d,]+\s+of\s+([\d,]+)/i.exec(text)?.[1] ??
    /jobRecordsFound\s*:\s*parseInt\("(\d+)"\)/.exec(html)?.[1];
  const unique = [...new Map(jobs.map((j) => [j.id, j])).values()];
  return { jobs: unique, total: total ? Number(total.replace(/,/g, '')) : null };
}

async function searchAll(
  c: Config,
  ctx: EmployerCtx,
): Promise<{ jobs: SfJob[]; total: number | null; full: boolean }> {
  const all = new Map<string, SfJob>();
  let total: number | null = null;
  const prefix = c.pathPrefix ?? c.basePath ?? '';
  for (let page = 0, start = 0; page < 40; page++) {
    const loc = c.noLocationFilter
      ? ''
      : `&locationsearch=${encodeURIComponent(c.locationsearch ?? 'United Kingdom')}`;
    const html = await ctx.http.text(
      `https://${c.host}${prefix}/search/?q=${loc}&startrow=${start}&sortColumn=referencedate&sortDirection=desc`,
      { robots: true },
    );
    const r = parseSfSearch(html, c.host);
    if (page === 0) total = r.total;
    const fresh = r.jobs.filter((j) => !all.has(j.id));
    for (const j of fresh) all.set(j.id, j);
    start += r.jobs.length;
    if (!fresh.length || (total !== null && all.size >= total))
      return { jobs: [...all.values()], total, full: true };
  }
  return { jobs: [...all.values()], total, full: false };
}

/** "Location: Edinburgh" in Unify job text, when the template has no location field. */
const textLocation = (text: string) =>
  /\bLocations?:\s*([A-Z][\w' ,/-]{2,60}?)(?=\s{2,}|\s+[A-Z][a-z]+ [a-z]+:|\.|$)/m.exec(text)?.[1];

export const successfactors = defineConnector({
  id: 'successfactors',
  config: Config,
  async run(c, ctx) {
    const prefix = c.pathPrefix ?? c.basePath;
    let jobs: SfJob[] = [];
    let total: number | null = null;
    let complete = true;
    if (c.listMode !== 'search') {
      try {
        const entries = await sitemapUrls(ctx, c.sitemapUrl ?? `https://${c.host}/sitemap.xml`);
        jobs = jobsFromSitemap(entries, prefix);
        // A board under a path may still list its jobs at the root.
        if (!jobs.length && prefix) jobs = jobsFromSitemap(entries);
        total = jobs.length;
      } catch (err) {
        if (c.listMode === 'sitemap') throw err;
        ctx.log.info(`no sitemap (${(err as Error).message}); using search`);
      }
    }
    if (!jobs.length && c.listMode !== 'sitemap') {
      const r = await searchAll(c, ctx);
      jobs = r.jobs;
      total = r.total ?? r.jobs.length;
      complete = r.full;
    }

    const candidates = jobs.filter((j) => isCandidateTitle(j.title ?? j.slug));
    const { listings, detailed, errors } = await withDetails(ctx, candidates, {
      id: (j) => j.id,
      sig: (j) => `${j.lastmod ?? ''}|${j.title ?? j.slug}`,
      detail: async (j) => {
        const html = await ctx.http.text(j.url, { robots: true });
        const p = parseJobPosting(html);
        const text = p?.descriptionHtml ? htmlToText(p.descriptionHtml) : undefined;
        const loc = p?.locations.length
          ? p.locations
          : j.location
            ? [{ text: j.location }]
            : textLocation(text ?? '')
              ? [{ text: textLocation(text ?? '')! }]
              : findPlace(j.slug)
                ? [{ text: findPlace(j.slug)!.name }]
                : [];
        return employerListing(ctx, {
          sourceId: j.id,
          url: j.url,
          title: p?.title ?? j.title ?? pageTitle(html) ?? j.slug,
          descriptionHtml: p?.descriptionHtml,
          descriptionText: text,
          postedDate: p?.postedDate,
          closingDate: p?.closingDate,
          locations: loc,
          raw: { url: j.url, lastmod: j.lastmod },
        });
      },
      fallback: (j) =>
        employerListing(ctx, {
          sourceId: j.id,
          url: j.url,
          title: j.title ?? j.slug,
          locations: j.location ? [{ text: j.location }] : [],
        }),
    });
    const uk = listings.filter(
      (l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false),
    );
    return {
      jobs: uk,
      total,
      complete: complete && errors === 0,
      stats: { listed: jobs.length, candidates: candidates.length, detailed },
    };
  },
  detect(url, html) {
    const u = new URL(url);
    if (
      /jobs2web\.com|successfactors\.(eu|com)/.test(u.host) ||
      /rmkcdn\.successfactors|jobTitle-link|data-careersite-propertyid/i.test(html ?? '')
    )
      return { host: u.host };
    if (JOB_URL.test(u.pathname) && /\/job\/[^/]+\/\d{6,}\/?$/.test(u.pathname))
      return { host: u.host };
    return null;
  },
});

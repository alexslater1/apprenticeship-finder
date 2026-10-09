import { collapseSpaces, decodeEntities, type Location } from '@af/shared';
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
} from './common.ts';
import { defineConnector, type EmployerCtx } from './types.ts';

/**
 * Avature (research §15): every customer's template is bespoke, so rows are read loosely (job
 * links, plus the text up to the next job link). Huge boards (Tesco, 2.7k jobs) are discovered from
 * the sitemap and filtered by slug instead of paging 10 at a time. A job-type facet, where the
 * portal has one, marks apprenticeships whose titles don't say so (Deloitte's are "Audit").
 */
const Config = z.object({
  host: z.string(),
  portal: z.string(),
  /** List page with `{offset}`, when it isn't `{portal}/SearchJobs/?jobOffset={offset}`. */
  listUrl: z.string().optional(),
  sitemapUrl: z.string().optional(),
  apprenticeFacet: z
    .object({ param: z.string(), ids: z.array(z.string()), format: z.string().optional() })
    .optional(),
  apprenticeFilter: z.object({ param: z.string(), value: z.string() }).optional(),
});
type Config = z.infer<typeof Config>;

const MAX_PAGES = 40;
const JOB_LINK =
  /<a\b[^>]*href=["']([^"']*\/(?:JobDetail|FolderDetail)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const GENERIC = /^(read more|apply( now)?|view( job)?|more|details|learn more|save|share)$/i;

export interface AvatureRow {
  id: string;
  url: string;
  title: string;
  /** Text between this job's link and the next one: location, programme, dates. */
  extra: string;
  known?: boolean;
}

export const avatureJobId = (url: string) => /\/(\d+)\/?(?:[?#].*)?$/.exec(url)?.[1] ?? url;

/** Job rows from a SearchJobs page. */
export function parseAvatureList(html: string, host: string): AvatureRow[] {
  const links = [...html.matchAll(JOB_LINK)];
  const rows = new Map<string, AvatureRow>();
  links.forEach((m, i) => {
    const url = new URL(decodeEntities(m[1]!), `https://${host}`).toString();
    const id = avatureJobId(url);
    const text = collapseSpaces(htmlToText(m[2]!));
    const end = links[i + 1]?.index ?? Math.min(html.length, m.index + 4000);
    const extra = collapseSpaces(htmlToText(html.slice(m.index + m[0].length, end))).slice(0, 400);
    const prev = rows.get(id);
    if (!prev) rows.set(id, { id, url, title: GENERIC.test(text) ? '' : text, extra });
    else if (!prev.title && text && !GENERIC.test(text)) prev.title = text;
  });
  return [...rows.values()].filter((r) => r.title);
}

/** "1-10 of 282 results" → 282 ("999+" → null). */
export function avatureTotal(html: string): number | null {
  const m = /\bof\s+([\d,]+)(\+)?\s+results/i.exec(htmlToText(html));
  return m && !m[2] ? Number(m[1]!.replace(/,/g, '')) : null;
}

function withProgramme(r: AvatureRow): string {
  // Deloitte: 'Audit' + 'Programme: BrightStart Higher Apprenticeship | Location: Leeds'.
  const prog = /programme:\s*([^|]+?)(?:\s*\||$)/i.exec(r.extra)?.[1];
  return prog && !/apprentic/i.test(r.title) ? `${r.title} (${prog.trim()})` : r.title;
}

function rowLocation(r: AvatureRow): Location[] {
  const loc =
    /location:\s*([^|]+?)(?:\s*\||$)/i.exec(r.extra)?.[1] ??
    /\(([^()]+,\s*[^()]+)\)$/.exec(r.title)?.[1];
  return loc ? [{ text: loc.trim() }] : [];
}

async function listRows(
  c: Config,
  ctx: EmployerCtx,
  query = '',
): Promise<{ rows: AvatureRow[]; total: number | null; full: boolean }> {
  const rows = new Map<string, AvatureRow>();
  let total: number | null = null;
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = c.listUrl
      ? c.listUrl.replace('{offset}', String(offset)) + query.replace(/^\?/, '&')
      : `https://${c.host}${c.portal}/SearchJobs/?jobOffset=${offset}${query.replace(/^\?/, '&')}`;
    const html = await ctx.http.text(url, { robots: true });
    if (page === 0) total = avatureTotal(html);
    const found = parseAvatureList(html, c.host).filter((r) => !rows.has(r.id));
    if (!found.length) return { rows: [...rows.values()], total, full: true };
    for (const r of found) rows.set(r.id, r);
    offset += found.length;
    if (total !== null && offset >= total) return { rows: [...rows.values()], total, full: true };
  }
  return { rows: [...rows.values()], total, full: false };
}

export const avature = defineConnector({
  id: 'avature',
  config: Config,
  async run(c, ctx) {
    const all = new Map<string, AvatureRow>();
    let total: number | null;
    let complete = true;
    if (c.sitemapUrl) {
      // Locale portals (en_GB, cs_CZ…) each have a sitemap; keep the configured portal's.
      const locale = /\/([a-z]{2}_[A-Z]{2})\//.exec(c.portal + '/')?.[1];
      const urls = await sitemapUrls(ctx, c.sitemapUrl, {
        childFilter: (u) => !locale || u.includes(locale),
      });
      const jobs = urls.filter((u) => /\/(JobDetail|FolderDetail)\//.test(u.url));
      total = jobs.length;
      for (const u of jobs) {
        const id = avatureJobId(u.url);
        const title = slugWords(
          u.url.replace(/^.*\/(?:JobDetail|FolderDetail)\//, '/').replace(/\/\d+\/?$/, ''),
        );
        all.set(id, { id, url: u.url, title, extra: '' });
      }
    } else {
      const r = await listRows(c, ctx);
      total = r.total ?? r.rows.length;
      complete = r.full;
      for (const row of r.rows) all.set(row.id, row);
    }
    const facetQuery = c.apprenticeFacet
      ? `?${c.apprenticeFacet.param}=${encodeURIComponent(`[${c.apprenticeFacet.ids.join(',')}]`)}${c.apprenticeFacet.format ? `&${c.apprenticeFacet.param}_format=${c.apprenticeFacet.format}` : ''}&listFilterMode=1`
      : c.apprenticeFilter
        ? `?${c.apprenticeFilter.param}=${c.apprenticeFilter.value}`
        : null;
    if (facetQuery) {
      const r = await listRows(c, ctx, facetQuery);
      for (const row of r.rows) all.set(row.id, { ...all.get(row.id), ...row, known: true });
    }

    const candidates = [...all.values()].filter(
      (r) => r.known || isCandidateTitle(withProgramme(r)),
    );
    const base = (r: AvatureRow) =>
      employerListing(ctx, {
        sourceId: r.id,
        url: r.url,
        title: withProgramme(r),
        locations: rowLocation(r),
        knownApprenticeship: r.known || undefined,
        raw: { row: r },
      });
    const { listings, detailed, errors } = await withDetails(ctx, candidates, {
      id: (r) => r.id,
      sig: (r) => r.title,
      detail: async (r) => {
        const html = await ctx.http.text(r.url, { robots: true });
        const p = parseJobPosting(html);
        const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? '';
        const desc = p?.descriptionHtml ?? (main || undefined);
        const fromRow = base(r);
        return {
          ...fromRow,
          title:
            p?.title && !r.title.includes(p.title)
              ? withProgramme({ ...r, title: p.title })
              : fromRow.title,
          descriptionHtml: desc,
          descriptionText: desc ? htmlToText(desc) : undefined,
          postedDate: p?.postedDate,
          closingDate: p?.closingDate,
          locations: p?.locations.length ? p.locations : fromRow.locations,
          ...(r.title || !pageTitle(html) ? {} : { title: pageTitle(html)! }),
        };
      },
      fallback: base,
    });
    const uk = listings.filter(
      (l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false),
    );
    return {
      jobs: uk,
      total,
      complete: complete && errors === 0,
      stats: { listed: all.size, candidates: candidates.length, detailed },
    };
  },
  detect(url, html) {
    const m =
      /\/\/([\w.-]+)(\/[a-z]{2}_[A-Z]{2}\/[\w-]+|\/[\w-]+)\/(?:SearchJobs|JobDetail|FolderDetail|Jobs)\b/.exec(
        url,
      );
    if (m && (/avature\.net/.test(m[1]!) || /avature/i.test(html ?? '')))
      return { host: m[1], portal: m[2] };
    return null;
  },
});

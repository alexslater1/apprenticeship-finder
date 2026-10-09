import { createHash } from 'node:crypto';
import { collapseSpaces, decodeEntities, rules } from '@af/shared';
import * as cheerio from 'cheerio';
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
import { defineConnector } from './types.ts';

/**
 * Generic fallbacks (research §19): `jsonld` for own-site employers whose job pages carry
 * schema.org JobPosting, `pagehash` for pages we can only watch for changes, and `manual` for
 * bot-walled boards (the Companies page shows a "check manually" link).
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const jsonld = defineConnector({
  id: 'jsonld',
  config: z.object({
    sitemapUrl: z.string().optional(),
    /** A server-rendered list page; `{page}` (1, 2, …) for paging. */
    listUrl: z.string().optional(),
    jobUrlPattern: z.string(),
    maxPages: z.number().optional(),
    lenientJson: z.boolean().optional(),
  }),
  async run(c, ctx) {
    const pattern = new RegExp(c.jobUrlPattern);
    const urls = new Map<string, { url: string; lastmod: string | null }>();
    if (c.sitemapUrl) {
      for (const e of await sitemapUrls(ctx, c.sitemapUrl))
        if (pattern.test(e.url)) urls.set(e.url.replace(/\/$/, ''), e);
    }
    if (c.listUrl && !urls.size) {
      for (let page = 1; page <= (c.maxPages ?? 10); page++) {
        const pageUrl = c.listUrl.replace('{page}', String(page));
        const html = await ctx.http.text(pageUrl, { robots: true });
        let fresh = 0;
        for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
          const u = new URL(decodeEntities(m[1]!), pageUrl).toString();
          if (pattern.test(u) && !urls.has(u.replace(/\/$/, ''))) {
            urls.set(u.replace(/\/$/, ''), { url: u, lastmod: null });
            fresh++;
          }
        }
        if (!fresh || !c.listUrl.includes('{page}')) break;
      }
    }
    // Slugs usually carry the title; ones that don't (/job/12345) are fetched anyway, capped.
    const candidates = [...urls.values()].filter((u) => {
      const words = slugWords(u.url).replace(/\d+/g, ' ').trim();
      return words.split(/\s+/).length < 3 || isCandidateTitle(words);
    });
    const { listings, detailed, errors } = await withDetails(ctx, candidates, {
      id: (u) => u.url,
      sig: (u) => u.lastmod ?? '',
      detail: async (u) => {
        const html = await ctx.http.text(u.url, { robots: true });
        const p = parseJobPosting(html);
        const title = p?.title ?? pageTitle(html);
        if (!title || !isCandidateTitle(title)) return null;
        return employerListing(ctx, {
          sourceId: p?.identifier ?? u.url,
          url: u.url,
          title,
          descriptionHtml: p?.descriptionHtml,
          descriptionText: p?.descriptionHtml ? htmlToText(p.descriptionHtml) : undefined,
          postedDate: p?.postedDate,
          closingDate: p?.closingDate,
          locations: p?.locations ?? [],
        });
      },
      cap: 30,
    });
    const uk = listings.filter((l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false));
    return {
      jobs: uk,
      total: urls.size,
      complete: errors === 0 && detailed < 30,
      stats: { listed: urls.size, candidates: candidates.length, detailed },
    };
  },
});

const VOLATILE = [
  /xf-[0-9a-f]+/g,
  /__vxXSRF_Token\S*/g,
  /csrf\w*=\S+/gi,
  /jsessionid=\S+/gi,
  /\b(posted|updated)\s+\d+\s+(minutes?|hours?|days?)\s+ago\b/gi,
  /\b\d{1,2}:\d{2}(:\d{2})?\b/g,
];

/** The watched page's main text, minus scripts, chrome and volatile tokens. */
export function pageText(html: string, selector?: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, nav, footer, header, iframe, form, [aria-hidden=true]').remove();
  $('[id*=cookie i], [class*=cookie i]').remove();
  const root = selector && $(selector).length ? $(selector) : $('main').length ? $('main') : $('body');
  // One line per block element so diffs are by sentence/heading, not the whole page.
  root.find('br').replaceWith('\n');
  root.find('p, li, h1, h2, h3, h4, h5, h6, div, tr, dt, dd, section, article').each((_, el) => {
    $(el).append('\n');
  });
  let text = root.text();
  for (const re of VOLATILE) text = text.replace(re, '');
  return text
    .split('\n')
    .map((l) => collapseSpaces(l))
    .filter(Boolean)
    .join('\n');
}

const LEAD_DATA = rules.dataWords;
const PAST = /\b(201\d|202[0-5])\b|\b(now )?closed\b|no longer accepting/i;

/** Lines that announce a data/tech apprenticeship (not last year's, not "closed"). */
export function leadLines(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    if (line.length < 15 || line.length > 220) continue;
    if (!/apprentic/i.test(line) || !LEAD_DATA.test(line) || PAST.test(line)) continue;
    out.add(line);
  }
  return [...out].slice(0, 5);
}

export const pagehash = defineConnector({
  id: 'pagehash',
  config: z.object({ url: z.string(), selector: z.string().optional() }),
  async run(c, ctx) {
    const html = await ctx.http.text(c.url, { robots: true });
    const text = pageText(html, c.selector);
    const hash = sha(text);
    const changed = !!ctx.employer.page_hash && ctx.employer.page_hash !== hash;
    if (changed) ctx.log.info(`page changed: ${c.url}`);
    const jobs = leadLines(text).map((line) =>
      employerListing(ctx, {
        sourceId: sha(line).slice(0, 16),
        url: c.url,
        title: line.length > 140 ? `${line.slice(0, 137)}…` : line,
        descriptionText: line,
        locations: [],
        isLead: true,
        knownApprenticeship: true,
        details: { lead: true },
      }),
    );
    return { jobs, total: null, complete: true, pageHash: hash, stats: { leads: jobs.length, changed: changed ? 'yes' : 'no' } };
  },
});

export const manual = defineConnector({
  id: 'manual',
  config: z.object({ url: z.string(), reason: z.string().optional() }),
  async run() {
    return { jobs: [], total: null, complete: false };
  },
});

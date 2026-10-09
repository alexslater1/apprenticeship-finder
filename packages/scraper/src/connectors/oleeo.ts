import { collapseSpaces, decodeEntities, parseDate } from '@af/shared';
import { z } from 'zod';
import { htmlToText } from '../pipeline/normalise.ts';
import { employerListing, isCandidateTitle, isUk, withDetails } from './common.ts';
import { defineConnector } from './types.ts';

/**
 * Oleeo / tal.net (research §18): server-rendered boards, 50 rows a page, Crawl-delay 10 (the
 * http host gap). URLs carry a per-request `xf-…` session token, so jobs are keyed on `oppid`
 * and the token is stripped from stored links. No dates in the list; detail pages have labelled
 * fields (closing date where the tenant shows one).
 */
const Config = z.object({
  host: z.string(),
  boards: z.array(z.string()).min(1),
});

const MAX_PAGES = 8;

export interface OleeoRow {
  id: string;
  title: string;
  url: string;
  location?: string;
}

export const stripSession = (url: string) => url.replace(/\/xf-[0-9a-f]+\//, '/');

export function parseOleeoBoard(html: string): { rows: OleeoRow[]; next: boolean } {
  const rows: OleeoRow[] = [];
  const parts = html.split(/<tr\b(?=[^>]*\bsearch_res\b)/i).slice(1);
  for (const part of parts) {
    const row = part.slice(0, part.search(/<\/tr>/i) + 1 || undefined);
    const id = /data-oppid=["'](\d+)["']/i.exec(row)?.[1];
    const a = /<a[^>]*class=["'][^"']*\bsubject\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(row);
    const title = /data-title=["']([^"']*)["']/i.exec(row)?.[1];
    if (!id || !a) continue;
    // Tenants that show a location put it in the next cell.
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => collapseSpaces(htmlToText(m[1]!)));
    rows.push({
      id,
      title: collapseSpaces(decodeEntities(title ?? htmlToText(a[2]!))),
      url: stripSession(decodeEntities(a[1]!)),
      location: cells.slice(1).find((c) => c && c.length < 80) || undefined,
    });
  }
  return { rows, next: /class=["']next_links["'][\s\S]{0,200}?Next page/i.test(html) };
}

/** Labelled fields on an opportunity page ("Closing date", "City", "Job description"…). */
export function parseOleeoDetail(html: string): {
  descriptionHtml?: string;
  closingDate?: string;
  location?: string;
} {
  const text = htmlToText(html);
  const closing = /closing date[:\s]*([0-3]?\d[\s/.-]+[A-Za-z]+[\s/.-]+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i.exec(text)?.[1];
  const city = /\b(?:city|location|office)[:\s]+([A-Z][\w ,'-]{2,60})/.exec(text)?.[1];
  const main = /<div[^>]*class=["'][^"']*(?:opp_body|vacancy|form_page|panel-body)[^"']*["'][\s\S]*?(?=<footer|<\/body)/i.exec(html)?.[0];
  return {
    descriptionHtml: main,
    closingDate: closing ? (parseDate(closing) ?? undefined) : undefined,
    location: city?.split(/\s{2,}|\n/)[0]?.trim(),
  };
}

export const oleeo = defineConnector({
  id: 'oleeo',
  config: Config,
  async run(c, ctx) {
    const rows = new Map<string, OleeoRow>();
    let complete = true;
    for (const board of c.boards) {
      let start = 0;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) {
          complete = false;
          break;
        }
        const html = await ctx.http.text(
          `https://${c.host}/vx/candidate/jobboard/${board}/adv/?start=${start}`,
          { robots: true },
        );
        const { rows: found, next } = parseOleeoBoard(html);
        for (const r of found) rows.set(r.id, r);
        if (!next || !found.length) break;
        start += found.length;
      }
    }
    const candidates = [...rows.values()].filter((r) => isCandidateTitle(r.title));
    const base = (r: OleeoRow) =>
      employerListing(ctx, {
        sourceId: r.id,
        url: r.url,
        title: r.title,
        locations: r.location ? [{ text: r.location }] : [],
        raw: { ...r },
      });
    const { listings, detailed, errors } = await withDetails(ctx, candidates, {
      id: (r) => r.id,
      sig: (r) => r.title,
      detail: async (r) => {
        const d = parseOleeoDetail(await ctx.http.text(r.url, { robots: true }));
        const b = base(r);
        return {
          ...b,
          descriptionHtml: d.descriptionHtml,
          descriptionText: d.descriptionHtml ? htmlToText(d.descriptionHtml) : undefined,
          closingDate: d.closingDate,
          locations: b.locations.length ? b.locations : d.location ? [{ text: d.location }] : [],
        };
      },
      fallback: base,
      cap: 15, // 10 s apart
    });
    const uk = listings.filter((l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false));
    return {
      jobs: uk,
      total: rows.size,
      complete: complete && errors === 0,
      stats: { listed: rows.size, candidates: candidates.length, detailed },
    };
  },
  detect(url) {
    const m = /\/\/([\w-]+\.tal\.net)\/.*?\/candidate\/jobboard\/(vacancy\/\d+)/.exec(url);
    if (m) return { host: m[1], boards: [m[2]] };
    const h = /\/\/([\w-]+\.tal\.net)\b/.exec(url);
    return h ? { host: h[1], boards: ['vacancy/1'] } : null;
  },
});

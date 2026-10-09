import { classify, collapseSpaces, decodeEntities, type RawListing } from '@af/shared';
import { htmlToText } from '../pipeline/normalise.ts';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * JobApplyNI (Department for Communities), research/devolved-nations.md §3a: NI's official
 * vacancy board, HLAs included. No API or JSON-LD; search and detail pages are server-rendered
 * Razor pages (robots.txt is a 404, so nothing is disallowed). Daily: the Apprenticeships sector
 * (the whole apprenticeship set, ~8 today) plus keyword "apprentice" for adverts filed under
 * another sector, paging with CurrentPage=N, then detail pages for new relevant ones. Data HLAs
 * mostly recruit through college portals (Belfast Met, Ulster), which are watchlist employers.
 */
const BASE = 'https://www.jobapplyni.com';
const MAX_PAGES = 10; // ~10 cards a page

export const SEARCHES: Array<{ key: string; params: Record<string, string>; known: boolean }> = [
  // Everything in this sector is an apprenticeship, whatever the title says.
  { key: 'sector', params: { sector: 'Apprenticeships' }, known: true },
  { key: 'keyword', params: { keyword: 'apprentice' }, known: false },
];

export interface Card {
  id: string;
  title: string;
  employer: string | null;
  salary: string | null;
  area: string | null;
  location: string | null;
  hours: string | null;
  closing: string | null;
}

export interface DetailPage {
  title: string | null;
  employer: string | null;
  facts: Record<string, string>;
  descriptionHtml: string | null;
  applyUrl: string | null;
  employerAddress: string | null;
}

const text = (html: string) => collapseSpaces(decodeEntities(html.replace(/<[^>]+>/g, ' ')));

/** `<dt>Label</dt><dd>Value</dd>` pairs of the first <dl> in `html`. */
function definitionList(html: string): Record<string, string> {
  const dl = /<dl\b[\s\S]*?<\/dl>/i.exec(html)?.[0] ?? '';
  const out: Record<string, string> = {};
  for (const m of dl.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const k = text(m[1]!);
    if (k && !(k in out)) out[k] = text(m[2]!);
  }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** '13/11/2026' (detail pages) or '13 Nov 2026' (cards) → '2026-11-13'. */
export function niDate(s: string | null | undefined): string | undefined {
  const t = s?.trim() ?? '';
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  const named = /^(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})$/i.exec(t);
  const month = named ? MONTHS.indexOf(named[2]!.toLowerCase()) + 1 : 0;
  if (named && month)
    return `${named[3]}-${String(month).padStart(2, '0')}-${named[1]!.padStart(2, '0')}`;
  return undefined;
}

/** Result cards, the "N jobs in …" total and the last page number. */
export function parseSearchPage(html: string): {
  cards: Card[];
  total: number | null;
  pages: number;
} {
  const total = /(\d[\d,]*)\s+jobs?\s+in\b/i.exec(html)?.[1];
  const bar = /class="[^"]*paginationBar[^"]*">([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? '';
  const pageNums = [...bar.matchAll(/CurrentPage=(\d+)/g)].map((m) => Number(m[1]));
  const cards: Card[] = [];
  // Each card starts at its title; login-prompt "cards" have no vacancy link and drop out.
  for (const chunk of html.split(/<h2 class="card-title">/).slice(1)) {
    const link = /^\s*<a href="?\/Vacancy\/VacancyDetail\?Id=(\d+)[^>]*>([\s\S]*?)<\/a>/i.exec(
      chunk,
    );
    if (!link) continue;
    const dlEnd = chunk.search(/<\/dl>/i);
    const body = dlEnd >= 0 ? chunk.slice(0, dlEnd + 5) : chunk;
    const facts = definitionList(body);
    const employer = /<p class="h5">([\s\S]*?)<\/p>/i.exec(body)?.[1];
    cards.push({
      id: link[1]!,
      title: text(link[2]!),
      employer: employer ? text(employer) : null,
      salary: facts['Salary'] || null,
      area: facts['Area'] || null,
      location: facts['Location'] || null,
      hours: facts['Hours'] || null,
      closing: facts['Closing date'] || null,
    });
  }
  return {
    cards,
    total: total ? Number(total.replace(/,/g, '')) : null,
    pages: Math.max(1, ...pageNums),
  };
}

export function parseDetailPage(html: string): DetailPage {
  const header = /<div class="card-header">\s*<h1>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const employer = /<h2 class="card-title">\s*<a[^>]*employerModal[^>]*>([\s\S]*?)<\/a>/i.exec(
    html,
  )?.[1];
  // The advert text runs from "Job description" to the facts column.
  const start = html.search(/<h3>\s*Job description\s*<\/h3>/i);
  const end = start >= 0 ? html.indexOf('<div class="col-md-4', start) : -1;
  const description =
    start >= 0 ? html.slice(start, end > start ? end : undefined).replace(/&#xA;/gi, '<br>') : '';
  const factsAt = html.search(/<dl class="row">/i);
  const apply = /<a class="btn btn-success[^"]*" href="(https?:\/\/[^"]+)"[^>]*>\s*Apply/i.exec(
    html,
  )?.[1];
  const address = /Employer Address:([\s\S]*?)<br/i.exec(html)?.[1];
  return {
    title: header ? text(header) : null,
    employer: employer ? text(employer) : null,
    facts: factsAt >= 0 ? definitionList(html.slice(factsAt)) : {},
    descriptionHtml: description.trim() ? description.trim() : null,
    applyUrl: apply ? decodeEntities(apply) : null,
    employerAddress: address ? text(address) || null : null,
  };
}

/** Card data only, so the decision is the same on days we skip the detail page. */
export function isRelevantCard(c: Card, knownApprenticeship: boolean): boolean {
  return classify({ title: c.title, knownApprenticeship }).relevant;
}

const toNumber = (s: string | null | undefined) => {
  const n = Number(s?.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function toRawListing(c: Card, known: boolean, d?: DetailPage): RawListing {
  const f = d?.facts ?? {};
  const place = c.location || c.area || f['Location'] || f['Area'];
  return {
    source: 'ni',
    sourceId: c.id,
    url: `${BASE}/Vacancy/VacancyDetail?Id=${c.id}`,
    applyUrl: d?.applyUrl ?? undefined,
    title: c.title,
    employerName: c.employer || d?.employer || 'Unknown employer',
    descriptionHtml: d?.descriptionHtml ?? undefined,
    descriptionText: d?.descriptionHtml ? htmlToText(d.descriptionHtml) : undefined,
    salaryText: c.salary || f['Salary'] || undefined,
    postedDate: niDate(f['Published date']),
    closingDate: niDate(f['Closing date']) ?? niDate(c.closing),
    locations: place ? [{ text: place, nation: 'Northern Ireland' }] : [],
    knownApprenticeship: known || undefined,
    details: {
      hoursPerWeek: toNumber(c.hours ?? f['Weekly hours']),
      positions: toNumber(f['No. vacancies']),
      contract: f['Contract Type'] || undefined,
      workingWeek: f['Worktime'] || undefined,
      sector: f['Job Sector'] || undefined,
      jobRef: f['Job ref.'] || undefined,
      area: c.area || undefined,
      employerAddress: d?.employerAddress || undefined,
    },
    raw: { card: c, facts: d ? f : undefined },
  };
}

export const ni: Source = {
  id: 'ni',
  enabled: () => true,
  async run(ctx: Ctx): Promise<SourceResult> {
    const cards = new Map<string, { card: Card; known: boolean }>();
    const totals: Record<string, number | string> = {};
    let errors = 0;
    let short = false;
    let pagesFetched = 0;
    for (const s of SEARCHES) {
      try {
        const ids = new Set<string>();
        let total: number | null = null;
        let pages = 1;
        for (let page = 1; page <= Math.min(pages, MAX_PAGES); page++) {
          const qs = new URLSearchParams({
            ...s.params,
            DoSearch: 'true',
            CurrentPage: String(page),
          });
          const parsed = parseSearchPage(await ctx.http.text(`${BASE}/?${qs}`, { robots: true }));
          pagesFetched++;
          total ??= parsed.total;
          pages = parsed.pages;
          for (const card of parsed.cards) {
            ids.add(card.id);
            const prev = cards.get(card.id);
            cards.set(card.id, { card, known: s.known || !!prev?.known });
          }
        }
        totals[`${s.key}Total`] = total ?? 'unknown';
        // Fewer cards than the stated total: capped, or the markup changed under us.
        if (total === null || ids.size < total) {
          short = true;
          ctx.log.warn(`${s.key} search: parsed ${ids.size} cards of ${total ?? '?'}`);
        }
      } catch (err) {
        errors++;
        ctx.log.warn(`${s.key} search: ${(err as Error).message}`);
      }
    }
    if (errors === SEARCHES.length) throw new Error('every JobApplyNI search failed');

    const relevant = [...cards.values()].filter(({ card, known }) => isRelevantCard(card, known));
    const knownIds = await ctx.knownSourceIds('ni');
    const listings: RawListing[] = [];
    let detailed = 0;
    let detailErrors = 0;
    for (const { card, known } of relevant) {
      let d: DetailPage | undefined;
      if (!knownIds.has(card.id)) {
        try {
          d = parseDetailPage(
            await ctx.http.text(`${BASE}/Vacancy/VacancyDetail?Id=${card.id}`, { robots: true }),
          );
          detailed++;
        } catch (err) {
          detailErrors++;
          ctx.log.warn(`detail ${card.id}: ${(err as Error).message}`);
        }
      }
      listings.push(toRawListing(card, known, d));
    }

    return {
      listings,
      complete: errors === 0 && !short && detailErrors === 0,
      stats: {
        ...totals,
        pages: pagesFetched,
        vacancies: cards.size,
        relevant: relevant.length,
        detailFetched: detailed,
        detailErrors,
        errors,
      },
    };
  },
};

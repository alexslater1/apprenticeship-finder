import {
  classify,
  collapseSpaces,
  decodeEntities,
  parseDate,
  parseSalary,
  type Location,
  type RawListing,
} from '@af/shared';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * Higherin (ex-RateMyApprenticeship), research/job-sites.md §B2.
 * Daily: one job sitemap (= the live set), nine allowed category pages (embedded search JSON),
 * then JSON-LD JobPosting from job pages we haven't parsed since their lastmod. robots.txt
 * allows these paths; we never use search-term/sort-by/company params.
 */
const BASE = 'https://higherin.com';
const SITEMAP_INDEX = `${BASE}/sitemaps/job-sitemap-index.xml`;
const STATE_KEY = 'higherin:jobs';
const MAX_JOB_PAGES = 120; // per run; the rest wait for tomorrow

export const CATEGORIES: Array<[path: string, hint: string]> = [
  ['/search-jobs/degree-apprenticeship/data-analysis', 'Data analysis'],
  ['/search-jobs/degree-apprenticeship/artificial-intelligence', 'Artificial intelligence'],
  ['/search-jobs/degree-apprenticeship/computer-science', 'Computer science'],
  ['/search-jobs/degree-apprenticeship/software-engineering', 'Software engineering'],
  ['/search-jobs/higher-level-apprenticeship/data-analysis', 'Data analysis'],
  ['/search-jobs/higher-level-apprenticeship/artificial-intelligence', 'Artificial intelligence'],
  ['/search-jobs/higher-level-apprenticeship/software-engineering', 'Software engineering'],
];

export interface CategoryItem {
  jobId: number;
  jobTitle: string;
  jobTypeName?: string | null;
  deadline?: string | null;
  url: string;
  salary?: string | null;
  isPreReg?: boolean;
  jobLocationNames?: string | null;
  companyName?: string | null;
}

interface SitemapJob {
  id: string;
  url: string;
  lastmod: string | null;
}

interface JobPosting {
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  hiringOrganization?: { name?: string };
  baseSalary?: {
    value?: { value?: number; minValue?: number; maxValue?: number; unitText?: string } | number;
  };
  jobLocation?: JobPlace | JobPlace[];
}
interface JobPlace {
  address?: {
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string | { name?: string };
  };
}

interface CacheEntry {
  lastmod: string | null;
  /** Parsed listing without its description (the DB keeps that), or null = not relevant. */
  listing: RawListing | null;
}
type Cache = Record<string, CacheEntry>;

/** Pull a `window.NAME = {...}` JSON literal out of a page by brace matching. */
export function extractWindowJson<T>(html: string, name: string): T | null {
  const at = html.indexOf(`window.${name}`);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parseCategoryPage(html: string): { items: CategoryItem[]; next: string | null } {
  const state = extractWindowJson<{
    data?: CategoryItem[];
    meta?: { pagination?: { quickNavigation?: { nextPageUrl?: string | null } } };
  }>(html, '__RMP_SEARCH_RESULTS_INITIAL_STATE__');
  return {
    items: (state?.data ?? []).filter((d) => d && d.jobId && d.url),
    next: state?.meta?.pagination?.quickNavigation?.nextPageUrl ?? null,
  };
}

export function parseSitemap(xml: string): SitemapJob[] {
  const out: SitemapJob[] = [];
  for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)) {
    const url = m[1]!.trim();
    const id = /\/jobs\/(\d+)\//.exec(url)?.[1];
    if (id) out.push({ id, url, lastmod: m[2]?.trim() ?? null });
  }
  return out;
}

export function parseSitemapIndex(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
}

/** 'level-6-data-science-degree-apprenticeship' → 'level 6 data science degree apprenticeship'. */
export function slugTitle(url: string): string {
  const slug = url.split('/').filter(Boolean).at(-1) ?? '';
  return slug.replace(/-/g, ' ');
}

export function parseJobPage(html: string): {
  posting: JobPosting | null;
  title: string | null;
  company: string | null;
} {
  let posting: JobPosting | null = null;
  for (const m of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      const j = JSON.parse(m[1]!);
      const nodes: unknown[] = Array.isArray(j) ? j : (j['@graph'] ?? [j]);
      const found = nodes.find((n) => (n as { '@type'?: string })['@type'] === 'JobPosting');
      if (found) {
        posting = found as JobPosting;
        break;
      }
    } catch {
      /* ignore broken blocks */
    }
  }
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];
  const og = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  const company = og ? (/\bat (.+?) \| Higherin/.exec(decodeEntities(og))?.[1] ?? null) : null;
  return {
    posting,
    title: h1 ? collapseSpaces(decodeEntities(h1.replace(/<[^>]+>/g, ' '))) : null,
    company: company ? collapseSpaces(company) : null,
  };
}

const JOB_TYPE_LEVEL: Array<[RegExp, number]> = [
  [/degree/i, 6],
  [/higher/i, 4],
  [/level 3|advanced/i, 3],
  [/level 2|intermediate/i, 2],
];

function levelFromJobType(jobType: string | null | undefined): number | undefined {
  for (const [re, l] of JOB_TYPE_LEVEL) if (jobType && re.test(jobType)) return l;
  return undefined;
}

function postingSalary(p: JobPosting | null): { min?: number; max?: number } {
  const v = p?.baseSalary?.value;
  if (typeof v === 'number') return { min: v };
  if (!v) return {};
  const unit = (v.unitText ?? 'YEAR').toUpperCase();
  const mult = unit === 'HOUR' ? 37.5 * 52 : unit === 'WEEK' ? 52 : unit === 'MONTH' ? 12 : 1;
  const min = v.value ?? v.minValue;
  const max = v.maxValue && v.maxValue !== min ? v.maxValue : undefined;
  return {
    min: min ? Math.round(min * mult) : undefined,
    max: max ? Math.round(max * mult) : undefined,
  };
}

function postingLocations(p: JobPosting | null): Location[] {
  const places = p?.jobLocation
    ? Array.isArray(p.jobLocation)
      ? p.jobLocation
      : [p.jobLocation]
    : [];
  return places
    .map((pl) => pl.address)
    .filter((a): a is NonNullable<JobPlace['address']> => !!a)
    .map((a) => {
      const lines = [a.streetAddress, a.addressLocality, a.addressRegion]
        .map((l) => l?.trim())
        .filter((l): l is string => !!l);
      return {
        text: [a.addressLocality, a.addressRegion].filter(Boolean).join(', ') || lines.join(', '),
        postcode: a.postalCode?.trim() || undefined,
        lines,
      };
    });
}

/** Combine a job page (JSON-LD when present) with its category-page card. */
export function toRawListing(
  job: { id: string; url: string },
  page: ReturnType<typeof parseJobPage> | null,
  item: CategoryItem | undefined,
  hints: string[],
): RawListing {
  const p = page?.posting ?? null;
  const title = collapseSpaces(
    decodeEntities(p?.title ?? page?.title ?? item?.jobTitle ?? slugTitle(job.url)),
  );
  const employer =
    p?.hiringOrganization?.name ??
    item?.companyName ??
    page?.company ??
    job.url.split('/')[5]?.replace(/-/g, ' ') ??
    'Unknown employer';
  const jobType = item?.jobTypeName ?? null;
  const salary = postingSalary(p);
  const salaryText = item?.salary ?? undefined;
  const fromText = salary.min ? null : parseSalary(salaryText);
  let locations = postingLocations(p);
  if (!locations.length && item?.jobLocationNames) {
    locations = item.jobLocationNames
      .split(/,\s*/)
      .filter(Boolean)
      .map((name) => ({ text: name }));
  }
  const deadline = p?.validThrough ?? item?.deadline ?? null;
  return {
    source: 'higherin',
    sourceId: job.id,
    url: job.url,
    title,
    employerName: collapseSpaces(decodeEntities(employer)),
    descriptionHtml: p?.description || undefined,
    // A title like 'Level 5 Data Engineer' beats the card's broad 'Higher Level Apprenticeship' band.
    level: /\blevel\s*[2-7]\b|\bL[2-7]\b/i.test(title) ? undefined : levelFromJobType(jobType),
    salaryMin: salary.min ?? fromText?.min ?? undefined,
    salaryMax: salary.max ?? fromText?.max ?? undefined,
    salaryText,
    postedDate: parseDate(p?.datePosted) ?? undefined,
    closingDate:
      deadline && !/ongoing|rolling/i.test(deadline)
        ? (parseDate(deadline) ?? undefined)
        : undefined,
    locations,
    knownApprenticeship: /apprentic/i.test(jobType ?? '') || undefined,
    roleHint: hints[0],
    details: {
      jobType: jobType ?? undefined,
      preRegister: item?.isPreReg || /register your interest/i.test(title) || undefined,
      deadlineText: deadline && /ongoing|rolling/i.test(deadline) ? deadline : undefined,
    },
    raw: {
      jobId: job.id,
      card: item ?? null,
      posting: p ? { ...p, description: undefined } : null,
    },
  };
}

/** Is a sitemap slug worth a page fetch? (apprenticeship + data/AI/tech words) */
export function slugLooksRelevant(url: string): boolean {
  if (!/apprentic/i.test(url)) return false;
  const c = classify({ title: slugTitle(url) });
  return c.relevant;
}

export const higherin: Source = {
  id: 'higherin',
  enabled: () => true,
  async run(ctx: Ctx): Promise<SourceResult> {
    const http = ctx.http;
    const get = (url: string) => http.text(url, { robots: true });

    // 1. Live set from the sitemap.
    const index = parseSitemapIndex(await get(SITEMAP_INDEX));
    const sitemapJobs: SitemapJob[] = [];
    for (const url of index) sitemapJobs.push(...parseSitemap(await get(url)));
    const live = new Map(sitemapJobs.map((j) => [j.id, j]));

    // 2. Category cards (deadline, type, pre-register flag, role hint).
    const cards = new Map<string, { item: CategoryItem; hints: string[] }>();
    let categoryErrors = 0;
    for (const [path, hint] of CATEGORIES) {
      let next: string | null = path;
      for (let page = 0; next && page < 5; page++) {
        try {
          const { items, next: n } = parseCategoryPage(await get(new URL(next, BASE).toString()));
          for (const item of items) {
            const id = String(item.jobId);
            const prev = cards.get(id);
            if (prev) prev.hints.push(hint);
            else cards.set(id, { item, hints: [hint] });
          }
          next = n;
        } catch (err) {
          categoryErrors++;
          ctx.log.warn(`category ${path}: ${(err as Error).message}`);
          next = null;
        }
      }
    }

    // 3. Candidates: carded jobs + sitemap slugs that look like data/tech apprenticeships.
    const candidates = new Map<string, { id: string; url: string; lastmod: string | null }>();
    for (const [id, { item }] of cards) {
      candidates.set(id, live.get(id) ?? { id, url: item.url, lastmod: null });
    }
    for (const j of sitemapJobs)
      if (!candidates.has(j.id) && slugLooksRelevant(j.url)) candidates.set(j.id, j);

    // 4. Parse pages we haven't seen at this lastmod; reuse the cache for the rest.
    const cache = (await ctx.state.get<Cache>(STATE_KEY)) ?? {};
    // Cached listings carry no description, so only reuse them for jobs already stored.
    const known = await ctx.knownSourceIds('higherin');
    const nextCache: Cache = {};
    const listings: RawListing[] = [];
    let fetched = 0;
    let capped = false;
    let pageErrors = 0;
    for (const c of candidates.values()) {
      const card = cards.get(c.id);
      const cached = cache[c.id];
      if (cached && cached.lastmod === c.lastmod && c.lastmod !== null && known.has(c.id)) {
        nextCache[c.id] = cached;
        if (cached.listing)
          listings.push(card ? { ...cached.listing, ...refresh(card) } : cached.listing);
        continue;
      }
      if (fetched >= MAX_JOB_PAGES) {
        capped = true;
        if (cached) nextCache[c.id] = cached;
        if (cached?.listing) listings.push(cached.listing);
        continue;
      }
      fetched++;
      try {
        const page = parseJobPage(await get(c.url));
        const listing = toRawListing(c, page, card?.item, card?.hints ?? []);
        const keep = classify({
          title: listing.title,
          level: listing.level,
          roleHint: listing.roleHint,
          knownApprenticeship: listing.knownApprenticeship,
        }).relevant;
        nextCache[c.id] = {
          lastmod: c.lastmod,
          listing: keep ? { ...listing, descriptionHtml: undefined, raw: undefined } : null,
        };
        if (keep) listings.push(listing);
      } catch (err) {
        pageErrors++;
        ctx.log.warn(`job ${c.id}: ${(err as Error).message}`);
        if (cached?.listing) listings.push(cached.listing);
        if (cached) nextCache[c.id] = cached;
      }
    }
    await ctx.state.set(STATE_KEY, nextCache);

    return {
      listings,
      complete: sitemapJobs.length > 0 && !capped && pageErrors === 0 && categoryErrors === 0,
      stats: {
        sitemapJobs: sitemapJobs.length,
        carded: cards.size,
        candidates: candidates.size,
        pagesFetched: fetched,
        pageErrors,
        categoryErrors,
        capped: capped ? 'yes' : 'no',
      },
    };
  },
};

/** Card fields change without a sitemap lastmod bump (deadline extended, now open). */
function refresh(card: { item: CategoryItem; hints: string[] }): Partial<RawListing> {
  const out: Partial<RawListing> = { roleHint: card.hints[0] };
  const d = card.item.deadline;
  const date = d && !/ongoing|rolling/i.test(d) ? parseDate(d) : null;
  if (date) out.closingDate = date;
  return out;
}

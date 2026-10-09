import {
  classify,
  collapseSpaces,
  daysBetween,
  decodeEntities,
  displayCase,
  normaliseEmployerName,
  parseDate,
  parseSalary,
  rules,
  type Location,
  type RawListing,
} from '@af/shared';
import { z } from 'zod';
import { htmlToText } from '../pipeline/normalise.ts';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * Not Going To Uni (research/job-sites.md §B3). Optional and low volume: mostly QA Ltd adverts
 * that FAA also carries. Daily: one search page per query, whose JSON-LD ItemList holds the newest
 * 16 matches (the rest load client-side, so the source is only complete when page 1 covers the
 * total), then the JSON-LD JobPosting plus the page's embedded opportunity record (type, deadline,
 * apply link) on detail pages we haven't parsed yet. robots.txt allows both paths.
 */
const BASE = 'https://notgoingtouni.co.uk';
export const QUERIES = ['data'];
const STATE_KEY = 'ngtu:jobs';
const MAX_DETAIL_PAGES = 40; // per run; the rest wait for tomorrow
const FORGET_DAYS = 60; // drop cache entries that haven't been on a search page for this long

export interface SearchItem {
  id: string;
  url: string;
  name: string;
}

const DETAIL_ID = /\/opportunity-detail\/[a-z0-9-]*?-?(\d+)\/?(?:[?#].*)?$/i;

const ListItem = z.object({ url: z.string(), name: z.string().nullish() }).loose();
const ItemList = z
  .object({
    '@type': z.literal('ItemList'),
    name: z.string().nullish(),
    numberOfItems: z.number().nullish(),
    itemListElement: z.array(z.unknown()),
  })
  .loose();

const Place = z
  .object({
    address: z
      .object({
        streetAddress: z.string().nullish(),
        addressLocality: z.string().nullish(),
        addressRegion: z.string().nullish(),
        postalCode: z.string().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

const Money = z
  .object({
    value: z.number().nullish(),
    minValue: z.number().nullish(),
    maxValue: z.number().nullish(),
    unitText: z.string().nullish(),
  })
  .loose();

export const JobPosting = z
  .object({
    title: z.string(),
    description: z.string().nullish(),
    url: z.string().nullish(),
    datePosted: z.string().nullish(),
    validThrough: z.string().nullish(),
    employmentType: z.union([z.string(), z.array(z.string())]).nullish(),
    hiringOrganization: z.object({ name: z.string().nullish() }).loose().nullish(),
    occupationalCategory: z.string().nullish(),
    jobLocation: z.union([Place, z.array(Place)]).nullish(),
    baseSalary: z
      .object({ value: z.union([z.number(), Money]).nullish() })
      .loose()
      .nullish(),
  })
  .loose();
export type JobPosting = z.infer<typeof JobPosting>;

/** The opportunity record the page's React payload carries (has the type and apply link). */
export const Opportunity = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string().nullish(),
    employer: z.string().nullish(),
    opportunityType: z.string().nullish(),
    salaryDisplay: z.string().nullish(),
    publishedDate: z.string().nullish(),
    deadline: z.string().nullish(),
    applicationLink: z.string().nullish(),
    townLabel: z.string().nullish(),
    countyLabel: z.string().nullish(),
    sectorLabel: z.string().nullish(),
  })
  .loose();
export type Opportunity = z.infer<typeof Opportunity>;

function jsonLdNodes(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      const j = JSON.parse(m[1]!);
      out.push(...(Array.isArray(j) ? j : (j['@graph'] ?? [j])));
    } catch {
      /* ignore broken blocks */
    }
  }
  return out;
}

/** Page 1 of a search: the JSON-LD ItemList, plus the total from its '82 Opportunities …' name. */
export function parseSearchPage(html: string): { total: number | null; items: SearchItem[] } {
  const list = jsonLdNodes(html)
    .map((n) => ItemList.safeParse(n))
    .find((r) => r.success)?.data;
  const items = new Map<string, SearchItem>();
  for (const el of list?.itemListElement ?? []) {
    const li = ListItem.safeParse(el);
    const id = li.success ? DETAIL_ID.exec(li.data.url)?.[1] : undefined;
    if (li.success && id) items.set(id, { id, url: li.data.url, name: li.data.name ?? '' });
  }
  if (!items.size) {
    // No ItemList: fall back to detail links anywhere in the page (they sit in the RSC payload).
    for (const m of html.matchAll(/\/[a-z0-9-]+\/opportunity-detail\/[a-z0-9-]+/g)) {
      const id = DETAIL_ID.exec(m[0])?.[1];
      if (id && !items.has(id)) items.set(id, { id, url: `${BASE}${m[0]}`, name: '' });
    }
  }
  const total = /([\d,]+)\s+Opportunit/i.exec(list?.name ?? '')?.[1];
  return { total: total ? Number(total.replace(/,/g, '')) : null, items: [...items.values()] };
}

/** Next.js streams page data as `self.__next_f.push([1,"…"])` string chunks. */
function flightData(html: string): string {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try {
      const chunk = JSON.parse(m[1]!) as unknown[];
      if (typeof chunk[1] === 'string') out += chunk[1];
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** The JSON object that starts at `start` (brace matching, strings respected). */
function objectAt(s: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
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
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parseDetailPage(html: string): {
  posting: JobPosting | null;
  opportunity: Opportunity | null;
} {
  const node = jsonLdNodes(html).find((n) => {
    const t = n['@type'];
    return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
  });
  const posting = node ? JobPosting.safeParse(node) : null;
  const flight = flightData(html);
  const at = flight.indexOf('"opportunity":{');
  const opp =
    at >= 0 ? Opportunity.safeParse(objectAt(flight, at + '"opportunity":'.length)) : null;
  return {
    posting: posting?.success ? posting.data : null,
    opportunity: opp?.success ? opp.data : null,
  };
}

/** 'Data Analyst Apprentice jobs in IT & Technology London GREATER LONDON' → 'Data Analyst Apprentice'. */
export function cleanTitle(title: string): string {
  const t = collapseSpaces(decodeEntities(title));
  const cut = t.replace(/\s+jobs? in\s.+$/i, '');
  return cut.split(' ').length >= 2 ? cut : t;
}

const PROVIDERS = new Set(rules.providerNames.map(normaliseEmployerName));
const NAME = "[A-Z0-9][\\w&'’.-]*(?:\\s+(?:[A-Z0-9][\\w&'’.-]*|&|of|and|the|for)){0,5}";
const CLIENT_OPENINGS = [
  new RegExp(`^(?:We(?:'|’)re|We are)\\s+(${NAME})\\s*[.!,]`),
  new RegExp(`^(?:Join (?:the team at|us at)|At)\\s+(${NAME})`),
  new RegExp(
    `^(${NAME})\\s+(?:is|are|has|have|was|provides|brings|offers|specialises|specializes|delivers|operates|works|helps|supports|designs|builds|creates|makes|manages)\\b`,
  ),
];
const NOT_A_NAME =
  /^(?:This|Our|We|You|Your|Join|About|As|At|In|Are|Do|Is|If|When|Interested|Looking|Ready|Want|It|They|Here|There|Working)\b|\b(?:Apprentice(?:ship)?s?|Role|Team|Company|Business|Organisation|Programme|Position|Opportunity|Candidate|Job)\b/;

/**
 * Training providers (QA…) post on behalf of a client, who usually opens the advert:
 * 'Grosvenor is an international organisation…', "We're Transform.", 'Join the team at
 * Birmingham Airport…'. Null when unsure (the provider stays as employer).
 */
export function clientFromDescription(text: string | null | undefined): string | null {
  const s = (text ?? '').trim().slice(0, 300);
  for (const re of CLIENT_OPENINGS) {
    const name = re
      .exec(s)?.[1]
      ?.replace(/(?:\s+(?:&|of|and|the|for))+$/, '')
      .replace(/[.,]$/, '')
      .trim();
    if (!name || !/\p{L}/u.test(name) || NOT_A_NAME.test(name) || name === 'The') continue;
    if (PROVIDERS.has(normaliseEmployerName(name))) return null;
    return name;
  }
  return null;
}

const TYPE_LEVEL: Array<[RegExp, number]> = [
  [/degree/i, 6],
  [/higher/i, 4],
  [/advanced/i, 3],
  [/intermediate/i, 2],
];

/** NGTU shows UK dates: '05/10/2026'. */
function ukDate(s: string | null | undefined): string | undefined {
  const m = s ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim()) : null;
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : undefined;
}

function annualSalary(p: JobPosting | null): { min?: number; max?: number } {
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

const plausibleSalary = (n: number | undefined) =>
  n !== undefined && n >= 5_000 && n <= 250_000 ? n : undefined;

function locations(p: JobPosting | null, o: Opportunity | null): Location[] {
  if (o?.townLabel) {
    const county = o.countyLabel ? displayCase(o.countyLabel) : null;
    return [{ text: [o.townLabel, county].filter(Boolean).join(', ') }];
  }
  const places = p?.jobLocation ? [p.jobLocation].flat() : [];
  return places
    .map((pl) => pl.address)
    .filter((a): a is NonNullable<typeof a> => !!a?.addressLocality)
    .map((a) => ({
      text: displayCase(a.addressLocality!),
      postcode: a.postalCode?.trim() || undefined,
    }));
}

/** Detail page → listing; null when NGTU says it isn't an apprenticeship (courses, degrees). */
export function toRawListing(
  item: SearchItem,
  page: ReturnType<typeof parseDetailPage>,
): RawListing | null {
  const p = page.posting;
  const o = page.opportunity;
  const type = o?.opportunityType ?? null;
  if (type && !/apprentic/i.test(type)) return null;
  const title = cleanTitle(p?.title ?? o?.title ?? item.name);
  if (!title) return null;
  const org = collapseSpaces(decodeEntities(p?.hiringOrganization?.name ?? o?.employer ?? ''));
  const descriptionText = p?.description ? htmlToText(p.description) : undefined;
  const client = PROVIDERS.has(normaliseEmployerName(org))
    ? clientFromDescription(descriptionText)
    : null;
  // The JSON-LD squashes ranges into one number ('20000 - 22000' → 2000022000): text first.
  const fromText = parseSalary(o?.salaryDisplay);
  const ld = annualSalary(p);
  const salary = fromText.min
    ? { min: fromText.min, max: fromText.max ?? undefined }
    : { min: plausibleSalary(ld.min), max: plausibleSalary(ld.max) };
  const deadline = p?.validThrough ? parseDate(p.validThrough) : ukDate(o?.deadline);
  const apply =
    o?.applicationLink && /^https?:\/\//i.test(o.applicationLink) ? o.applicationLink : undefined;
  return {
    source: 'ngtu',
    sourceId: item.id,
    url: p?.url || item.url,
    applyUrl: apply,
    title,
    employerName: client ?? (org || 'Unknown employer'),
    providerName: client ? org : undefined,
    descriptionHtml: p?.description || undefined,
    // 'Level 4 Data Analyst' beats a broad 'Higher Apprenticeship' type.
    level: /\blevel\s*[2-7]\b|\bL[2-7]\b/i.test(title)
      ? undefined
      : TYPE_LEVEL.find(([re]) => type && re.test(type))?.[1],
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryText: o?.salaryDisplay ?? undefined,
    postedDate: parseDate(p?.datePosted) ?? ukDate(o?.publishedDate),
    closingDate: deadline ?? undefined,
    locations: locations(p, o),
    knownApprenticeship: type ? true : undefined,
    details: {
      opportunityType: type ?? undefined,
      sector: p?.occupationalCategory ?? o?.sectorLabel ?? undefined,
      deadlineText: o?.deadline && !deadline ? o.deadline : undefined,
    },
    raw: { item, posting: p ? { ...p, description: undefined } : null, opportunity: o },
  };
}

/** Worth a detail fetch? (data/tech words in the title; NGTU confirms the apprenticeship later) */
export function itemLooksRelevant(item: SearchItem): boolean {
  if (!item.name) return true;
  return classify({ title: cleanTitle(item.name), knownApprenticeship: true }).relevant;
}

interface CacheEntry {
  /** Last day the item was on a search page. */
  seen: string;
  /** Parsed listing without its description (the DB keeps that), or null = not wanted. */
  listing: RawListing | null;
}
type Cache = Record<string, CacheEntry>;

export const ngtu: Source = {
  id: 'ngtu',
  enabled: () => true,
  async run(ctx: Ctx): Promise<SourceResult> {
    const get = (url: string) => ctx.http.text(url, { robots: true });

    const items = new Map<string, SearchItem>();
    let total = 0;
    let searchErrors = 0;
    for (const q of QUERIES) {
      try {
        const page = parseSearchPage(
          await get(`${BASE}/opportunities/filter_by/query/${encodeURIComponent(q)}`),
        );
        total += page.total ?? page.items.length;
        for (const it of page.items) items.set(it.id, it);
      } catch (err) {
        searchErrors++;
        ctx.log.warn(`search "${q}": ${(err as Error).message}`);
      }
    }
    if (searchErrors === QUERIES.length) throw new Error('every NGTU search failed');

    const cache = (await ctx.state.get<Cache>(STATE_KEY)) ?? {};
    const next: Cache = {};
    const listings: RawListing[] = [];
    let fetched = 0;
    let skipped = 0;
    let detailErrors = 0;
    let capped = false;
    for (const item of items.values()) {
      const cached = cache[item.id];
      if (cached) {
        next[item.id] = { ...cached, seen: ctx.today };
        if (cached.listing) listings.push(cached.listing);
        continue;
      }
      if (!itemLooksRelevant(item)) {
        skipped++;
        next[item.id] = { seen: ctx.today, listing: null };
        continue;
      }
      if (fetched >= MAX_DETAIL_PAGES) {
        capped = true;
        continue;
      }
      fetched++;
      try {
        const listing = toRawListing(item, parseDetailPage(await get(item.url)));
        next[item.id] = {
          seen: ctx.today,
          listing: listing ? { ...listing, descriptionHtml: undefined, raw: undefined } : null,
        };
        if (listing) listings.push(listing);
      } catch (err) {
        detailErrors++;
        ctx.log.warn(`opportunity ${item.id}: ${(err as Error).message}`);
      }
    }
    // Ads that slipped off page 1 may come back; remember them for a while so we don't refetch.
    for (const [id, e] of Object.entries(cache))
      if (!next[id] && daysBetween(e.seen, ctx.today) < FORGET_DAYS) next[id] = e;
    await ctx.state.set(STATE_KEY, next);

    return {
      listings,
      complete: searchErrors === 0 && detailErrors === 0 && !capped && items.size >= total,
      stats: {
        total,
        listed: items.size,
        pagesFetched: fetched,
        skipped,
        detailErrors,
        capped: capped ? 'yes' : 'no',
      },
    };
  },
};

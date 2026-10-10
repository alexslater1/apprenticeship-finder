import {
  collapseSpaces,
  decodeEntities,
  isApprenticeshipTitle,
  noiseReason,
  parseDate,
  type Location,
  type RawListing,
} from '@af/shared';
import { htmlToText } from '../pipeline/normalise.ts';
import { isUk } from '../pipeline/uk.ts';

export { isUk };
import type { EmployerCtx } from './types.ts';

/** Worth a closer look: the title says apprentice / school leaver / level N, and isn't a coach. */
export function isCandidateTitle(title: string): boolean {
  return isApprenticeshipTitle(title) && !noiseReason(title);
}

/** Keep jobs with at least one UK (or unknown) location. */
export function ukOnly<T extends { locations: Location[] }>(jobs: T[]): T[] {
  return jobs.filter((j) => !j.locations.length || j.locations.some((l) => isUk(l) !== false));
}

export interface PostingFields {
  title?: string;
  descriptionHtml?: string;
  postedDate?: string;
  closingDate?: string;
  locations: Location[];
  employer?: string;
  identifier?: string;
  url?: string;
  employmentType?: string;
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;

/** JSON-LD that's almost JSON: comments, raw newlines in strings (Sellafield's WordPress). */
function parseLenient(src: string): unknown {
  try {
    return JSON.parse(src);
  } catch {
    const cleaned = src
      .replace(/^\s*\/\/.*$/gm, '')
      // Trailing comments after a comma ("…", // if null, include null) — not URLs inside strings.
      .replace(/([,{[])[ \t]*\/\/[^\n"]*(?=\n)/g, '$1')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // eslint-disable-next-line no-control-regex -- raw control characters are the problem here
      .replace(/[\u0000-\u001f]+/g, ' ');
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function postingLocations(p: Json): Location[] {
  const raw = p.jobLocation;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Json[];
  const out: Location[] = [];
  for (const place of list) {
    const a = (place.address ?? place) as Json | string;
    if (typeof a === 'string') {
      out.push({ text: collapseSpaces(decodeEntities(a)) });
      continue;
    }
    const country =
      typeof a.addressCountry === 'object' && a.addressCountry
        ? str((a.addressCountry as Json).name)
        : str(a.addressCountry);
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
      .map(str)
      .filter((x): x is string => !!x);
    const text = collapseSpaces(decodeEntities([...new Set(parts)].join(', ')));
    if (!text && !country) continue;
    out.push({
      text: text || country!,
      city: str(a.addressLocality),
      postcode: str(a.postalCode),
      country,
    });
  }
  if (!out.length && p.jobLocationType === 'TELECOMMUTE') out.push({ text: 'Remote' });
  return out;
}

function fromJsonLd(p: Json): PostingFields {
  const org = p.hiringOrganization as Json | string | undefined;
  const id = p.identifier as Json | string | undefined;
  return {
    title: str(p.title) ? collapseSpaces(decodeEntities(str(p.title)!)) : undefined,
    descriptionHtml: str(p.description) ? decodeEntities(str(p.description)!) : undefined,
    postedDate: parseDate(str(p.datePosted)) ?? undefined,
    closingDate: parseDate(str(p.validThrough)) ?? undefined,
    locations: postingLocations(p),
    employer: typeof org === 'string' ? org : str(org?.name),
    identifier: typeof id === 'string' ? id : str(id?.value),
    url: str(p.url),
    employmentType: Array.isArray(p.employmentType)
      ? p.employmentType.join(', ')
      : str(p.employmentType),
  };
}

function isJobPosting(n: unknown): n is Json {
  const t = (n as Json | null)?.['@type'];
  return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
}

/** schema.org JobPosting from a job page: JSON-LD first, then microdata (research §19.1). */
export function parseJobPosting(html: string): PostingFields | null {
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const j = parseLenient(m[1]!.trim());
    if (!j) continue;
    const nodes: unknown[] = Array.isArray(j) ? j : (((j as Json)['@graph'] as unknown[]) ?? [j]);
    const found = nodes.find(isJobPosting);
    if (found) return fromJsonLd(found);
  }
  return parseMicrodata(html);
}

const attr = (tag: string, name: string) =>
  new RegExp(`${name}=["']([^"']*)["']`, 'i').exec(tag)?.[1];

/** SuccessFactors / SmartRecruiters mark job pages up with itemprop attributes. */
function parseMicrodata(html: string): PostingFields | null {
  if (!/itemtype=["'][^"']*schema\.org\/JobPosting/i.test(html)) return null;
  const prop = (name: string): string | undefined => {
    const re = new RegExp(`<([a-z0-9]+)[^>]*itemprop=["']${name}["'][^>]*>`, 'i');
    const m = re.exec(html);
    if (!m) return undefined;
    const content = attr(m[0], 'content');
    if (content) return decodeEntities(content).trim();
    // Inner HTML up to the matching close tag (good enough for these templates).
    const start = m.index + m[0].length;
    const end = html.indexOf(`</${m[1]}>`, start);
    return end > start ? html.slice(start, end).trim() : undefined;
  };
  const title = prop('title');
  const location = [prop('addressLocality'), prop('addressRegion'), prop('addressCountry')]
    .filter(Boolean)
    .map((x) => htmlToText(x!))
    .join(', ');
  const jobLocation = location || (prop('jobLocation') ? htmlToText(prop('jobLocation')!) : '');
  return {
    title: title ? collapseSpaces(htmlToText(title)) : undefined,
    descriptionHtml: prop('description'),
    postedDate: parseDate(prop('datePosted')) ?? undefined,
    closingDate: parseDate(prop('validThrough')) ?? undefined,
    locations: jobLocation ? [{ text: collapseSpaces(jobLocation) }] : [],
    employer: prop('hiringOrganization') ? htmlToText(prop('hiringOrganization')!) : undefined,
  };
}

/** The organisation a page belongs to: og:site_name, else the part of <title> after ' | '. */
export function employerFromPage(html: string): string | undefined {
  const site = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i.exec(
    html,
  )?.[1];
  if (site) return collapseSpaces(decodeEntities(site));
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const tail = title
    ? decodeEntities(title)
        .split(/\s+[|–-]\s+/)
        .at(-1)
        ?.trim()
    : undefined;
  return tail && tail.length <= 60 ? tail : undefined;
}

/** `<title>` / og:title / h1 for pages with no JobPosting. */
export function pageTitle(html: string): string | undefined {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const t = h1 ? htmlToText(h1) : og ? decodeEntities(og) : undefined;
  return t ? collapseSpaces(t) : undefined;
}

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

/** URLs from a urlset, a sitemap index (child sitemaps returned separately) or an RSS feed. */
export function parseSitemap(xml: string): { urls: SitemapEntry[]; sitemaps: string[] } {
  const urls: SitemapEntry[] = [];
  const sitemaps: string[] = [];
  const unwrap = (s: string) => decodeEntities(s.replace(/<!\[CDATA\[|\]\]>/g, '').trim());
  if (/<sitemapindex/i.test(xml)) {
    for (const m of xml.matchAll(/<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi))
      sitemaps.push(unwrap(m[1]!));
    return { urls, sitemaps };
  }
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(m[1]!)?.[1];
    if (!loc) continue;
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(m[1]!)?.[1];
    urls.push({ url: unwrap(loc), lastmod: lastmod ? unwrap(lastmod) : null });
  }
  if (!urls.length)
    for (const m of xml.matchAll(/<item>[\s\S]*?<link>([\s\S]*?)<\/link>/gi))
      urls.push({ url: unwrap(m[1]!), lastmod: null });
  return { urls, sitemaps };
}

/** Some boards (Tesco) answer the first sitemap request with an empty 200 while they build it. */
async function sitemapText(ctx: EmployerCtx, url: string): Promise<string> {
  const first = await ctx.http.text(url, { robots: true });
  return first.trim() ? first : ctx.http.text(url, { robots: true });
}

/** Every URL in a sitemap, following up to `maxChildren` child sitemaps of an index. */
export async function sitemapUrls(
  ctx: EmployerCtx,
  url: string,
  o: { maxChildren?: number; childFilter?: (u: string) => boolean } = {},
): Promise<SitemapEntry[]> {
  const first = parseSitemap(await sitemapText(ctx, url));
  const out = [...first.urls];
  const children = first.sitemaps
    .filter(o.childFilter ?? (() => true))
    .slice(0, o.maxChildren ?? 10);
  for (const child of children) out.push(...parseSitemap(await sitemapText(ctx, child)).urls);
  return out;
}

/** The words in a URL slug: '/job/Glasgow-Data-Analyst-Apprentice/123/' → 'Glasgow Data Analyst Apprentice'. */
export function slugWords(url: string): string {
  const path = decodeURIComponent(new URL(url, 'https://x').pathname);
  return path
    .replace(/[-_/+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripHtml(html: string | undefined): string | undefined {
  return html ? htmlToText(html) : undefined;
}

/** A RawListing for this employer, with the employer's own name (FAA etc. use legal names). */
export function employerListing(
  ctx: EmployerCtx,
  l: Omit<RawListing, 'source' | 'employerName' | 'employerId'> & { employerName?: string },
): RawListing {
  return {
    ...l,
    source: ctx.source,
    employerName: ctx.employer.name,
    employerId: ctx.employer.id,
    title: collapseSpaces(decodeEntities(l.title)),
  };
}

interface CacheEntry {
  sig: string;
  listing: RawListing | null;
}

/**
 * Detail fetching with a per-employer cache in `source_state` (`employer:{id}:jobs`): a job is
 * re-fetched only when its list-level signature changes or it isn't stored yet, so a daily run
 * costs one detail call per *new* apprenticeship. Cached listings carry no description (the
 * stored one is kept by persist).
 */
export async function withDetails<T>(
  ctx: EmployerCtx,
  items: T[],
  o: {
    id: (t: T) => string;
    sig?: (t: T) => string;
    detail: (t: T) => Promise<RawListing | null>;
    /** List-level listing when the cap is hit or the detail call fails. */
    fallback?: (t: T) => RawListing | null;
    cap?: number;
  },
): Promise<{ listings: RawListing[]; detailed: number; errors: number }> {
  const key = `${ctx.source}:jobs`;
  const cache = (await ctx.state.get<Record<string, CacheEntry>>(key)) ?? {};
  const next: Record<string, CacheEntry> = {};
  const listings: RawListing[] = [];
  let detailed = 0;
  let errors = 0;
  const cap = o.cap ?? 40;
  for (const item of items) {
    const id = o.id(item);
    const sig = o.sig?.(item) ?? '';
    const hit = cache[id];
    // Reuse a cached detail when nothing changed and the job is stored (or wasn't worth storing).
    if (hit && hit.sig === sig && (hit.listing === null || ctx.known.has(id))) {
      next[id] = hit;
      if (hit.listing) listings.push(hit.listing);
      continue;
    }
    let listing: RawListing | null = null;
    if (detailed < cap) {
      detailed++;
      try {
        listing = await o.detail(item);
        next[id] = {
          sig,
          listing: listing
            ? { ...listing, descriptionHtml: undefined, descriptionText: undefined, raw: undefined }
            : null,
        };
      } catch (err) {
        errors++;
        ctx.log.warn(`detail ${id}: ${(err as Error).message}`);
        if (hit) next[id] = hit;
      }
    } else if (hit) {
      next[id] = hit;
    }
    listing ??= hit?.listing ?? o.fallback?.(item) ?? null;
    if (listing) listings.push(listing);
  }
  await ctx.state.set(key, next);
  return { listings, detailed, errors };
}

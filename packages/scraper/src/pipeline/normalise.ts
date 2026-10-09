import {
  rules,
  classify,
  collapseSpaces,
  decodeEntities,
  normaliseEmployerName,
  parseSalary,
  type Classification,
  type Location,
  type Nation,
  type RawListing,
} from '@af/shared';
import { decode as decodeHtml } from 'he';
import { placeByName } from '@af/shared/places';
import sanitizeHtml from 'sanitize-html';
import { dedupeKey } from './dedupe.ts';

/** Scraped HTML is untrusted: keep simple formatting and links only (the UI sanitises again). */
export function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'ul',
      'ol',
      'li',
      'strong',
      'b',
      'em',
      'i',
      'u',
      'a',
      'h2',
      'h3',
      'h4',
      'h5',
      'blockquote',
    ],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      }),
      h1: 'h3',
      h2: 'h3',
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'p' && !frame.text.trim() && !frame.mediaChildren.length,
  }).trim();
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return collapseSpaces(decodeHtml(decodeEntities(text)));
}

export interface SourceRef {
  source: string;
  sourceId: string;
  url: string;
  raw?: unknown;
}

/** One listing after normalise + classify, before it is merged with what's stored. */
export interface NormalisedListing {
  dedupeKey: string;
  title: string;
  employerName: string;
  employerNameNorm: string;
  url: string;
  applyUrl: string | null;
  descriptionHtml: string | null;
  descriptionText: string | null;
  classification: Classification;
  larsCode: number | null;
  standardTitle: string | null;
  providerName: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string | null;
  postedDate: string | null;
  closingDate: string | null;
  startDate: string | null;
  locations: Location[];
  primaryCity: string | null;
  region: string | null;
  nation: Nation;
  isNational: boolean;
  details: Record<string, unknown> | null;
  isLead: boolean;
  sources: SourceRef[];
}

const PROVIDERS = new Set(rules.providerNames.map(normaliseEmployerName));

/**
 * Training providers post 'Data Analyst Apprenticeship - Grosvenor' under their own name.
 * Return the real employer so the advert matches the employer's own FAA listing.
 */
export function splitProviderTitle(
  title: string,
  employer: string,
): { title: string; employer: string; provider: string } | null {
  if (!PROVIDERS.has(normaliseEmployerName(employer))) return null;
  const m = /^(.+?)\s+[-–|]\s+([^-–|]+)$/.exec(title);
  if (!m) return null;
  const [, role, client] = m as unknown as [string, string, string];
  const c = client.trim();
  if (c.split(/\s+/).length > 6 || /apprentic|\blevel\b/i.test(c) || placeByName(c)) return null;
  // The role must be on the left ('Junior Data Analyst Level 3 Apprenticeship - Terberg DTS').
  if (classify({ title: role }).roleVia !== 'title') return null;
  return { title: role.trim(), employer: c, provider: employer };
}

/** Boards fill 'ongoing' adverts with far-future placeholders (Higherin: 2036-01-01). */
export function plausibleDeadline(date: string | undefined, now = new Date()): string | null {
  if (!date) return null;
  const limit = new Date(now.getTime() + 2 * 365 * 86_400_000).toISOString().slice(0, 10);
  return date > limit ? null : date;
}

const RAW_LIMIT = 20_000;

function trimRaw(raw: unknown): unknown {
  if (raw === undefined) return undefined;
  const s = JSON.stringify(raw);
  return s.length <= RAW_LIMIT ? raw : { truncated: true, preview: s.slice(0, RAW_LIMIT) };
}

function compact<T extends Record<string, unknown>>(o: T | undefined): T | null {
  if (!o) return null;
  const entries = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? (Object.fromEntries(entries) as T) : null;
}

/**
 * Normalise + classify one raw listing. Returns null for anything that isn't a relevant
 * apprenticeship (99% of employer-site jobs get dropped here). Locations must already be
 * geocoded (see geocode.ts) so the primary city is known.
 */
export function normalise(raw: RawListing): NormalisedListing | null {
  let title = collapseSpaces(decodeEntities(raw.title));
  let employerName = collapseSpaces(decodeEntities(raw.employerName));
  let providerName = raw.providerName ?? null;
  const split = splitProviderTitle(title, employerName);
  if (split) {
    title = split.title;
    employerName = split.employer;
    providerName ??= split.provider;
  }
  const descriptionHtml = raw.descriptionHtml ? sanitize(raw.descriptionHtml) : null;
  const descriptionText =
    raw.descriptionText ?? (descriptionHtml ? htmlToText(descriptionHtml) : null) ?? null;

  const classification = classify({
    title,
    descriptionText: descriptionText ?? undefined,
    level: raw.level,
    larsCode: raw.larsCode,
    standardTitle: raw.standardTitle,
    roleHint: raw.roleHint,
    knownApprenticeship: raw.knownApprenticeship,
  });
  if (!classification.relevant) return null;

  const salary =
    raw.salaryMin !== undefined
      ? { min: raw.salaryMin, max: raw.salaryMax ?? null }
      : parseSalary(raw.salaryText);

  const employerNameNorm = normaliseEmployerName(employerName) || 'unknown';
  const locations = raw.locations.map(({ lines: _lines, ...l }) => l);
  const first = locations[0];
  const nation: Nation = raw.isNational ? 'UK-wide' : (first?.nation ?? 'Unknown');
  const primaryCity = first?.city ?? null;

  return {
    dedupeKey: dedupeKey(
      employerNameNorm,
      title,
      primaryCity,
      locations.map((l) => l.city),
    ),
    title,
    employerName,
    employerNameNorm,
    url: raw.url,
    applyUrl: raw.applyUrl ?? null,
    descriptionHtml: descriptionHtml || null,
    descriptionText: descriptionText || null,
    classification,
    larsCode: raw.larsCode ?? null,
    standardTitle: raw.standardTitle ?? classification.standard?.title ?? null,
    providerName,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryText: raw.salaryText ?? null,
    postedDate: raw.postedDate ?? null,
    closingDate: plausibleDeadline(raw.closingDate),
    startDate: raw.startDate ?? null,
    locations,
    primaryCity,
    region: first?.region ?? null,
    nation,
    isNational: !!raw.isNational,
    details: compact(raw.details),
    isLead: !!raw.isLead,
    sources: [{ source: raw.source, sourceId: raw.sourceId, url: raw.url, raw: trimRaw(raw.raw) }],
  };
}

/** Merge listings that share a dedupe key within one run (same job posted twice, or on two sources). */
export function mergeWithinRun(listings: NormalisedListing[]): NormalisedListing[] {
  const byKey = new Map<string, NormalisedListing>();
  for (const l of listings) {
    const prev = byKey.get(l.dedupeKey);
    if (!prev) {
      byKey.set(l.dedupeKey, { ...l, sources: [...l.sources] });
      continue;
    }
    const seen = new Set(prev.sources.map((s) => `${s.source}|${s.sourceId}`));
    for (const s of l.sources) if (!seen.has(`${s.source}|${s.sourceId}`)) prev.sources.push(s);
    if ((l.descriptionText?.length ?? 0) > (prev.descriptionText?.length ?? 0)) {
      prev.descriptionHtml = l.descriptionHtml;
      prev.descriptionText = l.descriptionText;
    }
    if (l.postedDate && (!prev.postedDate || l.postedDate < prev.postedDate))
      prev.postedDate = l.postedDate;
    if (l.closingDate && (!prev.closingDate || l.closingDate > prev.closingDate))
      prev.closingDate = l.closingDate;
    prev.applyUrl ??= l.applyUrl;
    prev.salaryMin ??= l.salaryMin;
    prev.salaryMax ??= l.salaryMax;
    prev.salaryText ??= l.salaryText;
  }
  return [...byKey.values()];
}

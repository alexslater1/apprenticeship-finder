import {
  classify,
  collapseSpaces,
  decodeEntities,
  displayCase,
  parseDate,
  type Location,
  type RawListing,
} from '@af/shared';
import { z } from 'zod';
import { htmlToText } from '../pipeline/normalise.ts';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * Careers Wales apprenticeship search API, research/devolved-nations.md §2a. Open and
 * unauthenticated; paging and sort go in request headers, and "no results" is a 204. Wales has
 * only ~40 live vacancies (degree apprenticeships are advertised by employers, not here), so
 * this is for completeness: the Digital Technology sector plus keyword "data", then the detail
 * endpoint (by slug) for new relevant ones. Terms allow personal and research use.
 *
 * Keyword/sector-limited: `complete` means "everything these two queries return".
 */
const API = 'https://api.careerswales.gov.wales/apprenticeships-api/api/v1/apprenticeships';
const SITE = 'https://careerswales.gov.wales/apprenticeship-search/results';
const GROUP_SIZE = 100;
const MAX_PAGES = 5;

export const QUERIES: Array<[label: string, params: Record<string, string>]> = [
  ['sector 10 (Digital Technology)', { apprenticeshipSector: '10' }],
  ['keyword data', { keywords: 'data' }],
];

export const Item = z
  .object({
    id: z.union([z.number(), z.string()]).transform(String),
    slug: z.string(),
    title: z.string(),
    employer: z.string().nullish(),
    closingDate: z.string().nullish(),
    location: z.string().nullish(),
    coordinates: z.string().nullish(),
    apprenticeshipLevel: z.number().nullish(),
    payDetails: z.string().nullish(),
  })
  .loose();
export type Item = z.infer<typeof Item>;

const Page = z
  .object({
    results: z.number().nullish(),
    pages: z.number().nullish(),
    data: z.array(z.unknown()).nullish(),
  })
  .loose();

const str = z.string().nullish();

export const Detail = z
  .object({
    id: z.union([z.number(), z.string()]).transform(String),
    title: z.string(),
    slug: z.string().nullish(),
    apprenticeshipLevel: z.number().nullish(),
    pay: str,
    closingDate: str,
    hours: z.number().nullish(),
    positions: z.number().nullish(),
    about: z.object({ duties: str, additionalInformation: str }).loose().nullish(),
    requirements: z
      .object({
        requiredQualifications: str,
        desirableQualifications: str,
        skills: str,
        welshSpoken: z.boolean().nullish(),
        welshWritten: z.boolean().nullish(),
      })
      .loose()
      .nullish(),
    training: z.object({ trainingProvider: str, trainingProviderCourse: str }).loose().nullish(),
    apprenticeshipDisabilityConfident: z.boolean().nullish(),
    employerDetails: z
      .object({
        name: str,
        address: z
          .object({ addressLine1: str, addressLine2: str, locality: str, postCode: str })
          .loose()
          .nullish(),
      })
      .loose()
      .nullish(),
    apply: z.object({ format: str, url: str, additionalInstructions: str }).loose().nullish(),
    interview: str,
  })
  .loose();
export type Detail = z.infer<typeof Detail>;

/** Careers Wales level bands: 1 Foundation (L2), 2 Apprenticeship (L3), 3 Higher (L4–5), 4 Degree (L6). */
const BAND_LEVEL: Record<number, number> = { 1: 2, 2: 3, 4: 6 };
const BAND_NAMES: Record<number, string> = {
  1: 'Foundation Apprenticeship (Level 2)',
  2: 'Apprenticeship (Level 3)',
  3: 'Higher Apprenticeship (Level 4 and 5)',
  4: 'Degree Apprenticeship (Level 6)',
};
const HOURS: Record<number, string> = {
  1: '16–30 hours a week',
  2: '31–40 hours a week',
  3: 'Over 41 hours a week',
};

/**
 * The band's level. Higher spans L4–5, so it takes the course name ("Apprenticeship Level 4 –
 * Software Developer"), else 4; with no detail (`course` undefined) it stays unset so the title
 * or the stored level decides rather than flipping a known L5 back to 4.
 */
export function walesLevel(
  band: number | null | undefined,
  course?: string | null,
): number | undefined {
  if (band !== 3) return band ? BAND_LEVEL[band] : undefined;
  if (course === undefined) return undefined;
  const stated = Number(/\blevel\s*([45])\b/i.exec(course ?? '')?.[1]);
  return stated || 4;
}

/** Search-card data only, so the decision is the same on days we skip the detail call. */
export function isRelevantItem(i: Item): boolean {
  return classify({
    title: i.title,
    level: walesLevel(i.apprenticeshipLevel),
    knownApprenticeship: true,
  }).relevant;
}

function composeDescription(d: Detail): string {
  const sections: Array<[string | null, string | null | undefined]> = [
    [null, d.about?.duties],
    ['More information', d.about?.additionalInformation],
    ['Qualifications needed', d.requirements?.requiredQualifications],
    ['Desirable', d.requirements?.desirableQualifications],
    ['Skills', d.requirements?.skills],
    ['Training', d.training?.trainingProviderCourse],
    ['How to apply', d.apply?.additionalInstructions],
    ['Interview', d.interview],
  ];
  const seen = new Set<string>();
  return sections
    .filter(([, body]) => {
      const t = body?.trim();
      if (!t || t === '-' || seen.has(t)) return false; // employers paste skills into both fields
      seen.add(t);
      return true;
    })
    .map(([h, body]) => {
      const html = /<[a-z]/i.test(body!) ? body! : `<p>${body}</p>`;
      return h ? `<h3>${h}</h3>\n${html}` : html;
    })
    .join('\n');
}

function locations(i: Item, d?: Detail): Location[] {
  const [lat, lon] = (i.coordinates ?? '').split(',').map(Number);
  const text = i.location?.trim() || d?.employerDetails?.address?.locality?.trim();
  if (!text) return [];
  return [
    {
      text,
      postcode: d?.employerDetails?.address?.postCode?.trim() || undefined,
      lat: Number.isFinite(lat) && lat ? lat : undefined,
      lon: Number.isFinite(lon) && lon ? lon : undefined,
      nation: 'Wales',
      // The card's town ('Monmouth') names the city better than the nearest gazetteer place.
      lines: [text],
    },
  ];
}

export function toRawListing(i: Item, d?: Detail): RawListing {
  const html = d ? composeDescription(d) : '';
  const course = d?.training?.trainingProviderCourse?.trim();
  const provider = d?.training?.trainingProvider?.trim();
  const applyUrl = d?.apply?.format === 'url' ? d.apply.url?.trim() : undefined;
  const pay = (d?.pay ?? i.payDetails)?.trim();
  return {
    source: 'wales',
    sourceId: i.id,
    url: `${SITE}/${encodeURIComponent(i.slug)}`,
    applyUrl: applyUrl && /^https?:\/\//i.test(applyUrl) ? applyUrl : undefined,
    title: collapseSpaces(decodeEntities(i.title)),
    employerName: displayCase(d?.employerDetails?.name ?? i.employer ?? 'Unknown employer'),
    descriptionHtml: html || undefined,
    descriptionText: html ? htmlToText(html) : undefined,
    level: walesLevel(i.apprenticeshipLevel, d ? (course ?? null) : undefined),
    standardTitle: course || undefined,
    providerName: provider || undefined,
    salaryText: pay || undefined,
    closingDate: parseDate(i.closingDate) ?? undefined,
    locations: locations(i, d),
    knownApprenticeship: true,
    details: {
      band: i.apprenticeshipLevel ? BAND_NAMES[i.apprenticeshipLevel] : undefined,
      hours: d?.hours ? HOURS[d.hours] : undefined,
      positions: d?.positions || undefined,
      applyBy: d?.apply?.format || undefined,
      welshSpoken: d?.requirements?.welshSpoken || undefined,
      welshWritten: d?.requirements?.welshWritten || undefined,
      disabilityConfident: d?.apprenticeshipDisabilityConfident || undefined,
    },
    // The apply block can hold a named person's email; keep only the card.
    raw: i,
  };
}

const HEADERS = { 'Accept-Language': 'en', groupSize: String(GROUP_SIZE), order: 'closingDateAsc' };

export const wales: Source = {
  id: 'wales',
  enabled: () => true,
  async run(ctx: Ctx): Promise<SourceResult> {
    const items = new Map<string, Item>();
    let errors = 0;
    let invalid = 0;
    let capped = false;
    let calls = 0;
    for (const [label, params] of QUERIES) {
      try {
        let pages = 1;
        for (let page = 1; page <= pages; page++) {
          if (page > MAX_PAGES) {
            capped = true;
            break;
          }
          calls++;
          const res = await ctx.http.request(`${API}/q?${new URLSearchParams(params)}`, {
            headers: { ...HEADERS, Accept: 'application/json', page: String(page) },
          });
          if (res.status === 204 || !res.body.trim()) break; // no results
          const body = Page.parse(JSON.parse(res.body));
          pages = body.pages ?? 1;
          for (const raw of body.data ?? []) {
            const i = Item.safeParse(raw);
            if (i.success) items.set(i.data.id, i.data);
            else invalid++;
          }
        }
      } catch (err) {
        errors++;
        ctx.log.warn(`${label}: ${(err as Error).message}`);
      }
    }
    if (errors === QUERIES.length) throw new Error('every Careers Wales query failed');

    const relevant = [...items.values()].filter(isRelevantItem);
    const known = await ctx.knownSourceIds('wales');
    const listings: RawListing[] = [];
    let detailed = 0;
    let detailErrors = 0;
    for (const i of relevant) {
      let d: Detail | undefined;
      if (!known.has(i.id)) {
        try {
          d = Detail.parse(
            await ctx.http.json(`${API}/${encodeURIComponent(i.slug)}`, {
              headers: { 'Accept-Language': 'en' },
            }),
          );
          detailed++;
        } catch (err) {
          detailErrors++;
          ctx.log.warn(`detail ${i.slug}: ${(err as Error).message}`);
        }
      }
      listings.push(toRawListing(i, d));
    }

    return {
      listings,
      complete: errors === 0 && invalid === 0 && !capped && detailErrors === 0,
      stats: {
        scope: 'sector 10 + keyword "data"',
        calls,
        vacancies: items.size,
        relevant: relevant.length,
        detailFetched: detailed,
        detailErrors,
        errors,
        invalid,
      },
    };
  },
};

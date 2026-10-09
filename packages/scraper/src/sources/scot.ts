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
import { BlockedError, HttpError } from '../http.ts';
import { htmlToText } from '../pipeline/normalise.ts';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * apprenticeships.scot (Skills Development Scotland), research/devolved-nations.md §1a.
 * The vacancy search is a browser island that calls SDS's Azure APIM gateway with a key from
 * its own public JS bundle, so we read the key from that bundle at run time (cached; re-read on
 * 401). Daily: one search for every Graduate Apprenticeship (Scotland's degree route), one
 * keyword search of Modern Apprenticeships, then the detail endpoint only for new relevant refs
 * (it adds the framework name). robots.txt disallows the /vacancy-details/ pages; we only link
 * to them. Terms: personal, non-commercial use, which this is.
 *
 * The MA half is keyword-limited, so `complete` means "everything these two searches return",
 * which is what we store: a stored MA listing that stops matching has closed.
 */
const SITE = 'https://www.apprenticeships.scot';
const API = 'https://sdsapi-prod.azure-api.net/vacancy';
const KEY_STATE = 'scot:apim';
const FRAMEWORK_STATE = 'scot:frameworks';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MAX_DETAILS = 30;

/** Azure Search simple syntax: `|` is OR. Full-text over the description too, so noisy. */
export const MA_KEYWORDS = 'data|analyst|analytics|AI|software|developer|cyber|"machine learning"';

const SEARCHES: Array<{ type: 'GA' | 'MA'; keywords: string }> = [
  { type: 'GA', keywords: '' },
  { type: 'MA', keywords: MA_KEYWORDS },
];

const TYPE_NAMES: Record<string, string> = {
  GA: 'Graduate Apprenticeship',
  MA: 'Modern Apprenticeship',
  FA: 'Foundation Apprenticeship',
};

/** The search index serialises numbers as strings ("18000.0000"); the detail endpoint doesn't. */
const num = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    const n = v === null || v === undefined || v === '' ? NaN : Number(v);
    return Number.isFinite(n) ? n : undefined;
  });

/** A search hit's `document` (PascalCase). Contact fields exist but we never keep them. */
export const Doc = z
  .object({
    RefCode: z.union([z.string(), z.number()]).transform(String),
    JobTitle: z.string(),
    VacancyType: z.string().nullish(),
    EmployerName: z.string().nullish(),
    HideEmployerName: z.boolean().nullish(),
    TrainingProviderName: z.string().nullish(),
    EmployerWebsite: z.string().nullish(),
    City: z.string().nullish(),
    Postcode: z.string().nullish(),
    LocalAuthority: z.string().nullish(),
    GeoLocationLat: num,
    GeoLocationLon: num,
    PositionsAvailable: num,
    MinSalary: num,
    MaxSalary: num,
    SalaryFrequency: z.string().nullish(),
    WorkingHours: num,
    TypeOfEmployment: z.string().nullish(),
    DescriptionOverview: z.string().nullish(),
    DescriptionTypicalDay: z.string().nullish(),
    DescriptionLearn: z.string().nullish(),
    DescriptionQualifications: z.string().nullish(),
    EntryRequirement: z.string().nullish(),
    ApplicationWebAddress: z.string().nullish(),
    PreferredApplyMethod: z.string().nullish(),
    ModernApprenticeshipLevel: z.string().nullish(),
    JobFamily: z.string().nullish(),
    Framework: z.string().nullish(),
    ClosingDate: z.string().nullish(),
    FirstPublishedDate: z.string().nullish(),
    Nationwide: z.boolean().nullish(),
    IsTwoTicks: z.boolean().nullish(),
  })
  .loose();
export type Doc = z.infer<typeof Doc>;

const SearchPage = z
  .object({
    count: z.number().nullish(),
    // null (not []) when nothing matches
    results: z.array(z.object({ document: z.unknown() }).loose()).nullish(),
    isRelatedVacancies: z.boolean().nullish(),
  })
  .loose();

/** `/vacancy/ref/{RefCode}` (camelCase): the search document plus the framework's name. */
export const Detail = z
  .object({
    refCode: z.union([z.string(), z.number()]).transform(String),
    framework: z.string().nullish(),
    frameworkName: z.string().nullish(),
  })
  .loose();

/** The SPA's search island, e.g. /_astro/VacancySearchApp.7d10da6a.js. */
export function findBundleUrl(html: string): string | null {
  const m =
    /["'](\/_astro\/VacancySearchApp\.[\w-]+\.js)["']/.exec(html) ??
    /component-url="(\/_astro\/[^"]*Vacanc[^"]*\.js)"/i.exec(html);
  return m ? new URL(m[1]!, SITE).toString() : null;
}

/**
 * The APIM key the bundle sends to the vacancy API. The bundle also carries a key for My World
 * of Work's feed, so take the one whose nearest preceding URL is the SDS gateway.
 */
export function extractApimKey(js: string): string | null {
  for (const m of js.matchAll(/ocp-apim-subscription-key["']?\s*:\s*["']([0-9a-f]{32})["']/gi)) {
    const at = js.lastIndexOf('https://', m.index);
    const host = at >= 0 ? /^https:\/\/([\w.-]+)/.exec(js.slice(at))?.[1] : undefined;
    if (host === new URL(API).hostname) return m[1]!;
  }
  return null;
}

const SCQF_TO_RQF: Record<number, number> = { 5: 2, 6: 3, 7: 3, 8: 4, 9: 6, 10: 6, 11: 7 };

/**
 * England-equivalent level. A GA is a degree (6; 7 at SCQF 11, the master's GAs); its SCQF
 * field is unreliable (Thales' degree GA says 8). MAs map SCQF to RQF.
 */
export function scotLevel(d: Doc): number | undefined {
  const scqf = Number(/SCQF\s*level\s*(\d+)/i.exec(d.ModernApprenticeshipLevel ?? '')?.[1]);
  if ((d.VacancyType ?? '').toUpperCase() === 'GA') return scqf === 11 ? 7 : 6;
  return SCQF_TO_RQF[scqf];
}

function standardTitle(d: Doc, frameworkName: string | undefined): string | undefined {
  if (!frameworkName?.trim()) return undefined;
  const type = TYPE_NAMES[(d.VacancyType ?? '').toUpperCase()];
  return type ? `${frameworkName.trim()} (${type})` : frameworkName.trim();
}

/** Worth a detail call / worth keeping: title or framework points at a data/tech role. */
export function isRelevantDoc(d: Doc, frameworkName?: string): boolean {
  // Foundation Apprenticeships are school-pupil courses, not jobs.
  if ((d.VacancyType ?? '').toUpperCase() === 'FA') return false;
  return classify({
    title: d.JobTitle,
    level: scotLevel(d),
    standardTitle: standardTitle(d, frameworkName),
    knownApprenticeship: true,
  }).relevant;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** SDS descriptions are plain text with newlines: blank line = paragraph, newline = <br>. */
export function textToHtml(text: string): string {
  if (/<(p|br|ul|li|strong|div)\b/i.test(text)) return text;
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export function composeDescription(d: Doc): string {
  const sections: Array<[string | null, string | null | undefined]> = [
    [null, d.DescriptionOverview],
    ['A typical day', d.DescriptionTypicalDay],
    ['What you’ll learn', d.DescriptionLearn],
    ['What you need', d.DescriptionQualifications],
    ['Entry requirements', d.EntryRequirement],
  ];
  return sections
    .filter(([, body]) => body && body.trim())
    .map(([h, body]) => (h ? `<h3>${h}</h3>\n${textToHtml(body!)}` : textToHtml(body!)))
    .join('\n');
}

const gbp = (n: number) =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Yearly or hourly pay (hourly → yearly over the advertised hours), or the minimum-wage flag. */
export function scotSalary(d: Doc): { min?: number; max?: number; text?: string } {
  const freq = (d.SalaryFrequency ?? '').toLowerCase();
  if (/minimum/.test(freq)) return { text: 'Apprentice minimum wage' };
  const min = d.MinSalary || undefined;
  const max = d.MaxSalary && d.MaxSalary !== min ? d.MaxSalary : undefined;
  if (!min || (freq !== 'hour' && freq !== 'year')) return {};
  const mult = freq === 'hour' ? (d.WorkingHours || 37.5) * 52 : 1;
  const range = max ? `${gbp(min)}–${gbp(max)}` : gbp(min);
  return {
    min: Math.round(min * mult),
    max: max ? Math.round(max * mult) : undefined,
    text: `${range} ${freq === 'hour' ? 'an hour' : 'a year'}`,
  };
}

function locations(d: Doc): Location[] {
  const lines = (d.City ?? '')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  const postcode = d.Postcode ? collapseSpaces(d.Postcode) : undefined;
  if (!lines.length && !postcode) return [];
  // Unplaced vacancies carry 0,0.
  const placed = !!d.GeoLocationLat && !!d.GeoLocationLon;
  return [
    {
      text: [lines[0], postcode].filter(Boolean).join(', '),
      postcode,
      lat: placed ? d.GeoLocationLat : undefined,
      lon: placed ? d.GeoLocationLon : undefined,
      nation: 'Scotland',
      lines,
    },
  ];
}

const DROP_RAW =
  /^(Contact|Telephone|CreatedBy|UpdatedBy|DeletedBy|PassportUserId|Comments|Statistic|Description)/i;

/** Drop contact details, ids of SDS users and long text from the raw copy we keep. */
function trimRaw(d: Doc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (DROP_RAW.test(k) || v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

export function toRawListing(d: Doc, frameworkName?: string): RawListing {
  const type = (d.VacancyType ?? '').toUpperCase();
  const html = composeDescription(d);
  const pay = scotSalary(d);
  const provider = d.TrainingProviderName ? collapseSpaces(d.TrainingProviderName) : '';
  const apply = d.ApplicationWebAddress?.trim();
  return {
    source: 'scot',
    sourceId: d.RefCode,
    url: `${SITE}/vacancy-details/?refCode=${encodeURIComponent(d.RefCode)}`,
    applyUrl: apply && /^https?:\/\//i.test(apply) ? apply : undefined,
    title: collapseSpaces(decodeEntities(d.JobTitle)),
    // Some adverts ask SDS not to show the employer (the provider recruits for them).
    employerName:
      d.HideEmployerName || !d.EmployerName?.trim()
        ? 'Unknown employer'
        : displayCase(d.EmployerName),
    descriptionHtml: html || undefined,
    descriptionText: html ? htmlToText(html) : undefined,
    level: scotLevel(d),
    standardTitle: standardTitle(d, frameworkName),
    providerName: provider || undefined,
    salaryMin: pay.min,
    salaryMax: pay.max,
    salaryText: pay.text,
    postedDate: parseDate(d.FirstPublishedDate) ?? undefined,
    closingDate: parseDate(d.ClosingDate) ?? undefined,
    locations: locations(d),
    knownApprenticeship: true,
    details: {
      apprenticeshipType: TYPE_NAMES[type],
      scqfLevel: d.ModernApprenticeshipLevel || undefined,
      framework: frameworkName || undefined,
      jobFamily: d.JobFamily || undefined,
      hoursPerWeek: d.WorkingHours || undefined,
      positions: d.PositionsAvailable || undefined,
      employment:
        d.TypeOfEmployment === 'Full'
          ? 'Full time'
          : d.TypeOfEmployment === 'Part'
            ? 'Part time'
            : undefined,
      employerWebsite: d.EmployerWebsite || undefined,
      employerHidden: d.HideEmployerName || undefined,
      nationwide: d.Nationwide || undefined,
      disabilityConfident: d.IsTwoTicks || undefined,
      localAuthority: d.LocalAuthority || undefined,
    },
    raw: trimRaw(d),
  };
}

const isAuthError = (err: unknown) =>
  err instanceof HttpError && (err.status === 401 || err.status === 403);

/** Calls the gateway with the page's key: cached key first, re-read from the bundle on 401. */
function gateway(ctx: Ctx) {
  let key: string | undefined;
  let fromCache = false;

  async function load(refresh: boolean): Promise<void> {
    if (!refresh) {
      const cached = await ctx.state.get<{ key?: string }>(KEY_STATE);
      if (cached?.key) {
        key = cached.key;
        fromCache = true;
        return;
      }
    }
    const page = await ctx.http.text(`${SITE}/find-a-vacancy/`, { robots: true });
    const bundle = findBundleUrl(page);
    if (!bundle) throw new Error('vacancy search bundle not found on /find-a-vacancy/');
    const found = extractApimKey(await ctx.http.text(bundle, { robots: true }));
    if (!found) throw new Error(`no APIM key for ${new URL(API).hostname} in ${bundle}`);
    key = found;
    fromCache = false;
    await ctx.state.set(KEY_STATE, { key, bundle, readOn: ctx.today });
  }

  return async function call(url: string, body?: unknown): Promise<unknown> {
    if (!key) await load(false);
    for (;;) {
      try {
        return await ctx.http.json(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key!,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        if (!isAuthError(err)) throw err;
        if (fromCache) {
          ctx.log.info('cached APIM key rejected; re-reading it from the site bundle');
          await load(true);
          continue;
        }
        throw new BlockedError(url, `APIM key rejected (HTTP ${(err as HttpError).status})`);
      }
    }
  };
}

/** The request body the site's search island sends. */
export function searchBody(type: string, keywords: string, skip: number) {
  return {
    keywords,
    location: '',
    apprenticeshipTypeFacet: type,
    jobCategoryFacet: '',
    qualificationFacet: '',
    IsTwoTicksFacet: '',
    skip,
    take: PAGE_SIZE,
    sort: '',
    currentPage: skip / PAGE_SIZE + 1,
    frameworkId: '',
    frameworkSearch: '',
    distance: 15,
  };
}

export const scot: Source = {
  id: 'scot',
  enabled: () => true,
  async run(ctx: Ctx): Promise<SourceResult> {
    const call = gateway(ctx);
    const docs = new Map<string, Doc>();
    const counts: Record<string, number> = {};
    let invalid = 0;
    let searchErrors = 0;
    let capped = false;

    for (const s of SEARCHES) {
      try {
        for (let skip = 0; ; skip += PAGE_SIZE) {
          if (skip >= MAX_PAGES * PAGE_SIZE) {
            capped = true;
            break;
          }
          const body = SearchPage.parse(
            await call(
              `${API}/vacancies/search?api-version=1.0`,
              searchBody(s.type, s.keywords, skip),
            ),
          );
          // With no hits the API can fall back to "related" vacancies; those aren't matches.
          const results = body.isRelatedVacancies ? [] : (body.results ?? []);
          counts[s.type] = body.isRelatedVacancies ? 0 : (body.count ?? 0);
          for (const r of results) {
            const d = Doc.safeParse(r.document);
            if (d.success) docs.set(d.data.RefCode, d.data);
            else invalid++;
          }
          if (!results.length || skip + PAGE_SIZE >= counts[s.type]!) break;
        }
      } catch (err) {
        if (err instanceof BlockedError) throw err;
        searchErrors++;
        ctx.log.warn(`${s.type} search: ${(err as Error).message}`);
      }
    }
    if (searchErrors === SEARCHES.length)
      throw new Error('every apprenticeships.scot search failed');

    // Framework names come only from the detail endpoint; remember them by framework id so a
    // generically titled GA ("Graduate Apprentice") under Data Science is still recognised.
    const frameworks = (await ctx.state.get<Record<string, string>>(FRAMEWORK_STATE)) ?? {};
    const learnt = Object.keys(frameworks).length;
    const known = await ctx.knownSourceIds('scot');
    const listings: RawListing[] = [];
    let detailed = 0;
    let detailErrors = 0;
    let detailCapped = false;
    for (const d of docs.values()) {
      const fwKnown = !!d.Framework && d.Framework in frameworks;
      const wanted = isRelevantDoc(d, d.Framework ? frameworks[d.Framework] : undefined);
      const isGA = (d.VacancyType ?? '').toUpperCase() === 'GA';
      // New relevant refs, plus any GA whose framework we haven't named yet (one-off per framework).
      const needDetail = (wanted && !known.has(d.RefCode)) || (!!d.Framework && !fwKnown && isGA);
      if (needDetail) {
        if (detailed + detailErrors >= MAX_DETAILS) detailCapped = true;
        else {
          try {
            const det = Detail.parse(
              await call(`${API}/vacancy/ref/${encodeURIComponent(d.RefCode)}?api-version=1.0`),
            );
            detailed++;
            const id = det.framework ?? d.Framework;
            if (id && det.frameworkName) frameworks[id] = det.frameworkName;
          } catch (err) {
            if (err instanceof BlockedError) throw err;
            detailErrors++;
            ctx.log.warn(`detail ${d.RefCode}: ${(err as Error).message}`);
          }
        }
      }
      const fw = d.Framework ? frameworks[d.Framework] : undefined;
      if (isRelevantDoc(d, fw)) listings.push(toRawListing(d, fw));
    }
    if (Object.keys(frameworks).length > learnt) await ctx.state.set(FRAMEWORK_STATE, frameworks);

    return {
      listings,
      complete:
        searchErrors === 0 && invalid === 0 && !capped && detailErrors === 0 && !detailCapped,
      stats: {
        scope: 'all GA + MA keyword search',
        ga: counts.GA ?? 0,
        ma: counts.MA ?? 0,
        vacancies: docs.size,
        relevant: listings.length,
        detailFetched: detailed,
        detailErrors,
        frameworksKnown: Object.keys(frameworks).length,
        searchErrors,
        invalid,
        capped: capped || detailCapped ? 'yes' : 'no',
      },
    };
  },
};

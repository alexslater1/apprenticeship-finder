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
 * Find an Apprenticeship Display Advert API v2 (England + NHS Jobs + Civil Service Jobs).
 * research/gov-api.md §4: full daily sync of every vacancy, classify locally, then fetch
 * details only for new relevant ones.
 */
export const FAA_BASE = 'https://api.apprenticeships.education.gov.uk/vacancies';
const PAGE_SIZE = 100;
const MAX_PAGES = 80; // ~4k vacancies today; guard against a runaway loop

const Address = z
  .object({
    addressLine1: z.string().nullish(),
    addressLine2: z.string().nullish(),
    addressLine3: z.string().nullish(),
    addressLine4: z.string().nullish(),
    postcode: z.string().nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
  })
  .loose();

export const Vacancy = z
  .object({
    vacancyReference: z.string(),
    title: z.string(),
    description: z.string().nullish(),
    employerName: z.string().nullish(),
    employerWebsiteUrl: z.string().nullish(),
    employerDescription: z.string().nullish(),
    postedDate: z.string().nullish(),
    closingDate: z.string().nullish(),
    startDate: z.string().nullish(),
    numberOfPositions: z.number().nullish(),
    hoursPerWeek: z.number().nullish(),
    expectedDuration: z.string().nullish(),
    wage: z
      .object({
        wageType: z.string().nullish(),
        wageUnit: z.string().nullish(),
        wageAdditionalInformation: z.string().nullish(),
        workingWeekDescription: z.string().nullish(),
      })
      .loose()
      .nullish(),
    addresses: z.array(Address).nullish(),
    course: z
      .object({
        larsCode: z.number().nullish(),
        title: z.string().nullish(),
        level: z.number().nullish(),
        route: z.string().nullish(),
        type: z.string().nullish(),
      })
      .loose()
      .nullish(),
    apprenticeshipLevel: z.string().nullish(),
    providerName: z.string().nullish(),
    vacancyUrl: z.string().nullish(),
    applicationUrl: z.string().nullish(),
    isNationalVacancy: z.boolean().nullish(),
    isNationalVacancyDetails: z.string().nullish(),
    isDisabilityConfident: z.boolean().nullish(),
    fullDescription: z.string().nullish(),
    trainingDescription: z.string().nullish(),
    additionalTrainingDescription: z.string().nullish(),
    outcomeDescription: z.string().nullish(),
    thingsToConsider: z.string().nullish(),
    companyBenefitsInformation: z.string().nullish(),
    skills: z.array(z.string()).nullish(),
    qualifications: z
      .array(
        z
          .object({
            weighting: z.string().nullish(),
            qualificationType: z.string().nullish(),
            subject: z.string().nullish(),
            grade: z.string().nullish(),
          })
          .loose(),
      )
      .nullish(),
  })
  .loose();
export type Vacancy = z.infer<typeof Vacancy>;

const Page = z.object({
  vacancies: z.array(z.unknown()),
  total: z.number().optional(),
  totalFiltered: z.number().optional(),
  totalPages: z.number(),
});

function headers(key: string): Record<string, string> {
  return {
    'X-Version': '2',
    'Ocp-Apim-Subscription-Key': key,
    AdditionalDataSources: 'Nhs,Csj',
  };
}

const LEVEL_WORDS: Record<string, number> = { intermediate: 2, advanced: 3, higher: 4, degree: 6 };

/** The level FAA states: course.level, else the Advanced/Higher/Degree band. */
export function faaLevel(v: Vacancy): number | undefined {
  if (v.course?.level && v.course.level >= 2) return v.course.level;
  return LEVEL_WORDS[(v.apprenticeshipLevel ?? '').toLowerCase()];
}

const WAGE_LABELS: Record<string, string> = {
  ApprenticeshipMinimum: 'Apprenticeship minimum wage',
  NationalMinimum: 'National minimum wage',
  CompetitiveSalary: 'Competitive',
};

function salaryText(v: Vacancy): string | undefined {
  const info = v.wage?.wageAdditionalInformation?.trim();
  if (info) return info;
  return WAGE_LABELS[v.wage?.wageType ?? ''];
}

/** Stitch FAA's long-text fields into one description with headings. */
export function composeDescription(v: Vacancy): string {
  const sections: Array<[string | null, string | null | undefined]> = [
    [null, v.description],
    ['What you’ll do', v.fullDescription],
    ['Training', v.trainingDescription],
    ['More about the training', v.additionalTrainingDescription],
    ['After the apprenticeship', v.outcomeDescription],
    ['Things to consider', v.thingsToConsider],
    ['Benefits', v.companyBenefitsInformation],
    ['About the employer', v.employerDescription],
  ];
  return sections
    .filter(([, body]) => body && body.trim())
    .map(([h, body]) => {
      const html = /<[a-z]/i.test(body!) ? body! : `<p>${body}</p>`;
      return h ? `<h3>${h}</h3>\n${html}` : html;
    })
    .join('\n');
}

function locations(v: Vacancy): Location[] {
  return (v.addresses ?? []).map((a) => {
    const lines = [a.addressLine1, a.addressLine2, a.addressLine3, a.addressLine4]
      .map((l) => l?.trim())
      .filter((l): l is string => !!l);
    return {
      text: lines.join(', '),
      postcode: a.postcode?.trim() || undefined,
      lat: a.latitude ?? undefined,
      lon: a.longitude ?? undefined,
      nation: 'England' as const,
      lines,
    };
  });
}

const BARE_URL = /\/apprenticeship\/?$/;

/** Drop contact details and bulky text from the raw copy we keep in listing_sources.raw. */
function trimRaw(v: Vacancy): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (/^employerContact/i.test(k)) continue;
    if (typeof val === 'string' && val.length > 2000) continue;
    out[k] = val;
  }
  return out;
}

export function toRawListing(v: Vacancy): RawListing {
  const extra = !v.course?.larsCode; // NHS Jobs / Civil Service Jobs vacancies
  const vacancyUrl = v.vacancyUrl && !BARE_URL.test(v.vacancyUrl) ? v.vacancyUrl : undefined;
  const url =
    vacancyUrl ??
    v.applicationUrl ??
    `https://www.findapprenticeship.service.gov.uk/apprenticeship/reference/${v.vacancyReference}`;
  const descriptionHtml = composeDescription(v);
  return {
    source: 'faa',
    sourceId: v.vacancyReference,
    url,
    applyUrl: v.applicationUrl || undefined,
    title: collapseSpaces(decodeEntities(v.title)),
    employerName: displayCase(v.employerName ?? 'Unknown employer'),
    descriptionHtml: descriptionHtml || undefined,
    descriptionText: descriptionHtml ? htmlToText(descriptionHtml) : undefined,
    level: faaLevel(v),
    larsCode: v.course?.larsCode || undefined,
    standardTitle: v.course?.title?.replace(/\s*\(level \d\)\s*$/i, '') || undefined,
    providerName: v.providerName ? displayCase(v.providerName) : undefined,
    salaryText: salaryText(v),
    postedDate: parseDate(v.postedDate) ?? undefined,
    closingDate: parseDate(v.closingDate) ?? undefined,
    startDate: parseDate(v.startDate) ?? undefined,
    locations: locations(v),
    isNational: !!v.isNationalVacancy,
    knownApprenticeship: true,
    details: {
      duration: v.expectedDuration || undefined,
      hoursPerWeek: v.hoursPerWeek || undefined,
      positions: v.numberOfPositions || undefined,
      workingWeek: v.wage?.workingWeekDescription || undefined,
      wageType: v.wage?.wageType || undefined,
      route: v.course?.route || undefined,
      qualifications: v.qualifications?.length ? v.qualifications : undefined,
      skills: v.skills?.length ? v.skills : undefined,
      employerWebsite: v.employerWebsiteUrl || undefined,
      nationalDetails: v.isNationalVacancyDetails
        ? htmlToText(v.isNationalVacancyDetails)
        : undefined,
      disabilityConfident: v.isDisabilityConfident || undefined,
      origin: extra
        ? /^C\d/.test(v.vacancyReference)
          ? 'NHS Jobs'
          : 'Civil Service Jobs'
        : undefined,
    },
    raw: trimRaw(v),
  };
}

/** Quick pre-filter so we only spend detail calls on vacancies the pipeline will keep. */
export function isRelevantVacancy(v: Vacancy): boolean {
  if ((v.course?.type ?? '').toLowerCase().startsWith('foundation')) return false;
  return classify({
    title: v.title,
    level: faaLevel(v),
    larsCode: v.course?.larsCode || undefined,
    standardTitle: v.course?.title ?? undefined,
    knownApprenticeship: true,
  }).relevant;
}

export const faa: Source = {
  id: 'faa',
  enabled: (env) => !!env.FAA_API_KEY,
  async run(ctx: Ctx): Promise<SourceResult> {
    const key = ctx.env.FAA_API_KEY!;
    const all = new Map<string, Vacancy>();
    let invalid = 0;
    let totalPages = 1;
    let reported: number | undefined;
    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
      const body = Page.parse(
        await ctx.http.json(
          `${FAA_BASE}/vacancy?PageSize=${PAGE_SIZE}&PageNumber=${page}&Sort=AgeDesc`,
          { headers: headers(key) },
        ),
      );
      totalPages = body.totalPages;
      reported = body.totalFiltered ?? reported;
      for (const item of body.vacancies) {
        const parsed = Vacancy.safeParse(item);
        if (parsed.success) all.set(parsed.data.vacancyReference, parsed.data);
        else invalid++;
      }
    }
    const complete = totalPages <= MAX_PAGES && invalid === 0;
    ctx.log.info(`synced ${all.size} vacancies over ${totalPages} pages (API says ${reported})`);

    const relevant = [...all.values()].filter(isRelevantVacancy);
    const known = await ctx.knownSourceIds('faa');
    let detailed = 0;
    let detailErrors = 0;
    const listings: RawListing[] = [];
    for (const v of relevant) {
      let full = v;
      if (!known.has(v.vacancyReference)) {
        try {
          const d = Vacancy.parse(
            await ctx.http.json(`${FAA_BASE}/vacancy/${encodeURIComponent(v.vacancyReference)}`, {
              headers: headers(key),
            }),
          );
          full = { ...v, ...d };
          detailed++;
        } catch (err) {
          detailErrors++;
          ctx.log.warn(`detail ${v.vacancyReference}: ${(err as Error).message}`);
        }
      }
      listings.push(toRawListing(full));
    }

    return {
      listings,
      complete,
      stats: {
        vacancies: all.size,
        pages: totalPages,
        relevant: relevant.length,
        detailFetched: detailed,
        detailErrors,
        invalid,
      },
    };
  },
};

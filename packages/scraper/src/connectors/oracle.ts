import { parseDate, type Location } from '@af/shared';
import { z } from 'zod';
import { employerListing, isCandidateTitle, isUk, stripHtml, withDetails } from './common.ts';
import { defineConnector } from './types.ts';

/**
 * Oracle Recruiting Cloud "Candidate Experience" REST (research §11). `expand=requisitionList…`
 * is mandatory; the UK `locationId` is tenant-specific (looked up once from `locationsFacet` and
 * cached). Some tenants are mostly shop-floor jobs (M&S): `selectedOrganizationsFacet` narrows the
 * board to head-office organisations. The pods sit behind a WAF, so pages are big and few.
 */
const Config = z.object({
  host: z.string(),
  siteNumber: z.string(),
  ukLocationId: z.number().optional(),
  selectedOrganizationsFacet: z.string().optional(),
});

const LIMIT = 200;
const MAX_PAGES = 10;

const Req = z
  .object({
    Id: z.union([z.string(), z.number()]).transform(String),
    Title: z.string(),
    PostedDate: z.string().nullish(),
    PostingEndDate: z.string().nullish(),
    PrimaryLocation: z.string().nullish(),
    PrimaryLocationCountry: z.string().nullish(),
    secondaryLocations: z
      .array(z.object({ Name: z.string().nullish(), CountryCode: z.string().nullish() }).loose())
      .nullish(),
  })
  .loose();
type Req = z.infer<typeof Req>;

const ListBody = z
  .object({
    items: z.array(
      z
        .object({
          TotalJobsCount: z.number().nullish(),
          requisitionList: z.array(z.unknown()).nullish(),
          locationsFacet: z.array(z.object({ Id: z.number(), Name: z.string() }).loose()).nullish(),
        })
        .loose(),
    ),
  })
  .loose();

const DetailBody = z
  .object({
    items: z.array(
      z
        .object({
          Title: z.string().nullish(),
          ExternalDescriptionStr: z.string().nullish(),
          ExternalResponsibilitiesStr: z.string().nullish(),
          ExternalQualificationsStr: z.string().nullish(),
          ExternalPostedStartDate: z.string().nullish(),
          ExternalPostedEndDate: z.string().nullish(),
          PrimaryLocation: z.string().nullish(),
          PrimaryLocationCountry: z.string().nullish(),
        })
        .loose(),
    ),
  })
  .loose();

const api = (host: string) => `https://${host}/hcmRestApi/resources/latest`;

function listUrl(c: z.infer<typeof Config>, offset: number, ukId?: number): string {
  const finder = [
    `findReqs;siteNumber=${c.siteNumber}`,
    'facetsList=LOCATIONS',
    `limit=${LIMIT}`,
    `offset=${offset}`,
    'sortBy=POSTING_DATES_DESC',
    ukId ? `locationId=${ukId}` : null,
    c.selectedOrganizationsFacet
      ? `selectedOrganizationsFacet=${c.selectedOrganizationsFacet}`
      : null,
  ]
    .filter(Boolean)
    .join(',');
  // The finder string goes in raw, as the Candidate Experience UI sends it.
  return `${api(c.host)}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`;
}

function reqLocations(r: Req): Location[] {
  const out: Location[] = [];
  if (r.PrimaryLocation)
    out.push({ text: r.PrimaryLocation, country: r.PrimaryLocationCountry ?? undefined });
  for (const s of r.secondaryLocations ?? [])
    if (s.Name) out.push({ text: s.Name, country: s.CountryCode ?? undefined });
  return out;
}

export const oracle = defineConnector({
  id: 'oracle',
  config: Config,
  async run(c, ctx) {
    const stateKey = `${ctx.source}:ukLocationId`;
    let ukId = c.ukLocationId ?? (await ctx.state.get<number>(stateKey));
    const reqs: Req[] = [];
    let total: number | null = null;
    let full = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = ListBody.parse(await ctx.http.json(listUrl(c, page * LIMIT, ukId)));
      const item = body.items[0];
      if (!item) break;
      if (!ukId) {
        // First run without a known UK location id: find it, then start again filtered.
        const uk = item.locationsFacet?.find((f) => /^united kingdom$/i.test(f.Name));
        if (uk) {
          ukId = uk.Id;
          await ctx.state.set(stateKey, ukId);
          page = -1;
          continue;
        }
      }
      total ??= item.TotalJobsCount ?? null;
      const list = (item.requisitionList ?? [])
        .map((r) => Req.safeParse(r))
        .filter((r) => r.success);
      reqs.push(...list.map((r) => r.data));
      if (list.length < LIMIT || (total !== null && reqs.length >= total)) {
        full = true;
        break;
      }
    }
    const candidates = reqs.filter((r) => isCandidateTitle(r.Title));
    const jobUrl = (id: string) =>
      `https://${c.host}/hcmUI/CandidateExperience/en/sites/${c.siteNumber}/job/${id}`;
    const base = (r: Req) =>
      employerListing(ctx, {
        sourceId: r.Id,
        url: jobUrl(r.Id),
        title: r.Title,
        postedDate: parseDate(r.PostedDate) ?? undefined,
        closingDate: parseDate(r.PostingEndDate) ?? undefined,
        locations: reqLocations(r),
        raw: { ...r },
      });
    const { listings, detailed, errors } = await withDetails(ctx, candidates, {
      id: (r) => r.Id,
      sig: (r) => r.Title,
      detail: async (r) => {
        const d = DetailBody.parse(
          await ctx.http.json(
            `${api(c.host)}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${r.Id}%22,siteNumber=${c.siteNumber}`,
          ),
        ).items[0];
        const html = [
          d?.ExternalDescriptionStr,
          d?.ExternalResponsibilitiesStr,
          d?.ExternalQualificationsStr,
        ]
          .filter(Boolean)
          .join('\n');
        return {
          ...base(r),
          descriptionHtml: html || undefined,
          descriptionText: stripHtml(html || undefined),
          postedDate: parseDate(d?.ExternalPostedStartDate ?? r.PostedDate) ?? undefined,
          closingDate: parseDate(d?.ExternalPostedEndDate ?? r.PostingEndDate) ?? undefined,
        };
      },
      fallback: base,
    });
    // Without a UK location id the board is global.
    const uk = listings.filter(
      (l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false),
    );
    return {
      jobs: uk,
      total,
      complete: full && errors === 0,
      stats: { listed: reqs.length, candidates: candidates.length, detailed },
    };
  },
  detect(url) {
    const m =
      /\/\/([\w.-]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[\w-]+\/sites\/([\w-]+)/.exec(
        url,
      );
    return m ? { host: m[1], siteNumber: m[2] } : null;
  },
});

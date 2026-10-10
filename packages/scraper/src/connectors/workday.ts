import { parseDate, type Location, type RawListing } from '@af/shared';
import { z } from 'zod';
import { employerListing, isCandidateTitle, isUk, stripHtml, withDetails } from './common.ts';
import { defineConnector, type EmployerCtx } from './types.ts';

/**
 * Workday CXS (research/ats-platforms.md §1): POST `/wday/cxs/{tenant}/{site}/jobs`, 20 a page.
 * Boards up to FULL_SCAN_MAX jobs are read in full; bigger ones (Airbus, Thales: Workday caps
 * `total` at 2000) are read through the Apprentice job-type facet plus an "apprentice" search.
 * Detail calls only for new apprenticeship candidates.
 */
const Config = z.object({
  host: z.string(),
  tenant: z.string(),
  site: z.string(),
  /** Other public sites of the same tenant (LBG's apprenticeship board, bp's early careers). */
  extraSites: z.array(z.string()).optional(),
  /** Country facet applied to every query (big global tenants such as Pfizer). */
  ukFacet: z.object({ param: z.string(), ids: z.array(z.string()).min(1) }).optional(),
  /** Job-type facet value(s) for apprentices on the main site. */
  apprenticeFacet: z.object({ param: z.string(), ids: z.array(z.string()).min(1) }).optional(),
});
type Config = z.infer<typeof Config>;

const PAGE = 20;
const FULL_SCAN_MAX = 1200;
const MAX_PAGES = 100;

const Posting = z
  .object({
    title: z.string(),
    externalPath: z.string(),
    locationsText: z.string().nullish(),
    postedOn: z.string().nullish(),
    bulletFields: z.array(z.string()).nullish(),
  })
  .loose();
type Posting = z.infer<typeof Posting> & { fromFacet?: boolean; site?: string };

const ListPage = z
  .object({ total: z.number().nullish(), jobPostings: z.array(z.unknown()).nullish() })
  .loose();

const Detail = z
  .object({
    jobPostingInfo: z
      .object({
        title: z.string(),
        jobDescription: z.string().nullish(),
        location: z.string().nullish(),
        additionalLocations: z.array(z.string()).nullish(),
        startDate: z.string().nullish(),
        endDate: z.string().nullish(),
        timeType: z.string().nullish(),
        jobReqId: z.string().nullish(),
        externalUrl: z.string().nullish(),
        country: z.object({ descriptor: z.string().nullish() }).loose().nullish(),
        jobRequisitionLocation: z
          .object({
            country: z.object({ alpha2Code: z.string().nullish() }).loose().nullish(),
          })
          .loose()
          .nullish(),
      })
      .loose(),
  })
  .loose();

/** '/job/Glasgow/…_JR-0000123' → 'JR-0000123'; falls back to the whole path. */
export function workdayJobId(p: { externalPath: string; bulletFields?: string[] | null }): string {
  return (
    /_((?:JR|R|REQ)?-?[\w-]*\d[\w-]*)$/.exec(p.externalPath)?.[1] ??
    p.bulletFields?.find((b) => /\d/.test(b)) ??
    p.externalPath
  );
}

const base = (c: Config) => `https://${c.host}/wday/cxs/${c.tenant}/${c.site}`;

async function listAll(
  c: Config,
  ctx: EmployerCtx,
  o: { appliedFacets?: Record<string, string[]>; searchText?: string; maxPages?: number },
): Promise<{ total: number | null; postings: Posting[]; full: boolean }> {
  const postings: Posting[] = [];
  let total: number | null = null;
  const maxPages = o.maxPages ?? MAX_PAGES;
  for (let page = 0; page < maxPages; page++) {
    const body = ListPage.parse(
      await ctx.http.json(`${base(c)}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appliedFacets: {
            ...(c.ukFacet ? { [c.ukFacet.param]: c.ukFacet.ids } : {}),
            ...o.appliedFacets,
          },
          limit: PAGE,
          offset: page * PAGE,
          searchText: o.searchText ?? '',
        }),
        robots: true,
      }),
    );
    // Some tenants report total 0 after page 1; keep the first page's.
    if (page === 0) total = body.total ?? null;
    const items = (body.jobPostings ?? [])
      .map((p) => Posting.safeParse(p))
      .filter((r) => r.success);
    postings.push(...items.map((r) => r.data));
    if (items.length < PAGE || (total !== null && (page + 1) * PAGE >= total)) {
      return { total, postings, full: true };
    }
  }
  return { total, postings, full: false };
}

function toListing(
  ctx: EmployerCtx,
  c: Config,
  p: Posting,
  d?: z.infer<typeof Detail>,
): RawListing {
  const info = d?.jobPostingInfo;
  const country = info?.jobRequisitionLocation?.country?.alpha2Code ?? info?.country?.descriptor;
  const places = info
    ? [info.location, ...(info.additionalLocations ?? [])].filter((x): x is string => !!x)
    : p.locationsText && !/^\d+ Locations$/i.test(p.locationsText)
      ? [p.locationsText]
      : [];
  // Workday only gives the country of the primary location.
  const locations: Location[] = places.map((text, i) => ({
    text,
    country: i === 0 ? (country ?? undefined) : undefined,
  }));
  return employerListing(ctx, {
    sourceId: workdayJobId(p),
    url: info?.externalUrl || `https://${c.host}/${c.site}${p.externalPath}`,
    title: info?.title ?? p.title,
    descriptionHtml: info?.jobDescription ?? undefined,
    descriptionText: stripHtml(info?.jobDescription ?? undefined),
    postedDate: parseDate(info?.startDate) ?? undefined,
    closingDate: parseDate(info?.endDate) ?? undefined,
    locations,
    knownApprenticeship: p.fromFacet || undefined,
    details: { timeType: info?.timeType ?? undefined },
    raw: { posting: p, reqId: info?.jobReqId },
  });
}

/** One site: read in full when small enough, else facet + targeted searches. */
async function readSite(
  c: Config,
  ctx: EmployerCtx,
): Promise<{ postings: Posting[]; total: number | null; complete: boolean }> {
  const first = await listAll(c, ctx, { maxPages: Math.ceil(FULL_SCAN_MAX / PAGE) });
  const byPath = new Map<string, Posting>();
  let complete = first.full;
  for (const p of first.postings) byPath.set(p.externalPath, p);
  if (!first.full) {
    // Too big to read in full every day: what we've read, plus targeted queries.
    for (const q of ['apprentice', 'apprenticeship', 'school leaver']) {
      const r = await listAll(c, ctx, { searchText: q, maxPages: 15 });
      for (const p of r.postings) if (!byPath.has(p.externalPath)) byPath.set(p.externalPath, p);
    }
  }
  if (c.apprenticeFacet) {
    const r = await listAll(c, ctx, {
      appliedFacets: { [c.apprenticeFacet.param]: c.apprenticeFacet.ids },
    });
    for (const p of r.postings)
      byPath.set(p.externalPath, { ...byPath.get(p.externalPath), ...p, fromFacet: true });
    // With the facet read in full, every apprenticeship is accounted for.
    if (!first.full && r.full) complete = true;
  }
  return { postings: [...byPath.values()], total: first.total, complete };
}

export const workday = defineConnector({
  id: 'workday',
  config: Config,
  async run(c, ctx) {
    const byId = new Map<string, Posting>();
    let total = 0;
    let complete = true;
    for (const site of [c.site, ...(c.extraSites ?? [])]) {
      const sc = { ...c, site, apprenticeFacet: site === c.site ? c.apprenticeFacet : undefined };
      const r = await readSite(sc, ctx);
      total += r.total ?? r.postings.length;
      complete &&= r.complete;
      for (const p of r.postings) {
        const id = workdayJobId(p);
        if (!byId.has(id) || p.fromFacet) byId.set(id, { ...byId.get(id), ...p, site });
      }
    }
    const byPath = byId;
    const candidates = [...byPath.values()].filter((p) => p.fromFacet || isCandidateTitle(p.title));
    const { listings, detailed, errors } = await withDetails(ctx, candidates, {
      id: workdayJobId,
      sig: (p) => p.title,
      detail: async (p) => {
        const sc = { ...c, site: p.site ?? c.site };
        return toListing(
          ctx,
          sc,
          p,
          Detail.parse(await ctx.http.json(`${base(sc)}${p.externalPath}`, { robots: true })),
        );
      },
      fallback: (p) => toListing(ctx, { ...c, site: p.site ?? c.site }, p),
    });
    const uk = listings.filter(
      (l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false),
    );
    return {
      jobs: uk,
      total,
      complete: complete && errors === 0,
      stats: {
        listed: byPath.size,
        candidates: candidates.length,
        detailed,
        abroad: listings.length - uk.length,
      },
    };
  },
  detect(url) {
    const m =
      /\/\/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/.exec(url) ??
      null;
    if (m) return { host: `${m[1]}.${m[2]}.myworkdayjobs.com`, tenant: m[1], site: m[3] };
    const s =
      /\/\/(wd\d+\.myworkdaysite\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?recruiting\/([^/]+)\/([^/?#]+)/.exec(
        url,
      );
    if (s) return { host: s[1], tenant: s[2], site: s[3] };
    return null;
  },
});

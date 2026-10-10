import { londonDate, type Location } from '@af/shared';
import { z } from 'zod';
import { employerListing, isCandidateTitle, isUk, stripHtml, withDetails } from './common.ts';
import { defineConnector, type EmployerCtx } from './types.ts';

/**
 * Eightfold (research §10): legacy `/api/apply/v2` or, when that says "Not authorized for PCSX",
 * `/api/pcsx`. Both page 10 at a time. `domain` is the company's email domain (a wrong one returns
 * 0, not an error). PCSX's `location=` is a radius search (AstraZeneca's missed Cambridge), so
 * `omitLocation` reads the whole board and filters on standardised locations instead.
 */
const Config = z.object({
  host: z.string(),
  domain: z.string(),
  api: z.enum(['v2', 'pcsx']).default('pcsx'),
  omitLocation: z.boolean().optional(),
  /** Search instead of reading the whole board (Microsoft rate-limits paging). */
  query: z.string().optional(),
});
type Config = z.infer<typeof Config>;

const MAX_PAGES = 120;

interface Position {
  id: string;
  title: string;
  locations: Location[];
  posted?: string;
  url: string;
}

const ts = (s: number | null | undefined) => (s ? londonDate(new Date(s * 1000)) : undefined);

const PcsxPage = z
  .object({
    data: z
      .object({
        count: z.number().nullish(),
        positions: z.array(
          z
            .object({
              id: z.union([z.number(), z.string()]).transform(String),
              name: z.string(),
              locations: z.array(z.string()).nullish(),
              standardizedLocations: z.array(z.string()).nullish(),
              postedTs: z.number().nullish(),
              positionUrl: z.string().nullish(),
            })
            .loose(),
        ),
      })
      .loose(),
  })
  .loose();

const V2Page = z
  .object({
    count: z.number().nullish(),
    positions: z.array(
      z
        .object({
          id: z.union([z.number(), z.string()]).transform(String),
          name: z.string(),
          locations: z.array(z.string()).nullish(),
          t_create: z.number().nullish(),
          canonicalPositionUrl: z.string().nullish(),
        })
        .loose(),
    ),
  })
  .loose();

async function list(
  c: Config,
  ctx: EmployerCtx,
): Promise<{ positions: Position[]; total: number | null; full: boolean }> {
  const out: Position[] = [];
  let total: number | null = null;
  const loc = c.omitLocation ? '' : '&location=United%20Kingdom';
  const q = encodeURIComponent(c.query ?? '');
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * 10;
    let batch: Position[];
    if (c.api === 'pcsx') {
      const body = PcsxPage.parse(
        await ctx.http.json(
          `https://${c.host}/api/pcsx/search?domain=${encodeURIComponent(c.domain)}&query=${q}${loc}&start=${start}`,
          { robots: true },
        ),
      );
      if (page === 0) total = body.data.count ?? null;
      batch = body.data.positions.map((p) => ({
        id: p.id,
        title: p.name,
        // "London, England, GB" is the reliable country; the free-text list is for display.
        locations: (p.standardizedLocations?.length
          ? p.standardizedLocations
          : (p.locations ?? [])
        ).map((text) => ({
          text,
          country:
            /,\s*([A-Z]{2})$/.exec(text)?.[1] ?? (/^[A-Z]{2}$/.test(text) ? text : undefined),
        })),
        posted: ts(p.postedTs),
        url: `https://${c.host}${p.positionUrl ?? `/careers/job/${p.id}`}`,
      }));
    } else {
      const body = V2Page.parse(
        await ctx.http.json(
          `https://${c.host}/api/apply/v2/jobs?domain=${encodeURIComponent(c.domain)}&query=${q}&start=${start}&num=10${loc}`,
          { robots: true },
        ),
      );
      if (page === 0) total = body.count ?? null;
      batch = body.positions.map((p) => ({
        id: p.id,
        title: p.name,
        locations: (p.locations ?? []).map((text) => ({ text })),
        posted: ts(p.t_create),
        url: p.canonicalPositionUrl ?? `https://${c.host}/careers/job/${p.id}`,
      }));
    }
    out.push(...batch);
    if (batch.length < 10 || (total !== null && out.length >= total))
      return { positions: out, total, full: true };
  }
  return { positions: out, total, full: false };
}

const PcsxDetail = z
  .object({
    data: z
      .object({ jobDescription: z.string().nullish(), publicUrl: z.string().nullish() })
      .loose(),
  })
  .loose();
const V2Detail = z.object({ job_description: z.string().nullish() }).loose();

export const eightfold = defineConnector({
  id: 'eightfold',
  config: Config,
  async run(c, ctx) {
    const { positions, total, full } = await list(c, ctx);
    const ukJobs = positions.filter(
      (p) => !p.locations.length || p.locations.some((l) => isUk(l) !== false),
    );
    const candidates = ukJobs.filter((p) => isCandidateTitle(p.title));
    const base = (p: Position) =>
      employerListing(ctx, {
        sourceId: p.id,
        url: p.url,
        title: p.title,
        postedDate: p.posted,
        locations: p.locations.filter((l) => !/^[A-Z]{2}$/.test(l.text)),
        raw: { ...p },
      });
    const { listings, detailed, errors } = await withDetails(ctx, candidates, {
      id: (p) => p.id,
      sig: (p) => p.title,
      detail: async (p) => {
        const html =
          c.api === 'pcsx'
            ? PcsxDetail.parse(
                await ctx.http.json(
                  `https://${c.host}/api/pcsx/position_details?position_id=${p.id}&domain=${encodeURIComponent(c.domain)}&hl=en`,
                  { robots: true },
                ),
              ).data.jobDescription
            : V2Detail.parse(
                await ctx.http.json(
                  `https://${c.host}/api/apply/v2/jobs/${p.id}?domain=${encodeURIComponent(c.domain)}`,
                  {
                    robots: true,
                  },
                ),
              ).job_description;
        return {
          ...base(p),
          descriptionHtml: html ?? undefined,
          descriptionText: stripHtml(html ?? undefined),
        };
      },
      fallback: base,
    });
    return {
      jobs: listings,
      total,
      complete: full && errors === 0,
      stats: {
        listed: positions.length,
        uk: ukJobs.length,
        candidates: candidates.length,
        detailed,
      },
    };
  },
  detect(url, html) {
    const m = /\/\/([\w-]+\.eightfold\.ai)\b/.exec(url);
    if (m) return { host: m[1] };
    if (/eightfold/i.test(html ?? '') && /\/careers(\/job\/\d+)?/.test(url))
      return { host: new URL(url).host };
    return null;
  },
});

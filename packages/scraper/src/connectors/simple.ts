import { decodeEntities, londonDate, parseDate, type Location, type RawListing } from '@af/shared';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { htmlToText } from '../pipeline/normalise.ts';
import { employerListing, isCandidateTitle, isUk, parseJobPosting, withDetails } from './common.ts';
import { defineConnector, type ConnectorResult } from './types.ts';

/**
 * Small ATSs whose public job feeds return every job in one response (research §2–9, Pinpoint
 * per the 2026-10-09 employer checks). Each lists the board, keeps apprenticeship candidates in
 * the UK, and fills descriptions from the same response, so no detail calls are needed.
 */

function finish(all: RawListing[], total = all.length): ConnectorResult {
  const uk = all.filter((l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false));
  const jobs = uk.filter((l) => l.knownApprenticeship || isCandidateTitle(l.title));
  return {
    jobs,
    total,
    complete: true,
    stats: { listed: all.length, uk: uk.length, candidates: jobs.length },
  };
}

const html = (s: string | null | undefined) =>
  s ? { descriptionHtml: s, descriptionText: htmlToText(s) } : {};

export const greenhouse = defineConnector({
  id: 'greenhouse',
  config: z.object({ token: z.string() }),
  async run(c, ctx) {
    const body = z
      .object({
        jobs: z.array(
          z
            .object({
              id: z.number().transform(String),
              title: z.string(),
              absolute_url: z.string(),
              location: z.object({ name: z.string().nullish() }).loose().nullish(),
              first_published: z.string().nullish(),
              updated_at: z.string().nullish(),
              content: z.string().nullish(),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(
        await ctx.http.json(
          `https://boards-api.greenhouse.io/v1/boards/${c.token}/jobs?content=true`,
        ),
      );
    return finish(
      body.jobs.map((j) =>
        employerListing(ctx, {
          sourceId: j.id,
          url: j.absolute_url,
          title: j.title,
          // `content` is entity-escaped HTML.
          ...html(j.content ? decodeEntities(j.content) : null),
          postedDate: parseDate(j.first_published ?? j.updated_at) ?? undefined,
          locations: j.location?.name ? [{ text: j.location.name }] : [],
        }),
      ),
    );
  },
  detect(url) {
    const m =
      /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/.exec(
        url,
      );
    return m ? { token: m[1] } : null;
  },
});

export const lever = defineConnector({
  id: 'lever',
  config: z.object({ company: z.string(), eu: z.boolean().optional() }),
  async run(c, ctx) {
    const list = z
      .array(
        z
          .object({
            id: z.string(),
            text: z.string(),
            hostedUrl: z.string(),
            applyUrl: z.string().nullish(),
            createdAt: z.number().nullish(),
            country: z.string().nullish(),
            categories: z
              .object({
                location: z.string().nullish(),
                allLocations: z.array(z.string()).nullish(),
              })
              .loose()
              .nullish(),
            description: z.string().nullish(),
          })
          .loose(),
      )
      .parse(
        await ctx.http.json(
          `https://api.${c.eu ? 'eu.' : ''}lever.co/v0/postings/${c.company}?mode=json`,
        ),
      );
    return finish(
      list.map((j) =>
        employerListing(ctx, {
          sourceId: j.id,
          url: j.hostedUrl,
          applyUrl: j.applyUrl ?? undefined,
          title: j.text,
          ...html(j.description),
          postedDate: j.createdAt ? londonDate(new Date(j.createdAt)) : undefined,
          locations: (j.categories?.allLocations?.length
            ? j.categories.allLocations
            : [j.categories?.location]
          )
            .filter((x): x is string => !!x)
            .map((text) => ({ text, country: j.country ?? undefined })),
        }),
      ),
    );
  },
  detect(url) {
    const m = /jobs\.(eu\.)?lever\.co\/([\w.-]+)/.exec(url);
    return m ? { company: m[2], eu: !!m[1] || undefined } : null;
  },
});

export const ashby = defineConnector({
  id: 'ashby',
  config: z.object({ org: z.string() }),
  async run(c, ctx) {
    const body = z
      .object({
        jobs: z.array(
          z
            .object({
              id: z.string(),
              title: z.string(),
              jobUrl: z.string(),
              applyUrl: z.string().nullish(),
              location: z.string().nullish(),
              secondaryLocations: z
                .array(z.object({ location: z.string().nullish() }).loose())
                .nullish(),
              address: z
                .object({
                  postalAddress: z
                    .object({ addressCountry: z.string().nullish() })
                    .loose()
                    .nullish(),
                })
                .loose()
                .nullish(),
              publishedAt: z.string().nullish(),
              descriptionHtml: z.string().nullish(),
              isListed: z.boolean().nullish(),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(await ctx.http.json(`https://api.ashbyhq.com/posting-api/job-board/${c.org}`));
    return finish(
      body.jobs
        .filter((j) => j.isListed !== false)
        .map((j) =>
          employerListing(ctx, {
            sourceId: j.id,
            url: j.jobUrl,
            applyUrl: j.applyUrl ?? undefined,
            title: j.title,
            ...html(j.descriptionHtml),
            postedDate: parseDate(j.publishedAt) ?? undefined,
            locations: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)]
              .filter((x): x is string => !!x)
              .map((text, i) => ({
                text,
                country:
                  i === 0 ? (j.address?.postalAddress?.addressCountry ?? undefined) : undefined,
              })),
          }),
        ),
    );
  },
  detect(url) {
    const m = /jobs\.ashbyhq\.com\/([\w.%-]+)/.exec(url);
    return m ? { org: decodeURIComponent(m[1]!) } : null;
  },
});

export const workable = defineConnector({
  id: 'workable',
  config: z.object({ account: z.string() }),
  async run(c, ctx) {
    const body = z
      .object({
        jobs: z.array(
          z
            .object({
              shortcode: z.string(),
              title: z.string(),
              url: z.string().nullish(),
              application_url: z.string().nullish(),
              published_on: z.string().nullish(),
              country: z.string().nullish(),
              city: z.string().nullish(),
              locations: z
                .array(
                  z.object({ country: z.string().nullish(), city: z.string().nullish() }).loose(),
                )
                .nullish(),
              description: z.string().nullish(),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(
        await ctx.http.json(
          `https://apply.workable.com/api/v1/widget/accounts/${c.account}?details=true`,
        ),
      );
    return finish(
      body.jobs.map((j) =>
        employerListing(ctx, {
          sourceId: j.shortcode,
          url: j.url ?? `https://apply.workable.com/${c.account}/j/${j.shortcode}/`,
          applyUrl: j.application_url ?? undefined,
          title: j.title,
          ...html(j.description),
          postedDate: parseDate(j.published_on) ?? undefined,
          locations: (j.locations?.length ? j.locations : [{ city: j.city, country: j.country }])
            .filter((l) => l.city || l.country)
            .map((l) => ({
              text: [l.city, l.country].filter(Boolean).join(', '),
              country: l.country ?? undefined,
            })),
        }),
      ),
    );
  },
  detect(url) {
    const m = /apply\.workable\.com\/(?!j\/)([\w-]+)|\/\/([\w-]+)\.workable\.com/.exec(url);
    return m ? { account: m[1] ?? m[2] } : null;
  },
});

const xml = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (n) => ['item', 'location', 'position', 'jobDescription'].includes(n),
});

export const teamtailor = defineConnector({
  id: 'teamtailor',
  config: z.object({ host: z.string() }),
  async run(c, ctx) {
    const feed = xml.parse(await ctx.http.text(`https://${c.host}/jobs.rss`, { robots: true })) as {
      rss?: { channel?: { item?: Array<Record<string, unknown>> } };
    };
    const items = feed.rss?.channel?.item ?? [];
    return finish(
      items.map((it) => {
        const link = String(it.link ?? '');
        const locs = (
          (it.locations as { location?: Array<Record<string, unknown>> } | undefined)?.location ??
          []
        ).map((l): Location => ({
          text: [l.city, l.name].filter(Boolean).map(String).join(', ') || String(l.country ?? ''),
          country: l.country ? String(l.country) : undefined,
        }));
        return employerListing(ctx, {
          sourceId: /\/jobs\/(\d+)/.exec(link)?.[1] ?? String(it.guid ?? link),
          url: link,
          title: String(it.title ?? ''),
          ...html(it.description ? String(it.description) : null),
          postedDate: parseDate(it.pubDate ? String(it.pubDate) : null) ?? undefined,
          locations: locs,
        });
      }),
    );
  },
  detect(url, page) {
    const m = /\/\/([\w-]+\.teamtailor\.com)/.exec(url);
    if (m) return { host: m[1] };
    return /teamtailor/i.test(page ?? '') ? { host: new URL(url).host } : null;
  },
});

export const recruitee = defineConnector({
  id: 'recruitee',
  config: z.object({ company: z.string() }),
  async run(c, ctx) {
    const body = z
      .object({
        offers: z.array(
          z
            .object({
              id: z.number().transform(String),
              title: z.string(),
              careers_url: z.string(),
              careers_apply_url: z.string().nullish(),
              location: z.string().nullish(),
              country_code: z.string().nullish(),
              published_at: z.string().nullish(),
              close_at: z.string().nullish(),
              description: z.string().nullish(),
              requirements: z.string().nullish(),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(await ctx.http.json(`https://${c.company}.recruitee.com/api/offers/`));
    return finish(
      body.offers.map((o) =>
        employerListing(ctx, {
          sourceId: o.id,
          url: o.careers_url,
          applyUrl: o.careers_apply_url ?? undefined,
          title: o.title,
          ...html([o.description, o.requirements].filter(Boolean).join('\n') || null),
          postedDate: parseDate(o.published_at) ?? undefined,
          closingDate: parseDate(o.close_at) ?? undefined,
          locations: o.location ? [{ text: o.location, country: o.country_code ?? undefined }] : [],
        }),
      ),
    );
  },
  detect(url) {
    const m = /\/\/([\w-]+)\.recruitee\.com/.exec(url);
    return m ? { company: m[1] } : null;
  },
});

export const personio = defineConnector({
  id: 'personio',
  config: z.object({ company: z.string(), tld: z.enum(['de', 'com']).default('de') }),
  async run(c, ctx) {
    const host = `${c.company}.jobs.personio.${c.tld}`;
    const doc = xml.parse(await ctx.http.text(`https://${host}/xml?language=en`)) as {
      'workzag-jobs'?: { position?: Array<Record<string, unknown>> };
    };
    const positions = doc['workzag-jobs']?.position ?? [];
    return finish(
      positions.map((p) => {
        const descs = (
          (
            p.jobDescriptions as
              { jobDescription?: Array<{ name?: string; value?: string }> } | undefined
          )?.jobDescription ?? []
        )
          .map((d) => `<h3>${d.name ?? ''}</h3>${d.value ?? ''}`)
          .join('\n');
        return employerListing(ctx, {
          sourceId: String(p.id),
          url: `https://${host}/job/${p.id}`,
          title: String(p.name ?? ''),
          ...html(descs || null),
          postedDate: parseDate(p.createdAt ? String(p.createdAt) : null) ?? undefined,
          locations: p.office
            ? [
                {
                  text:
                    String(p.office)
                      .replace(/^[^-]+-/, '')
                      .trim() || String(p.office),
                },
              ]
            : [],
        });
      }),
    );
  },
  detect(url) {
    const m = /\/\/([\w-]+)\.jobs\.personio\.(de|com)/.exec(url);
    return m ? { company: m[1], tld: m[2] } : null;
  },
});

export const pinpoint = defineConnector({
  id: 'pinpoint',
  config: z.object({ host: z.string() }),
  async run(c, ctx) {
    const body = z
      .object({
        data: z.array(
          z
            .object({
              id: z.union([z.string(), z.number()]).transform(String),
              title: z.string(),
              url: z.string(),
              description: z.string().nullish(),
              key_responsibilities: z.string().nullish(),
              skills_knowledge_expertise: z.string().nullish(),
              deadline_at: z.string().nullish(),
              location: z
                .object({
                  name: z.string().nullish(),
                  city: z.string().nullish(),
                  province: z.string().nullish(),
                })
                .loose()
                .nullish(),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(await ctx.http.json(`https://${c.host}/postings.json`, { robots: true }));
    return finish(
      body.data.map((p) =>
        employerListing(ctx, {
          sourceId: p.id,
          url: p.url,
          title: p.title,
          ...html(
            [p.description, p.key_responsibilities, p.skills_knowledge_expertise]
              .filter(Boolean)
              .join('\n') || null,
          ),
          closingDate: parseDate(p.deadline_at) ?? undefined,
          // `province` is the country here ('United Kingdom', 'UK', 'Ireland').
          locations: p.location
            ? [
                {
                  text: [p.location.city ?? p.location.name, p.location.province?.trim()]
                    .filter(Boolean)
                    .join(', '),
                  country: p.location.province?.trim() || undefined,
                },
              ]
            : [],
        }),
      ),
    );
  },
  detect(url) {
    const m = /\/\/([\w-]+\.pinpointhq\.com)/.exec(url);
    return m ? { host: m[1] } : null;
  },
});

/**
 * SmartRecruiters: the posting API host disallows crawlers in robots.txt, so this reads the
 * server-rendered careers page (first page of jobs only) and each job page's microdata.
 */
export const smartrecruiters = defineConnector({
  id: 'smartrecruiters',
  config: z.object({ companyId: z.string() }),
  async run(c, ctx) {
    const page = await ctx.http.text(`https://careers.smartrecruiters.com/${c.companyId}`, {
      robots: true,
    });
    const links = new Map<string, { id: string; url: string; title: string }>();
    for (const m of page.matchAll(
      /<a[^>]+href=["'](https:\/\/jobs\.smartrecruiters\.com\/[^"']+\/(\d+)-[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const title = htmlToText(m[3]!).trim();
      if (title) links.set(m[2]!, { id: m[2]!, url: m[1]!, title });
    }
    const candidates = [...links.values()].filter((l) => isCandidateTitle(l.title));
    const { listings, errors } = await withDetails(ctx, candidates, {
      id: (l) => l.id,
      sig: (l) => l.title,
      detail: async (l) => {
        const p = parseJobPosting(await ctx.http.text(l.url, { robots: true }));
        return employerListing(ctx, {
          sourceId: l.id,
          url: l.url,
          title: p?.title ?? l.title,
          ...html(p?.descriptionHtml),
          postedDate: p?.postedDate,
          locations: p?.locations ?? [],
        });
      },
      fallback: (l) =>
        employerListing(ctx, { sourceId: l.id, url: l.url, title: l.title, locations: [] }),
    });
    const uk = listings.filter(
      (l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false),
    );
    return {
      jobs: uk,
      total: links.size,
      complete: false,
      stats: { listed: links.size, candidates: candidates.length, errors },
    };
  },
  detect(url) {
    const m = /(?:jobs|careers)\.smartrecruiters\.com\/([\w-]+)/.exec(url);
    return m ? { companyId: m[1] } : null;
  },
});

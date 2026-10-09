import { decodeEntities, parseDate, type RawListing } from '@af/shared';
import { z } from 'zod';
import { htmlToText } from '../pipeline/normalise.ts';
import { employerListing, isCandidateTitle, isUk } from './common.ts';
import { defineConnector, type ConnectorResult } from './types.ts';

/**
 * Employer-specific feeds found during the 2026-10-09 employer checks, where the employer's own
 * careers front-end exposes a cleaner JSON feed than its ATS (or the ATS is unreachable).
 */

function finish(all: RawListing[], total = all.length, complete = true): ConnectorResult {
  const uk = all.filter((l) => !l.locations.length || l.locations.some((x) => isUk(x) !== false));
  const jobs = uk.filter((l) => l.knownApprenticeship || isCandidateTitle(l.title));
  return {
    jobs,
    total,
    complete,
    stats: { listed: all.length, uk: uk.length, candidates: jobs.length },
  };
}

const desc = (h: string | null | undefined) =>
  h ? { descriptionHtml: h, descriptionText: htmlToText(h) } : {};

/** careers.sky.com/jobs embeds every UK job in its Next.js payload (79 of 80 apply via Sky's talent community, not Workday). */
export const skycareers = defineConnector({
  id: 'skycareers',
  config: z.object({ url: z.string() }),
  async run(c, ctx) {
    const page = (await ctx.http.text(c.url, { robots: true })).replace(/\\"/g, '"');
    const jobs = new Map<string, RawListing>();
    const re =
      /\{"id":"(\d+)","title":"([^"]+)","team":"([^"]*)","contract":"([^"]*)","location":"([^"]*)","description":"([^"]*)","application_link":"([^"]+)"/g;
    for (const m of page.matchAll(re)) {
      const [, id, title, team, contract, location, description, link] = m;
      jobs.set(
        id!,
        employerListing(ctx, {
          sourceId: id!,
          url: link!.replace(/\\u0026/g, '&'),
          title: title!,
          descriptionText: description ? JSON.parse(`"${description}"`) : undefined,
          locations: location ? [{ text: location }] : [],
          details: { team: team || undefined, contract: contract || undefined },
        }),
      );
    }
    if (!jobs.size) throw new Error('no jobs found in the careers page payload (layout changed?)');
    return finish([...jobs.values()]);
  },
});

/** Capgemini's careers search API (indexes its SuccessFactors jobs, UK-only with country_code). */
export const cgJobstream = defineConnector({
  id: 'cg-jobstream',
  config: z.object({ apiBase: z.string(), countryCode: z.string() }),
  async run(c, ctx) {
    const Page = z
      .object({
        total: z.number().nullish(),
        count: z.number().nullish(),
        data: z.array(
          z
            .object({
              id: z.string(),
              ref: z.string().nullish(),
              title: z.string(),
              location: z.string().nullish(),
              experience_level: z.string().nullish(),
              description: z.string().nullish(),
              apply_job_url: z.string().nullish(),
              updated_at: z.string().nullish(),
            })
            .loose(),
        ),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let page = 1; page <= 15; page++) {
      const body = Page.parse(
        await ctx.http.json(
          `${c.apiBase}/job-search?country_code=${c.countryCode}&page=${page}&size=100`,
        ),
      );
      total ??= body.count ?? body.total ?? null;
      for (const j of body.data)
        all.push(
          employerListing(ctx, {
            sourceId: j.ref ?? j.id,
            url: j.apply_job_url ?? `https://www.capgemini.com/gb-en/careers/`,
            title: j.title,
            ...desc(j.description),
            postedDate: parseDate(j.updated_at) ?? undefined,
            locations: (j.location ?? '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
              .map((text) => ({ text, country: 'GB' })),
            details: { experienceLevel: j.experience_level?.replace(/\u200b/g, '') || undefined },
          }),
        );
      if (body.data.length < 100 || (total !== null && all.length >= total)) break;
    }
    return finish(all, total ?? all.length);
  },
});

/** entaincareers.com's own search API (a mirror of its SmartRecruiters board). */
export const entainApi = defineConnector({
  id: 'entain-api',
  config: z.object({ url: z.string(), country: z.string() }),
  async run(c, ctx) {
    const Page = z
      .object({
        data: z.array(
          z
            .object({
              id: z.union([z.string(), z.number()]).transform(String),
              url: z.string(),
              post_date: z.string().nullish(),
              job_title: z.string(),
              job_external_apply_url: z.string().nullish(),
              job_custom_location: z.string().nullish(),
              job_custom_country_code: z.string().nullish(),
            })
            .loose(),
        ),
        pagination: z
          .object({ lastPage: z.number().nullish(), totalItems: z.number().nullish() })
          .loose()
          .nullish(),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let page = 1; page <= 10; page++) {
      const body = Page.parse(
        await ctx.http.json(
          `${c.url}?country%5B%5D=${encodeURIComponent(c.country)}&perPage=100&page=${page}`,
          { robots: true },
        ),
      );
      total ??= body.pagination?.totalItems ?? null;
      for (const j of body.data)
        all.push(
          employerListing(ctx, {
            sourceId: j.id,
            url: j.url,
            applyUrl: j.job_external_apply_url ?? undefined,
            title: j.job_title,
            postedDate: parseDate(j.post_date) ?? undefined,
            locations: j.job_custom_location
              ? [{ text: j.job_custom_location, country: j.job_custom_country_code ?? undefined }]
              : [],
          }),
        );
      if (page >= (body.pagination?.lastPage ?? 1)) break;
    }
    return finish(all, total ?? all.length);
  },
});

/** Lidl GB's careers portal search API (over SuccessFactors career5, which is script-only). */
export const lidl = defineConnector({
  id: 'lidl',
  config: z.object({ host: z.string() }),
  async run(c, ctx) {
    const Page = z
      .object({
        jobs: z.array(
          z
            .object({
              title: z.string(),
              requisitionId: z.union([z.string(), z.number()]).transform(String),
              jobDetailUrl: z.string(),
              onlineFrom: z.string().nullish(),
              onlineUntil: z.string().nullish(),
              location: z
                .object({ name: z.string().nullish(), city: z.string().nullish() })
                .loose()
                .nullish(),
              entryLevel: z.string().nullish(),
              descResponsibilities: z.string().nullish(),
            })
            .loose(),
        ),
        meta: z.object({ totalCount: z.number().nullish() }).loose().nullish(),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let page = 1; page <= 20; page++) {
      const general = JSON.stringify({ page, resultsPerPage: 50, sortField: '', sortOrder: 'asc' });
      const body = Page.parse(
        await ctx.http.json(
          `https://${c.host}/api/v1/search?general=${encodeURIComponent(general)}`,
          { robots: true },
        ),
      );
      total ??= body.meta?.totalCount ?? null;
      for (const j of body.jobs)
        all.push(
          employerListing(ctx, {
            sourceId: j.requisitionId,
            url: j.jobDetailUrl,
            title: j.title,
            ...desc(j.descResponsibilities),
            postedDate: parseDate(j.onlineFrom) ?? undefined,
            closingDate: parseDate(j.onlineUntil) ?? undefined,
            locations:
              j.location?.city || j.location?.name
                ? [{ text: (j.location.city ?? j.location.name)!, country: 'GB' }]
                : [],
            details: { entryLevel: j.entryLevel ?? undefined },
          }),
        );
      if (body.jobs.length < 50 || (total !== null && all.length >= total)) break;
    }
    return finish(all, total ?? all.length);
  },
});

/** amazon.jobs search JSON (UK = country GBR). Apprenticeships are found by title only. */
export const amazon = defineConnector({
  id: 'amazon',
  config: z.object({ country: z.string().default('GBR') }),
  async run(c, ctx) {
    const Page = z
      .object({
        hits: z.number().nullish(),
        jobs: z.array(
          z
            .object({
              id_icims: z.union([z.string(), z.number()]).transform(String),
              title: z.string(),
              location: z.string().nullish(),
              city: z.string().nullish(),
              country_code: z.string().nullish(),
              posted_date: z.string().nullish(),
              job_path: z.string(),
              description: z.string().nullish(),
              basic_qualifications: z.string().nullish(),
            })
            .loose(),
        ),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let offset = 0; offset < 3000; offset += 100) {
      const body = Page.parse(
        await ctx.http.json(
          `https://www.amazon.jobs/en/search.json?country=${c.country}&result_limit=100&offset=${offset}&sort=recent`,
          { robots: true },
        ),
      );
      total ??= body.hits ?? null;
      for (const j of body.jobs)
        all.push(
          employerListing(ctx, {
            sourceId: j.id_icims,
            url: `https://www.amazon.jobs${j.job_path}`,
            title: j.title,
            ...desc([j.description, j.basic_qualifications].filter(Boolean).join('<br/>') || null),
            postedDate: parseDate(j.posted_date?.replace(/\s+/g, ' ')) ?? undefined,
            locations: [
              {
                text: j.city ?? j.location ?? '',
                country: j.country_code === 'GBR' ? 'GB' : (j.country_code ?? undefined),
              },
            ].filter((l) => l.text),
          }),
        );
      if (body.jobs.length < 100 || (total !== null && offset + 100 >= total)) break;
    }
    return finish(all, total ?? all.length);
  },
});

/** Goldman Sachs' higher.gs.com roles API (GraphQL); campus roles include the apprentice programmes. */
export const gsHigher = defineConnector({
  id: 'gs-higher',
  config: z.object({ experiences: z.array(z.string()).default(['CAMPUS']) }),
  async run(c, ctx) {
    const query =
      'query GetRoles($searchQueryInput: RoleSearchQueryInput!) { roleSearch(searchQueryInput: $searchQueryInput) { totalCount items { roleId jobTitle status locations { city country } externalSource { sourceId } } } }';
    const Body = z
      .object({
        data: z.object({
          roleSearch: z.object({
            totalCount: z.number().nullish(),
            items: z.array(
              z
                .object({
                  roleId: z.string(),
                  jobTitle: z.string(),
                  status: z.string().nullish(),
                  locations: z
                    .array(
                      z
                        .object({ city: z.string().nullish(), country: z.string().nullish() })
                        .loose(),
                    )
                    .nullish(),
                  externalSource: z.object({ sourceId: z.string().nullish() }).loose().nullish(),
                })
                .loose(),
            ),
          }),
        }),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let page = 0; page < 10; page++) {
      const body = Body.parse(
        await ctx.http.json('https://api-higher.gs.com/gateway/api/v1/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://higher.gs.com' },
          body: JSON.stringify({
            operationName: 'GetRoles',
            variables: {
              searchQueryInput: {
                page: { pageSize: 100, pageNumber: page },
                sort: { sortStrategy: 'RELEVANCE', sortOrder: 'DESC' },
                filters: [],
                experiences: c.experiences,
                searchTerm: '',
              },
            },
            query,
          }),
        }),
      ).data.roleSearch;
      total ??= body.totalCount ?? null;
      for (const r of body.items) {
        const id = r.externalSource?.sourceId ?? r.roleId;
        all.push(
          employerListing(ctx, {
            sourceId: id,
            url: `https://higher.gs.com/roles/${id}`,
            // '2027 | EMEA | London | Engineering | Apprentice Programme'
            title: r.jobTitle.replace(/\s*\|\s*/g, ' - '),
            locations: (r.locations ?? []).map((l) => ({
              text: [l.city, l.country].filter(Boolean).join(', '),
              country: l.country ?? undefined,
            })),
          }),
        );
      }
      if (body.items.length < 100 || (total !== null && all.length >= total)) break;
    }
    return finish(all, total ?? all.length);
  },
});

/**
 * A WordPress site exposing its jobs post type over the REST API (BAE's jobsearch site merges its
 * GroupGTI, Taleo and SuccessFactors roles; BNP's UK early-careers site). Optional taxonomy
 * filters keep it to UK jobs and apprenticeship terms.
 */
export const wpJobs = defineConnector({
  id: 'wp-jobs',
  config: z.object({
    host: z.string(),
    postType: z.string(),
    countryTermId: z.number().optional(),
    apprenticeTermIds: z.object({ taxonomy: z.string(), ids: z.array(z.number()) }).optional(),
  }),
  async run(c, ctx) {
    const Post = z
      .object({
        id: z.number().transform(String),
        link: z.string(),
        date_gmt: z.string().nullish(),
        date: z.string().nullish(),
        title: z.object({ rendered: z.string() }).loose(),
        content: z.object({ rendered: z.string().nullish() }).loose().nullish(),
        // WordPress sends `acf: []` when a post has no custom fields.
        acf: z
          .union([
            z.array(z.unknown()).transform(() => null),
            z
              .object({
                job_requisition_id: z.union([z.string(), z.number()]).nullish(),
                job_description: z.string().nullish(),
                location_country_iso: z.string().nullish(),
                location_from_ats: z.string().nullish(),
                city_1: z.string().nullish(),
                apply_link: z.string().nullish(),
                level_of_experience: z.union([z.string(), z.array(z.string())]).nullish(),
              })
              .loose(),
          ])
          .nullish(),
        city: z.string().nullish(),
        programme: z.string().nullish(),
      })
      .loose();
    const read = async (extra: string, known: boolean) => {
      const out: RawListing[] = [];
      for (let page = 1; page <= 15; page++) {
        const res = await ctx.http.request(
          `https://${c.host}/wp-json/wp/v2/${c.postType}?per_page=100&page=${page}${extra}`,
          { robots: true, headers: { Accept: 'application/json' } },
        );
        const posts = z.array(z.unknown()).parse(JSON.parse(res.body));
        for (const p of posts) {
          const r = Post.safeParse(p);
          if (!r.success) continue;
          const j = r.data;
          const html = j.acf?.job_description ?? j.content?.rendered ?? null;
          const level = j.acf?.level_of_experience;
          out.push(
            employerListing(ctx, {
              sourceId: String(j.acf?.job_requisition_id ?? j.id),
              url: j.link,
              applyUrl: j.acf?.apply_link ?? undefined,
              title: j.title.rendered,
              ...desc(html),
              postedDate: parseDate(j.date_gmt ?? j.date) ?? undefined,
              locations: [j.acf?.city_1 ?? j.acf?.location_from_ats ?? j.city]
                .filter((x): x is string => !!x)
                .map((text) => ({ text, country: j.acf?.location_country_iso ?? undefined })),
              knownApprenticeship:
                known ||
                /apprentic/i.test(`${String(level ?? '')} ${j.programme ?? ''}`) ||
                undefined,
            }),
          );
        }
        const pages = Number(res.headers.get('x-wp-totalpages') ?? '1');
        if (page >= pages || !posts.length) break;
      }
      return out;
    };
    const country = c.countryTermId ? `&country=${c.countryTermId}` : '';
    const all = await read(country, false);
    if (c.apprenticeTermIds) {
      const tagged = await read(
        `${country}&${c.apprenticeTermIds.taxonomy}=${c.apprenticeTermIds.ids.join(',')}`,
        true,
      );
      const ids = new Set(tagged.map((t) => t.sourceId));
      for (let i = 0; i < all.length; i++)
        if (ids.has(all[i]!.sourceId)) all[i] = { ...all[i]!, knownApprenticeship: true };
    }
    return finish(all);
  },
});

/** iCIMS Jibe career sites' JSON (`/api/jobs`), e.g. careers.se.com. */
export const jibe = defineConnector({
  id: 'jibe',
  config: z.object({ host: z.string(), location: z.string().default('United Kingdom') }),
  async run(c, ctx) {
    const Page = z
      .object({
        totalCount: z.number().nullish(),
        jobs: z.array(
          z
            .object({
              data: z
                .object({
                  req_id: z.union([z.string(), z.number()]).transform(String),
                  slug: z.string().nullish(),
                  title: z.string(),
                  description: z.string().nullish(),
                  qualifications: z.string().nullish(),
                  full_location: z.string().nullish(),
                  city: z.string().nullish(),
                  country_code: z.string().nullish(),
                  posted_date: z.string().nullish(),
                  apply_url: z.string().nullish(),
                  tags2: z.union([z.string(), z.array(z.string())]).nullish(),
                })
                .loose(),
            })
            .loose(),
        ),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let page = 1; page <= 20; page++) {
      const body = Page.parse(
        await ctx.http.json(
          `https://${c.host}/api/jobs?location=${encodeURIComponent(c.location)}&page=${page}&limit=100`,
          { robots: true },
        ),
      );
      total ??= body.totalCount ?? null;
      for (const { data: j } of body.jobs)
        all.push(
          employerListing(ctx, {
            sourceId: j.req_id,
            url: j.slug
              ? `https://${c.host}/jobs/${j.slug}?lang=en-us`
              : (j.apply_url ?? `https://${c.host}/`),
            applyUrl: j.apply_url ?? undefined,
            title: j.title,
            ...desc([j.description, j.qualifications].filter(Boolean).join('\n') || null),
            postedDate: parseDate(j.posted_date) ?? undefined,
            locations: [
              { text: j.full_location ?? j.city ?? '', country: j.country_code ?? undefined },
            ].filter((l) => l.text),
            knownApprenticeship: /apprentic/i.test(String(j.tags2 ?? '')) || undefined,
          }),
        );
      if (body.jobs.length < 100 || (total !== null && all.length >= total)) break;
    }
    return finish(all, total ?? all.length);
  },
});

/**
 * IBM Kenexa BrassRing "TGnewUI" boards (UBS, Jet2): the Home page sets a session cookie and a
 * request token, then MatchedJobs / ProcessSortAndShowMoreJobs return 50 jobs a page as JSON
 * whose fields are a list of {QuestionName, Value}.
 */
export const brassring = defineConnector({
  id: 'brassring',
  config: z.object({
    host: z.string(),
    partnerId: z.string(),
    siteId: z.string(),
    keywordCustomSolrFields: z.string().nullish(),
    locationCustomSolrFields: z.string().nullish(),
    /** Question holding the country ('formtext23' at UBS); 'department' at Jet2. */
    countryField: z.string().optional(),
  }),
  async run(c, ctx) {
    const home = await ctx.http.request(
      `https://${c.host}/TGnewUI/Search/Home/Home?partnerid=${c.partnerId}&siteid=${c.siteId}`,
      { robots: true },
    );
    const token = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(home.body)?.[1];
    const cookies = home.headers.getSetCookie().map((h) => h.split(';')[0]!);
    const session = cookies
      .find((k) => k.startsWith(`tg_session_${c.partnerId}_${c.siteId}=`))
      ?.split('=')
      .slice(1)
      .join('=');
    if (!token) throw new Error('BrassRing: no request token on the Home page');
    const Questions = z.array(
      z.object({ QuestionName: z.string(), Value: z.string().nullish() }).loose(),
    );
    const Page = z
      .object({
        JobsCount: z.number().nullish(),
        Jobs: z
          .object({ Job: z.array(z.object({ Questions: Questions }).loose()).nullish() })
          .loose()
          .nullish(),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let page = 1; page <= 10; page++) {
      const res = await ctx.http.request(
        `https://${c.host}/TgNewUI/Search/Ajax/${page === 1 ? 'MatchedJobs' : 'ProcessSortAndShowMoreJobs'}`,
        {
          method: 'POST',
          robots: true,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            RFT: token,
            Cookie: cookies.join('; '),
          },
          body: JSON.stringify({
            partnerId: c.partnerId,
            siteId: c.siteId,
            keyword: '',
            location: '',
            keywordCustomSolrFields: c.keywordCustomSolrFields ?? 'JobTitle',
            locationCustomSolrFields: c.locationCustomSolrFields ?? 'Location',
            linkId: '',
            Latitude: 0,
            Longitude: 0,
            facetfilterfields: { Facet: [] },
            powersearchoptions: { PowerSearchOption: [] },
            SortType: 'LastUpdated',
            pageNumber: page,
            encryptedSessionValue: session ? decodeURIComponent(session) : '',
          }),
        },
      );
      const body = Page.parse(JSON.parse(res.body));
      total ??= body.JobsCount ?? null;
      const jobs = body.Jobs?.Job ?? [];
      for (const j of jobs) {
        const q = Object.fromEntries(
          j.Questions.map((x) => [x.QuestionName.toLowerCase(), x.Value ?? '']),
        );
        const id = q.reqid ?? q.autoreq ?? '';
        if (!id || !q.jobtitle) continue;
        const country = c.countryField ? q[c.countryField.toLowerCase()] : undefined;
        all.push(
          employerListing(ctx, {
            sourceId: id,
            url: `https://${c.host}/TGnewUI/Search/home/HomeWithPreLoad?partnerid=${c.partnerId}&siteid=${c.siteId}&PageType=JobDetails&jobid=${id}`,
            title: q.jobtitle,
            ...desc(q.jobdescription || null),
            postedDate: parseDate(q.lastupdated) ?? undefined,
            locations: [q.location ?? q.formtext2 ?? '']
              .filter(Boolean)
              .map((text) => ({ text, country: country?.replace(/^U\.K$/i, 'UK') || undefined })),
          }),
        );
      }
      if (jobs.length < 50 || (total !== null && all.length >= total)) break;
    }
    return finish(all, total ?? all.length);
  },
});

/**
 * Cornerstone OnDemand career sites (research §17): the career-site page embeds an anonymous
 * token and the regional API host; the job search is a POST with that token. With an en-GB
 * culture, dates are DD/MM/YYYY.
 */
export const cornerstone = defineConnector({
  id: 'cornerstone',
  config: z.object({
    tenant: z.string(),
    siteId: z.number(),
    cultureId: z.number().default(1),
    cultureName: z.string().default('en-US'),
  }),
  async run(c, ctx) {
    const page = await ctx.http.text(
      `https://${c.tenant}.csod.com/ux/ats/careersite/${c.siteId}/home?c=${c.tenant}`,
      { robots: true },
    );
    const context = /csod\.context\s*=\s*(\{[\s\S]*?\});/.exec(page)?.[1];
    const cfg = context
      ? (JSON.parse(context) as { token?: string; endpoints?: { cloud?: string } })
      : {};
    if (!cfg.token || !cfg.endpoints?.cloud)
      throw new Error('Cornerstone: no token on the career site page');
    const dmy = c.cultureName === 'en-GB';
    const date = (s: string | null | undefined) => {
      const m = s ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s) : null;
      if (!m) return undefined;
      const [d, mo] = dmy ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
      return `${m[3]}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    };
    const Page = z
      .object({
        data: z
          .object({
            totalCount: z.number().nullish(),
            requisitions: z.array(
              z
                .object({
                  requisitionId: z.number().transform(String),
                  displayJobTitle: z.string(),
                  postingEffectiveDate: z.string().nullish(),
                  postingExpirationDate: z.string().nullish(),
                  locations: z
                    .array(
                      z
                        .object({ city: z.string().nullish(), country: z.string().nullish() })
                        .loose(),
                    )
                    .nullish(),
                  externalDescription: z.string().nullish(),
                })
                .loose(),
            ),
          })
          .loose(),
      })
      .loose();
    const all: RawListing[] = [];
    let total: number | null = null;
    for (let pageNumber = 1; pageNumber <= 20; pageNumber++) {
      const body = Page.parse(
        await ctx.http.json(`${cfg.endpoints.cloud}rec-job-search/external/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
          body: JSON.stringify({
            careerSiteId: c.siteId,
            careerSitePageId: c.siteId,
            pageNumber,
            pageSize: 25,
            cultureId: c.cultureId,
            searchText: '',
            cultureName: c.cultureName,
            states: [],
            countryCodes: [],
            cities: [],
            placeID: '',
            radius: null,
            postingsWithinDays: null,
            customFieldCheckboxKeys: [],
            customFieldDropdowns: [],
            customFieldRadios: [],
          }),
        }),
      ).data;
      total ??= body.totalCount ?? null;
      for (const r of body.requisitions)
        all.push(
          employerListing(ctx, {
            sourceId: r.requisitionId,
            url: `https://${c.tenant}.csod.com/ux/ats/careersite/${c.siteId}/home/requisition/${r.requisitionId}?c=${c.tenant}`,
            title: decodeEntities(r.displayJobTitle),
            descriptionText: r.externalDescription?.trim() || undefined,
            postedDate: date(r.postingEffectiveDate),
            closingDate: date(r.postingExpirationDate),
            locations: (r.locations ?? []).map((l) => ({
              text: [l.city, l.country].filter(Boolean).join(', '),
              country: l.country ?? undefined,
            })),
          }),
        );
      if (body.requisitions.length < 25 || (total !== null && all.length >= total)) break;
    }
    return finish(all, total ?? all.length);
  },
});

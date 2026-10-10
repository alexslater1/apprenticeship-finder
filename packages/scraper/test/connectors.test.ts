import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isCandidateTitle,
  isUk,
  parseJobPosting,
  parseSitemap,
  slugWords,
  withDetails,
} from '../src/connectors/common.ts';
import { avatureTotal, parseAvatureList } from '../src/connectors/avature.ts';
import { detectFrom } from '../src/connectors/detect.ts';
import { eightfold } from '../src/connectors/eightfold.ts';
import { leadLines } from '../src/connectors/generic.ts';
import { parseOleeoBoard, stripSession } from '../src/connectors/oleeo.ts';
import { phenom } from '../src/connectors/phenom.ts';
import { greenhouse } from '../src/connectors/simple.ts';
import { jobsFromSitemap, parseSfSearch, sfJobId } from '../src/connectors/successfactors.ts';
import type { Employer, EmployerCtx } from '../src/connectors/types.ts';
import { workday, workdayJobId } from '../src/connectors/workday.ts';
import { employerMatcher, isTransient, statusFor } from '../src/employers.ts';
import type { Http } from '../src/http.ts';

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/connectors/${name}`, import.meta.url), 'utf8');

/** A Ctx whose http answers from fixtures by URL substring, and whose state lives in memory. */
function fakeCtx(routes: Array<[RegExp, string]>, employer: Partial<Employer> = {}): EmployerCtx {
  const state = new Map<string, unknown>();
  const answer = (url: string) => {
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) throw new Error(`no fixture for ${url}`);
    return hit[1];
  };
  const http = {
    requests: 0,
    text: async (url: string) => answer(url),
    json: async (url: string) => JSON.parse(answer(url)),
    request: async (url: string) => ({
      status: 200,
      body: answer(url),
      headers: new Headers(),
      url,
    }),
  } as unknown as Http;
  const e: Employer = {
    id: 'acme',
    name: 'Acme',
    aliases: [],
    connector: null,
    connector_config: {},
    ...employer,
  };
  const log = {
    info() {},
    warn() {},
    error() {},
    child: () => log,
  } as unknown as EmployerCtx['log'];
  return {
    env: {} as EmployerCtx['env'],
    http,
    log,
    state: {
      get: async (k: string) => state.get(k),
      set: async (k: string, v: unknown) => void state.set(k, v),
    } as unknown as EmployerCtx['state'],
    dryRun: false,
    today: '2026-10-10',
    knownSourceIds: async () => new Set(),
    employer: e,
    source: `employer:${e.id}`,
    known: new Set(),
  };
}

describe('common helpers', () => {
  it('spots apprenticeship titles, not coaches', () => {
    expect(isCandidateTitle('2027 Data Science Apprentice - Crawley')).toBe(true);
    expect(isCandidateTitle('Audit School Leaver - Birmingham')).toBe(true);
    expect(isCandidateTitle('Data Apprenticeship Coach')).toBe(false);
    expect(isCandidateTitle('Senior Data Engineer')).toBe(false);
  });
  it.each([
    [{ country: 'GB' }, true],
    [{ country: 'United Kingdom' }, true],
    [{ country: 'DE' }, false],
    [{ country: 'Germany' }, false],
    [{ text: 'Crawley, West Sussex, RH10 9HA', country: 'RH10 9HA' }, true],
    [{ text: 'Belfast, Northern Ireland' }, true],
    [{ text: 'Dublin, Ireland' }, false],
    [{ text: 'New York, NY' }, false],
    [{ text: 'Glasgow' }, true],
    [{ text: 'Somewhere Else' }, null],
  ])('isUk(%j) → %s', (loc, want) => {
    expect(isUk(loc)).toBe(want);
  });
  it('parses urlsets, sitemap indexes and RSS feeds', () => {
    const set = parseSitemap(fx('sf-babcock-sitemap.xml'));
    expect(set.urls).toHaveLength(5);
    expect(set.urls[0]!.lastmod).toMatch(/^2026-/);
    expect(
      parseSitemap('<sitemapindex><sitemap><loc>https://x/a.xml</loc></sitemap></sitemapindex>')
        .sitemaps,
    ).toEqual(['https://x/a.xml']);
    expect(
      parseSitemap(
        '<rss><channel><item><title>t</title><link>https://x/job/1</link></item></channel></rss>',
      ).urls[0]!.url,
    ).toBe('https://x/job/1');
  });
  it('reads JobPosting JSON-LD even when it is not quite JSON', () => {
    const p = parseJobPosting(fx('jsonld-sellafield-job.html'));
    expect(p?.title).toBeTruthy();
    expect(p?.closingDate ?? p?.postedDate).toMatch(/^20\d\d-\d\d-\d\d$/);
  });
  it('falls back to schema.org microdata (SuccessFactors)', () => {
    const p = parseJobPosting(fx('sf-royallondon-job.html'));
    expect(p?.title).toBe('Actuarial Trainee');
    expect(p?.descriptionHtml).toContain('Edinburgh');
  });
  it('turns URL slugs into words', () => {
    expect(slugWords('https://x.com/job/Glasgow-Data-Analyst-Apprentice/123/')).toBe(
      'job Glasgow Data Analyst Apprentice 123',
    );
  });
  it('withDetails fetches a job once, then reuses the cache while it is stored', async () => {
    const ctx = fakeCtx([]);
    let calls = 0;
    const opts = {
      id: (t: string) => t,
      sig: () => 'v1',
      detail: async (t: string) => {
        calls++;
        return {
          source: ctx.source,
          sourceId: t,
          url: 'u',
          title: 'Data Apprentice',
          employerName: 'Acme',
          locations: [],
          descriptionText: 'long',
        };
      },
    };
    const first = await withDetails(ctx, ['a'], opts);
    expect(first.listings[0]!.descriptionText).toBe('long');
    ctx.known.add('a');
    const second = await withDetails(ctx, ['a'], opts);
    expect(calls).toBe(1);
    expect(second.listings[0]!.descriptionText).toBeUndefined(); // persist keeps the stored one
  });
});

describe('workday', () => {
  it('keys jobs on the requisition id', () => {
    expect(workdayJobId({ externalPath: '/job/Glasgow/2027-Data-Apprentice_JR-0000131878' })).toBe(
      'JR-0000131878',
    );
  });
  it('reads a small board in full and keeps UK apprenticeship candidates', async () => {
    const list = fx('workday-barclays-list.json');
    const detail = JSON.stringify({
      jobPostingInfo: {
        title: '2027 Risk Analyst Higher Apprenticeship Programme Northampton',
        jobDescription: '<p>Level 4 apprenticeship</p>',
        location: 'Northampton',
        startDate: '2026-10-07',
        endDate: '2026-11-01',
        externalUrl: 'https://barclays.wd3.myworkdayjobs.com/job/x',
        jobRequisitionLocation: { country: { alpha2Code: 'GB' } },
      },
    });
    const ctx = fakeCtx([
      [/\/jobs$/, list],
      [/\/job\//, detail],
    ]);
    const r = await workday.run(
      {
        host: 'barclays.wd3.myworkdayjobs.com',
        tenant: 'barclays',
        site: 'External_Career_Site_Barclays',
      },
      ctx,
    );
    expect(r.total).toBe(19);
    expect(r.jobs.length).toBe(3);
    expect(r.jobs[0]).toMatchObject({
      source: 'employer:acme',
      employerName: 'Acme',
      closingDate: '2026-11-01',
      postedDate: '2026-10-07',
    });
  });
  it('detects tenant and site from careers URLs', () => {
    expect(
      workday.detect!(
        'https://barclays.wd3.myworkdayjobs.com/en-US/External_Career_Site_Barclays/job/x_JR-1',
      ),
    ).toEqual({
      host: 'barclays.wd3.myworkdayjobs.com',
      tenant: 'barclays',
      site: 'External_Career_Site_Barclays',
    });
  });
});

describe('successfactors', () => {
  it('lists jobs from the sitemap with their slug titles', () => {
    const jobs = jobsFromSitemap(parseSitemap(fx('sf-babcock-sitemap.xml')).urls);
    expect(jobs).toHaveLength(5);
    expect(jobs[0]!.id).toMatch(/^\d+$/);
    expect(jobs[0]!.slug).not.toMatch(/\d{6,}/);
  });
  it('parses table and tile search layouts', () => {
    const table = parseSfSearch(fx('sf-babcock-search.html'), 'jobs.babcockinternational.com');
    expect(table.jobs.length).toBe(3);
    expect(table.jobs[0]!.title).toBeTruthy();
    const tiles = parseSfSearch(fx('sf-eon-tiles.html'), 'careers.eon.com');
    expect(tiles.jobs.length).toBeGreaterThan(0);
    expect(tiles.total).toBeGreaterThan(0);
  });
  it('strips the locale suffix from Unify job ids', () => {
    expect(sfJobId('https://jobs.royallondon.com/job/Actuarial-Trainee/1234-en_GB/')).toBe('1234');
  });
});

describe('avature', () => {
  it('reads job rows and the programme field', () => {
    const rows = parseAvatureList(fx('avature-deloitte-list.html'), 'apply.deloitte.co.uk');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /^\d+$/.test(r.id))).toBe(true);
    expect(avatureTotal('<p>1-20 of 37 results</p>')).toBe(37);
    expect(avatureTotal('<p>1-10 of 999+ results</p>')).toBeNull();
  });
});

describe('oleeo', () => {
  it('parses tal.net boards and strips the session token', () => {
    const b = parseOleeoBoard(fx('oleeo-rsm-board.html'));
    expect(b.rows).toHaveLength(3);
    expect(b.next).toBe(true);
    expect(b.rows[0]!.url).not.toMatch(/xf-[0-9a-f]+/);
    expect(stripSession('https://x.tal.net/vx/a/xf-abc123/candidate')).toBe(
      'https://x.tal.net/vx/a/candidate',
    );
  });
  it('parses Networx-branded boards (GCHQ) with closing dates', () => {
    const b = parseOleeoBoard(fx('oleeo-gchq-board.html'));
    expect(b.rows.length).toBe(3);
    expect(b.rows[0]).toMatchObject({ location: 'Cheltenham', closing: '2026-10-14' });
  });
});

describe('eightfold, phenom, greenhouse', () => {
  it('eightfold keeps UK positions from PCSX', async () => {
    const ctx = fakeCtx([[/pcsx\/search/, fx('eightfold-msft-pcsx.json')]]);
    const r = await eightfold.run(
      { host: 'apply.careers.microsoft.com', domain: 'microsoft.com', api: 'pcsx' },
      ctx,
    );
    expect(r.total).toBeGreaterThan(0);
    expect(r.stats?.uk).toBe(2);
  });
  it('phenom drops jobs outside the UK', async () => {
    const ctx = fakeCtx([[/\/widgets$/, fx('phenom-dhl-widgets.json')]]);
    const r = await phenom.run(
      { host: 'careers.dhl.com', cc: 'global', lang: 'en', pageId: 'page17' },
      ctx,
    );
    expect(r.stats?.listed).toBe(3);
    expect(r.jobs.every((j) => j.locations.some((l) => isUk(l)))).toBe(true);
  });
  it('greenhouse decodes the escaped content', async () => {
    const ctx = fakeCtx([[/boards-api/, fx('greenhouse-autotrader.json')]]);
    const r = await greenhouse.run({ token: 'autotrader' }, ctx);
    expect(r.total).toBe(3);
    expect(r.complete).toBe(true);
  });
});

describe('pagehash leads', () => {
  it('keeps headline-like lines about data apprenticeships only', () => {
    const html = `<main>
      <h2>Level 6 Data Science Apprenticeship</h2>
      <p>You are eligible to apply for the Level 6 Data Science Degree Apprenticeship if you have A levels.</p>
      <a href="/s">Evie Brown talking about her data apprenticeship experience</a>
      <li>Data Analyst Apprenticeship 2025 – now closed</li>
      <h3>AI and Data Science Graduate Apprenticeship</h3>
      <h3>Software Engineering Apprenticeship</h3>
    </main>`;
    expect(leadLines(html)).toEqual([
      'Level 6 Data Science Apprenticeship',
      'AI and Data Science Graduate Apprenticeship',
    ]);
  });
});

describe('detection and employer matching', () => {
  it.each([
    ['https://barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays', 'workday'],
    ['https://boards.greenhouse.io/monzo', 'greenhouse'],
    ['https://jobs.lever.co/zopa', 'lever'],
    ['https://morganstanley.tal.net/vx/candidate/jobboard/vacancy/1/adv/', 'oleeo'],
    [
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/123',
      'oracle',
    ],
    ['https://accenture.pinpointhq.com/en/postings/abc', 'pinpoint'],
  ])('%s → %s', (url, connector) => {
    expect(detectFrom(url)?.connector).toBe(connector);
  });
  it('matches legal names and aliases to watchlist employers', () => {
    const match = employerMatcher([
      { id: 'barclays', name: 'Barclays', aliases: [] },
      { id: 'sky', name: 'Sky', aliases: [] },
      { id: 'lloyds-banking-group', name: 'Lloyds Banking Group', aliases: ['Lloyds Bank'] },
    ]);
    expect(match('barclays bank')).toBe('barclays');
    expect(match('lloyds bank')).toBe('lloyds-banking-group');
    expect(match('sky')).toBe('sky');
    expect(match('sky betting and gaming')).toBeNull();
  });
});

describe('employer status', () => {
  const employer = {
    id: 'barclays',
    name: 'Barclays',
    aliases: [],
    connector: 'workday',
    connector_config: {},
    status: 'open' as const,
  };
  it("keeps yesterday's status through a maintenance page or timeout", () => {
    const msg = 'Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON';
    expect(isTransient(msg)).toBe(true);
    expect(statusFor({ employer, error: msg, transient: true, ms: 0 }, 0)).toBe('open');
    expect(
      statusFor(
        { employer: { ...employer, status: 'unknown' }, error: msg, transient: true, ms: 0 },
        0,
      ),
    ).toBe('error');
  });
  it('reports real failures', () => {
    expect(isTransient('HTTP 404 for https://x')).toBe(false);
    expect(statusFor({ employer, error: 'HTTP 404', ms: 0 }, 0)).toBe('error');
  });
});

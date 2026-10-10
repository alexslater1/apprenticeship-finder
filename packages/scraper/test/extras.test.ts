import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RawListing } from '@af/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockedError, Http } from '../src/http.ts';
import { logger } from '../src/log.ts';
import { normalise } from '../src/pipeline/normalise.ts';
import {
  amazing,
  editionOf,
  findListingPdfs,
  findResourcePages,
  isWanted,
  looksLikeVacancy,
  monthOf,
  parseListing,
  pdfToText,
  splitLocations,
  toRawListing as amazingListing,
  type VacancyEntry,
} from '../src/sources/amazing.ts';
import {
  cleanTitle,
  clientFromDescription,
  itemLooksRelevant,
  parseDetailPage,
  parseSearchPage,
  toRawListing as ngtuListing,
} from '../src/sources/ngtu.ts';
import type { Ctx } from '../src/types.ts';

// Fixtures: real responses from 2026-10-09/10, trimmed. The listing .txt files are
// `pdftotext -layout` output of the January 2026 (table) and April 2026 (card) PDFs, a few pages
// each; the NGTU pages keep their JSON-LD and the embedded opportunity record.
const fx = (p: string) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');

const JAN_PDF =
  'https://www.amazingapprenticeships.com/wp-content/uploads/2026/01/Higher-and-Degree-Listing-January-2026.pdf';
const APR_PDF =
  'https://www.amazingapprenticeships.com/wp-content/uploads/2026/04/April-HD-Listing-2026-MASTER-1.pdf';

const find = (entries: VacancyEntry[], employer: string, role: string | RegExp) =>
  entries.find(
    (e) =>
      e.employer === employer && (typeof role === 'string' ? e.role === role : role.test(e.role)),
  )!;

describe('Amazing Apprenticeships: finding the PDF', () => {
  it('reads the listing PDF off the resource page', () => {
    expect(findListingPdfs(fx('amazing/resource-page.html'))).toEqual([APR_PDF]);
  });

  it('follows the landing page to the current resource page', () => {
    expect(findResourcePages(fx('amazing/landing-page.html'))).toEqual([
      'https://www.amazingapprenticeships.com/resources/higher-and-degree-listing/',
    ]);
  });

  it('skips teacher guides and posters, newest upload first', () => {
    const html = `
      <a href="/wp-content/uploads/2024/10/2025-HD-Listing-Teacher-resource.pdf">guide</a>
      <a href="https://www.amazingapprenticeships.com/wp-content/uploads/2025/10/Higher-Degree-poster-2025.pdf">poster</a>
      <a href="https://www.amazingapprenticeships.com/wp-content/uploads/2025/10/Higher-and-Degree-Listing-October-2025.pdf">old</a>
      <a href="https://www.amazingapprenticeships.com/wp-content/uploads/2026/10/Higher-and-Degree-Listing-October-2026.pdf">new</a>`;
    expect(findListingPdfs(html)).toEqual([
      'https://www.amazingapprenticeships.com/wp-content/uploads/2026/10/Higher-and-Degree-Listing-October-2026.pdf',
      'https://www.amazingapprenticeships.com/wp-content/uploads/2025/10/Higher-and-Degree-Listing-October-2025.pdf',
    ]);
  });
});

describe('Amazing Apprenticeships: table layout (January 2026)', () => {
  const text = fx('amazing/listing-2026-01.txt');
  const entries = parseListing(text);

  it('finds one entry per vacancy link', () => {
    const links = new Set(text.match(/amapps\.uk\/jan26\w+/g));
    expect(entries.length).toBe(links.size);
    expect(entries.every((e) => e.link && links.has(e.link))).toBe(true);
    expect(editionOf(text)).toEqual({ year: 2026, month: 1 });
  });

  it('parses a row, taking the years from the line below', () => {
    expect(find(entries, 'Severn Trent', 'Data Analyst Apprentice')).toEqual({
      section: 'Digital',
      employer: 'Severn Trent',
      role: 'Data Analyst Apprentice',
      level: 4,
      location: 'Coventry',
      salary: '£22,500',
      opens: 'January 2026',
      closes: 'March 2026',
      start: 'September 2026',
      link: 'amapps.uk/jan26sev9',
    });
  });

  it('joins wrapped cells: role, employer, location and salary', () => {
    expect(find(entries, 'JLR', /Data Analytics/).role).toBe(
      'Digital & Technology Solutions - Data Analytics Degree Apprentice',
    );
    expect(find(entries, 'Government Social Research', /Social Researcher/)).toBeTruthy();
    expect(find(entries, 'CMS Cameron McKenna Nabarro Olswang LLP', /Graduate/).salary).toBe(
      '£36,500',
    );
    expect(find(entries, 'Dunelm', /Retail/).location).toContain('Newcastle-under-Lyme, Oldbury');
    // Salary missing from the first line, then four lines of it under a one-line location.
    expect(find(entries, 'Rhotic Media', /Marketing/)).toMatchObject({
      location: 'Chelmsford',
      salary: '£14,918 to £24,126 (age-dependent)',
      closes: 'February 2026',
    });
    expect(find(entries, 'Hollywood Bowl Group', /Management/).salary).toBe(
      '£7.55 per hour, rising after the first year',
    );
  });

  it('splits cells pdftotext ran together with one space', () => {
    expect(find(entries, 'Ashe Group Ltd', /Site Supervisor/)).toMatchObject({
      location: 'Head office is Hitchin, the role will be site based',
      salary: 'Competitive',
      opens: 'Open now',
      closes: 'March 2026',
    });
    expect(find(entries, 'Severn Trent', 'Project Manager Apprentice')).toMatchObject({
      location: 'Coventry, Derby, Shrewsbury',
      salary: '£22,500',
    });
    expect(find(entries, 'Atkins Realis', 'Civil Engineer Degree Apprentice')).toMatchObject({
      location: expect.stringContaining('Buckinghamshire, Cambridge, Chelmsford'),
      salary: '£21,000 - £28,808',
    });
    expect(find(entries, 'Warwickshire Police', /Constable/)).toMatchObject({
      opens: 'July 2026',
      closes: 'September 2026',
      start: 'Ongoing',
    });
  });

  it('keeps the Digital section and data/tech roles only', () => {
    const wanted = entries.filter(isWanted).map((e) => `${e.employer}: ${e.role}`);
    expect(wanted).toEqual(
      expect.arrayContaining([
        'Severn Trent: Data Analyst Apprentice',
        'JLR: Digital & Technology Solutions - Data Analytics Degree Apprentice',
        'British Army: Data Analyst',
        'Atkins Realis: Digital & Technology Solutions Professional Software Engineer',
      ]),
    );
    expect(wanted.some((w) => /Solicitor|Police Constable|Supply Chain/.test(w))).toBe(false);
  });
});

describe('Amazing Apprenticeships: card layout (April 2026)', () => {
  const entries = parseListing(fx('amazing/listing-2026-04.txt'));

  it('parses label/value cards', () => {
    expect(find(entries, 'Neptune North', /DevOps/)).toEqual({
      section: 'Digital',
      employer: 'Neptune North',
      role: 'Digital & Technology Solutions Degree Apprentice (DevOps)',
      level: 6,
      location: 'Newcastle Upon Tyne',
      salary: 'Competitive',
      opens: 'Open now',
      closes: 'Ongoing',
      start: 'September 2026',
      link: 'careers@neptunenorth.co.uk',
    });
  });

  it('handles values on the label lines and wrapped locations', () => {
    expect(find(entries, 'HFW LLP', 'Solicitor Apprentice')).toMatchObject({
      level: 7,
      location: 'London',
      opens: 'October 2026',
      closes: 'December 2026',
      start: 'September 2027',
      salary: '£27,000',
    });
    expect(find(entries, 'KPMG', 'Audit Apprentice').location).toMatch(/^Bristol, .*, Watford$/);
    expect(find(entries, 'British Army', 'Network Engineer')).toMatchObject({
      section: 'Protective services (emergency and uniformed services)',
      location: 'National',
      salary: '£26,334',
      opens: 'Open now',
      closes: 'Ongoing',
      start: 'Ongoing',
    });
  });

  it('takes the edition from the file name when the text has none', () => {
    expect(editionOf('', APR_PDF)).toEqual({ year: 2026, month: 4 });
  });
});

describe('Amazing Apprenticeships: listings', () => {
  const jan = parseListing(fx('amazing/listing-2026-01.txt'));
  const apr = parseListing(fx('amazing/listing-2026-04.txt'));
  const edition = { year: 2026, month: 1 };

  it('maps an entry with a resolved short link to a listing', () => {
    const raw = amazingListing(find(jan, 'Severn Trent', 'Data Analyst Apprentice'), {
      pdfUrl: JAN_PDF,
      edition,
      resolved: 'https://www.careers.severntrent.com/job-invite/21905/',
    });
    expect(raw).toMatchObject({
      source: 'amazing',
      sourceId: 'jan26sev9',
      url: 'https://www.careers.severntrent.com/job-invite/21905/',
      title: 'Data Analyst Apprentice',
      employerName: 'Severn Trent',
      level: 4,
      salaryText: '£22,500',
      closingDate: '2026-03-31',
      startDate: '2026-09-01',
      locations: [{ text: 'Coventry' }],
      knownApprenticeship: true,
      details: { section: 'Digital', shortLink: 'https://amapps.uk/jan26sev9' },
    });
    expect(raw.isLead).toBeUndefined();
    const n = normalise(raw)!;
    expect(n.classification).toMatchObject({ roleType: 'data_analyst', level: 4 });
    expect(n.salaryMin).toBe(22500);
  });

  it('treats short links we could not resolve, and careers home pages, as leads', () => {
    const e = find(jan, 'Severn Trent', 'Data Analyst Apprentice');
    const unresolved = amazingListing(e, { pdfUrl: JAN_PDF, edition });
    expect(unresolved).toMatchObject({ url: 'https://amapps.uk/jan26sev9', isLead: true });
    const home = amazingListing(e, {
      pdfUrl: JAN_PDF,
      edition,
      resolved: 'https://www.severntrent.com/careers/',
    });
    expect(home.isLead).toBe(true);
  });

  it('links email-only entries to the PDF and applies by email', () => {
    const raw = amazingListing(find(apr, 'Neptune North', /SRE/), { pdfUrl: APR_PDF, edition });
    expect(raw).toMatchObject({
      url: APR_PDF,
      applyUrl: 'mailto:careers@neptunenorth.co.uk',
      isLead: true,
      details: { closesText: 'Ongoing', contact: 'careers@neptunenorth.co.uk' },
    });
    expect(raw.closingDate).toBeUndefined();
    expect(normalise(raw)!.classification).toMatchObject({ roleType: 'software_tech', level: 6 });
  });

  it('maps national roles and location lists', () => {
    const army = amazingListing(find(apr, 'British Army', 'Data Analyst'), {
      pdfUrl: APR_PDF,
      edition,
    });
    expect(army).toMatchObject({ isNational: true, locations: [] });
    expect(splitLocations('Bury St Edmunds and Claydon').locations).toEqual([
      { text: 'Bury St Edmunds' },
      { text: 'Claydon' },
    ]);
    expect(splitLocations('Head office is Hitchin, the role will be site based').locations).toEqual(
      [{ text: 'Head office is Hitchin, the role will be site based' }],
    );
  });

  it('dates months against the edition', () => {
    expect(monthOf('March', edition)).toEqual({ year: 2026, month: 3 });
    expect(monthOf('January', { year: 2026, month: 10 })).toEqual({ year: 2027, month: 1 });
    expect(monthOf('Ongoing', edition)).toBeNull();
    expect(looksLikeVacancy('https://jobs.army.mod.uk/roles/intelligence-corps/operator/')).toBe(
      true,
    );
    expect(
      looksLikeVacancy(
        'https://www.kpmgcareers.co.uk/apprentice/technology-engineering/?utm_source=amazingapprenticeships&utm_campaign=job-ads-2026',
      ),
    ).toBe(false);
  });
});

/** Just enough of a Ctx for the source's state handling. */
function fakeCtx(state: Record<string, unknown>, pages: Record<string, string>) {
  const calls: string[] = [];
  const http = {
    text: async (url: string) => {
      calls.push(url);
      if (!(url in pages)) throw new Error(`unexpected fetch ${url}`);
      return pages[url]!;
    },
    bytes: async (url: string) => {
      throw new Error(`unexpected download ${url}`);
    },
  };
  const ctx = {
    http,
    log: logger('test'),
    state: {
      get: async (k: string) => state[k],
      set: async (k: string, v: unknown) => void (state[k] = v),
    },
    dryRun: false,
    today: '2026-10-10',
    knownSourceIds: async () => new Set<string>(),
  } as unknown as Ctx;
  return { ctx, calls };
}

describe('Amazing Apprenticeships: weekly check', () => {
  const stored: RawListing = {
    source: 'amazing',
    sourceId: 'apr26army2',
    url: 'https://jobs.army.mod.uk/roles/x/',
    title: 'Data Analyst',
    employerName: 'British Army',
    locations: [],
  };
  const parsed = { url: APR_PDF, entries: 62, listings: [stored] };
  const RESOURCE = 'https://www.amazingapprenticeships.com/resources/higher-and-degree-listing/';
  const LANDING = 'https://www.amazingapprenticeships.com/higher-degree-listing/';

  it('re-emits the last parse without fetching between checks', async () => {
    const state = {
      'amazing:last_pdf': APR_PDF,
      'amazing:last_check': '2026-10-06',
      'amazing:listings': parsed,
    };
    const { ctx, calls } = fakeCtx(state, {});
    const res = await amazing.run(ctx);
    expect(res.listings).toEqual([stored]);
    expect(res.complete).toBe(false);
    expect(calls).toEqual([]);
  });

  it('looks again after six days and keeps the parse when the PDF is unchanged', async () => {
    const state: Record<string, unknown> = {
      'amazing:last_pdf': APR_PDF,
      'amazing:last_check': '2026-10-03',
      'amazing:listings': parsed,
    };
    const { ctx, calls } = fakeCtx(state, {
      [RESOURCE]: fx('amazing/resource-page.html'),
      [LANDING]: fx('amazing/landing-page.html'),
    });
    const res = await amazing.run(ctx);
    expect(res.listings).toEqual([stored]);
    expect(res.stats).toMatchObject({ checked: 'yes', changed: 'no' });
    expect(calls).toEqual([RESOURCE, LANDING]);
    expect(state['amazing:last_check']).toBe('2026-10-10');
  });

  it('keeps emitting the stored edition when the site is down', async () => {
    const state: Record<string, unknown> = {
      'amazing:last_pdf': APR_PDF,
      'amazing:last_check': '2026-10-01',
      'amazing:listings': parsed,
    };
    const { ctx } = fakeCtx(state, {});
    const res = await amazing.run(ctx);
    expect(res.listings).toEqual([stored]);
    expect(res.stats.checked).toBe('failed');
    expect(state['amazing:last_check']).toBe('2026-10-01'); // try again tomorrow
  });

  it('downloads a PDF it has not seen', async () => {
    const state: Record<string, unknown> = {
      'amazing:last_pdf': JAN_PDF,
      'amazing:last_check': '2026-09-01',
    };
    const { ctx } = fakeCtx(state, {
      [RESOURCE]: fx('amazing/resource-page.html'),
      [LANDING]: fx('amazing/landing-page.html'),
    });
    await expect(amazing.run(ctx)).rejects.toThrow(`unexpected download ${APR_PDF}`);
  });
});

// A one-page PDF saying `text`, built by hand so no binary fixture is needed.
function tinyPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('pdftotext', () => {
  it.skipIf(!hasPdftotext)('converts a PDF to layout text', async () => {
    expect(await pdfToText(tinyPdf('Role    Data Analyst Apprentice'))).toContain(
      'Data Analyst Apprentice',
    );
  });
});

describe('Http: bytes and manual redirects', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/listing.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]));
      } else if (req.url === '/short') {
        res.writeHead(301, { location: 'https://careers.example.com/job/123' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><title>Just a moment...</title></html>');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('returns binary bodies untouched', async () => {
    const bytes = await new Http().bytes(`${base}/listing.pdf`);
    expect([...bytes]).toEqual([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
  });

  it('hands back a redirect instead of following it', async () => {
    const res = await new Http().request(`${base}/short`, { method: 'HEAD', redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://careers.example.com/job/123');
  });

  it('still spots a bot wall where a file was expected', async () => {
    await expect(new Http().bytes(`${base}/wall`)).rejects.toBeInstanceOf(BlockedError);
  });
});

describe('Not Going To Uni', () => {
  const search = parseSearchPage(fx('ngtu/search-data.html'));

  it('reads page 1 of the search and the total', () => {
    expect(search.total).toBe(82);
    expect(search.items.length).toBe(16);
    expect(search.items[0]).toEqual({
      id: '12837',
      url: 'https://notgoingtouni.co.uk/qa/opportunity-detail/data-administrator-apprentice-jobs-in-business-administration-leeds-west-yorkshire-12837',
      name: 'Data Administrator Apprentice jobs in Business & Administration Leeds WEST YORKSHIRE',
    });
  });

  it('only fetches detail pages that look like data/tech roles', () => {
    const skipped = search.items.filter((i) => !itemLooksRelevant(i)).map((i) => i.id);
    // 11359 is a level 2 course: out of scope since levels 2–3 were dropped.
    expect(skipped).toEqual(['12789', '11359']); // 'Level 4 Data Centre Operations – Uxbridge College'
  });

  it('maps JSON-LD plus the opportunity record to a listing', () => {
    const item = search.items.find((i) => i.id === '12827')!;
    const page = parseDetailPage(fx('ngtu/detail-12827.html'));
    expect(page.opportunity?.opportunityType).toBe('Higher Apprenticeship');
    const raw = ngtuListing(item, page)!;
    expect(raw).toMatchObject({
      source: 'ngtu',
      sourceId: '12827',
      url: item.url,
      title: 'Data Analyst Apprentice',
      employerName: 'Grosvenor',
      providerName: 'QA',
      level: 4,
      salaryMin: 27300,
      postedDate: '2026-10-05',
      locations: [{ text: 'London, Greater London' }],
      knownApprenticeship: true,
      details: { opportunityType: 'Higher Apprenticeship', deadlineText: 'Open' },
    });
    expect(raw.applyUrl).toMatch(/^https:\/\/becomeanapprentice\.qa\.com\/jobs\/8498556-/);
    expect(raw.closingDate).toBeUndefined();
    expect(normalise(raw)!.classification).toMatchObject({ roleType: 'data_analyst', level: 4 });
  });

  it('reads salary ranges from the text (the JSON-LD squashes them)', () => {
    const item = search.items.find((i) => i.id === '12268')!;
    const raw = ngtuListing(item, parseDetailPage(fx('ngtu/detail-12268.html')))!;
    expect(raw).toMatchObject({
      employerName: 'Support Warehouse',
      level: 3,
      salaryMin: 20000,
      salaryMax: 22000,
    });
  });

  it('drops courses that are not apprenticeships', () => {
    const item = search.items.find((i) => i.id === '12789')!;
    expect(ngtuListing(item, parseDetailPage(fx('ngtu/detail-12789-course.html')))).toBeNull();
  });

  it('names the client behind a training-provider advert, or gives up', () => {
    expect(clientFromDescription("We're Transform. Transform is a fresh alternative…")).toBe(
      'Transform',
    );
    expect(clientFromDescription('Join the team at Birmingham Airport and start your career')).toBe(
      'Birmingham Airport',
    );
    expect(clientFromDescription('The Nutrition Society is a registered charity')).toBe(
      'The Nutrition Society',
    );
    expect(clientFromDescription('The successful candidate will join a busy team.')).toBeNull();
    expect(clientFromDescription('Our client is a leading retailer.')).toBeNull();
    expect(clientFromDescription('QA is a top 50 training provider.')).toBeNull();
  });

  it('strips the SEO tail from titles', () => {
    expect(
      cleanTitle('Data Engineer Apprentice jobs in IT &amp; Technology London Greater London'),
    ).toBe('Data Engineer Apprentice');
    expect(cleanTitle('Level 4 Data Centre Operations – Uxbridge College')).toBe(
      'Level 4 Data Centre Operations – Uxbridge College',
    );
  });
});

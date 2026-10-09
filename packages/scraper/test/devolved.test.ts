import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalise } from '../src/pipeline/normalise.ts';
import {
  niDate,
  isRelevantCard,
  parseDetailPage,
  parseSearchPage,
  toRawListing as niListing,
} from '../src/sources/ni.ts';
import {
  Detail as ScotDetail,
  Doc,
  extractApimKey,
  findBundleUrl,
  isRelevantDoc,
  scotLevel,
  scotSalary,
  textToHtml,
  toRawListing as scotListing,
} from '../src/sources/scot.ts';
import {
  Detail as WalesDetail,
  isRelevantItem,
  Item,
  toRawListing as walesListing,
  walesLevel,
} from '../src/sources/wales.ts';

const text = (p: string) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
const json = (p: string) => JSON.parse(text(p));

describe('Scotland (apprenticeships.scot)', () => {
  const docs = (p: string) =>
    (json(p).results as Array<{ document: unknown }>).map((r) => Doc.parse(r.document));
  const ga = docs('scot/search-ga.json');
  const ma = docs('scot/search-ma.json');
  const byRef = (ref: string) => [...ga, ...ma].find((d) => d.RefCode === ref)!;

  it('finds the search bundle and its vacancy-API key (not My World of Work’s)', () => {
    expect(findBundleUrl(text('scot/find-a-vacancy.html'))).toBe(
      'https://www.apprenticeships.scot/_astro/VacancySearchApp.7d10da6a.js',
    );
    const js = text('scot/VacancySearchApp.js.txt');
    expect(extractApimKey(js)).toBe('0123456789abcdef0123456789abcdef');
    // With the SDS search call cut away, the MWOW key comes first and must still be skipped.
    const fromMwow = js.slice(js.indexOf('api.myworldofwork'));
    expect(extractApimKey(fromMwow)).toBe('0123456789abcdef0123456789abcdef');
    expect(extractApimKey(js.replace(/sdsapi-prod/g, 'elsewhere'))).toBeNull();
  });

  it('parses search documents, string numbers included', () => {
    expect(ga).toHaveLength(4);
    const helpdesk = byRef('167232');
    expect(helpdesk).toMatchObject({ MinSalary: 18000, WorkingHours: 37.5, GeoLocationLat: 0 });
    expect(JSON.stringify(json('scot/search-ma.json'))).not.toMatch(/Contact|Telephone/);
  });

  it('maps levels: GA = degree, MA via SCQF → RQF', () => {
    expect(scotLevel(byRef('167315'))).toBe(6); // GA, though its SCQF field says 8
    expect(scotLevel({ ...byRef('167315'), ModernApprenticeshipLevel: 'SCQF level 11' })).toBe(7);
    expect(scotLevel(byRef('167232'))).toBe(3); // SCQF 6
    expect(scotLevel(byRef('167133'))).toBe(4); // SCQF 8
    expect(scotLevel({ ...byRef('167232'), ModernApprenticeshipLevel: 'SCQF level 10' })).toBe(6);
    expect(scotLevel({ ...byRef('167232'), ModernApprenticeshipLevel: null })).toBeUndefined();
  });

  it('keeps the AI GA, drops civil engineering, admin and IT support', () => {
    const kept = [...ga, ...ma].filter((d) => isRelevantDoc(d)).map((d) => d.JobTitle);
    expect(kept).toEqual(['2027 AI Engineer Apprentice']);
    // A generic GA title is kept once its framework is known to be Data Science.
    const generic = { ...byRef('167343'), JobTitle: 'Graduate Apprentice 2027' };
    expect(isRelevantDoc(generic)).toBe(false);
    expect(isRelevantDoc(generic, 'Data Science')).toBe(true);
    expect(isRelevantDoc({ ...byRef('167315'), VacancyType: 'FA' })).toBe(false);
  });

  it('maps a GA with its detail to a RawListing', () => {
    const detail = ScotDetail.parse(json('scot/detail-167315.json'));
    expect(detail.frameworkName).toBe('Engineering: Instrumentation, Measurement and Control');
    const raw = scotListing(byRef('167315'), detail.frameworkName ?? undefined);
    expect(raw).toMatchObject({
      source: 'scot',
      sourceId: '167315',
      url: 'https://www.apprenticeships.scot/vacancy-details/?refCode=167315',
      title: '2027 AI Engineer Apprentice',
      employerName: 'Thales Group',
      providerName: 'Glasgow Caledonian University',
      level: 6,
      standardTitle:
        'Engineering: Instrumentation, Measurement and Control (Graduate Apprenticeship)',
      salaryMin: 24000,
      closingDate: '2026-12-01',
      postedDate: '2026-10-08',
      knownApprenticeship: true,
    });
    expect(raw.applyUrl).toMatch(/myworkdayjobs\.com/);
    expect(raw.locations[0]).toMatchObject({
      text: 'GLASGOW, G51 4BZ',
      postcode: 'G51 4BZ',
      nation: 'Scotland',
      lat: expect.any(Number),
    });
    expect(raw.descriptionHtml).toContain('<h3>What you’ll learn</h3>');
    expect(raw.details).toMatchObject({ apprenticeshipType: 'Graduate Apprenticeship' });
    expect(JSON.stringify(raw.raw)).not.toMatch(/Contact|Telephone|PassportUserId/);

    const n = normalise(raw)!;
    expect(n.classification).toMatchObject({ roleType: 'ml_ai', level: 6, isDegree: true });
    expect(n.nation).toBe('Scotland');
  });

  it('hides withheld employers and handles hourly and minimum-wage pay', () => {
    const hidden = scotListing(byRef('167316'));
    expect(hidden.employerName).toBe('Unknown employer');
    expect(hidden.details?.employerHidden).toBe(true);
    expect(scotSalary(byRef('167316'))).toEqual({
      min: 17500,
      max: 18500,
      text: '£17,500–£18,500 a year',
    });
    // £10.50 an hour over 37 hours a week
    expect(scotSalary(byRef('167202'))).toMatchObject({ min: 20202, text: '£10.50 an hour' });
    expect(scotSalary(byRef('167282'))).toEqual({ text: 'Apprentice minimum wage' });
    // Unplaced vacancies have 0,0 coordinates: don't keep them.
    expect(scotListing(byRef('167232')).locations[0]!.lat).toBeUndefined();
  });

  it('turns plain-text descriptions into paragraphs', () => {
    expect(textToHtml('One\nTwo & <three>\n\nFour')).toBe(
      '<p>One<br>Two &amp; &lt;three&gt;</p>\n<p>Four</p>',
    );
  });
});

describe('Wales (Careers Wales)', () => {
  const items = [
    ...json('wales/search-sector10.json').data,
    ...json('wales/search-data.json').data,
  ].map((i: unknown) => Item.parse(i));
  const dev = items.find((i) => i.id === '7244')!;

  it('keeps the software apprenticeship, drops IT technician, procurement and admin', () => {
    expect(items).toHaveLength(6);
    expect(items.filter(isRelevantItem).map((i) => i.title)).toEqual([
      'Apprentice Software Developer',
    ]);
  });

  it('maps level bands, refining Higher by the course name', () => {
    expect(walesLevel(1)).toBe(2);
    expect(walesLevel(2)).toBe(3);
    expect(walesLevel(4)).toBe(6);
    expect(walesLevel(3, 'Apprenticeship Level 5 – Software Developer')).toBe(5);
    expect(walesLevel(3, null)).toBe(4);
    expect(walesLevel(3)).toBeUndefined(); // no detail today: leave it to the stored level
  });

  it('maps search + detail to a RawListing', () => {
    const detail = WalesDetail.parse(json('wales/detail-apprentice-software-developer-7244.json'));
    const raw = walesListing(dev, detail);
    expect(raw).toMatchObject({
      source: 'wales',
      sourceId: '7244',
      url: 'https://careerswales.gov.wales/apprenticeship-search/results/apprentice-software-developer-7244',
      title: 'Apprentice Software Developer',
      employerName: 'Border Merchant Systems Ltd',
      level: 4,
      providerName: 'Catapwlt',
      standardTitle: 'Apprenticeship Level 4 – Software Developer',
      salaryText: 'Apprenticeship rates',
      closingDate: '2026-10-15',
      knownApprenticeship: true,
    });
    expect(raw.applyUrl).toBeUndefined(); // applies by email
    expect(raw.locations[0]).toMatchObject({
      text: 'Monmouth',
      postcode: 'NP25 5JA',
      nation: 'Wales',
      lat: expect.any(Number),
    });
    expect(raw.descriptionHtml).toContain('<h3>Qualifications needed</h3>');
    expect(raw.descriptionHtml!.match(/A real enthusiasm/g)).toHaveLength(1); // skills = desirable
    expect(JSON.stringify(raw)).not.toMatch(/@/);
    expect(normalise(raw)!.classification).toMatchObject({ roleType: 'software_tech', level: 4 });
  });

  it('builds a listing from the search card alone for known vacancies', () => {
    const raw = walesListing(dev);
    expect(raw).toMatchObject({ level: undefined, closingDate: '2026-10-15' });
    expect(raw.locations[0]).toMatchObject({ text: 'Monmouth', lat: 51.807350561053 });
  });
});

describe('Northern Ireland (JobApplyNI)', () => {
  const page = parseSearchPage(text('ni/search-apprenticeships.html'));

  it('parses result cards and the total', () => {
    expect(page.total).toBe(8);
    expect(page.pages).toBe(1);
    expect(page.cards).toHaveLength(8);
    expect(page.cards[0]).toEqual({
      id: '1790432',
      title: '2027 Project Planning & Controls Apprentice',
      employer: 'Thales UK',
      salary: '£24,000 per annum',
      area: 'Belfast',
      location: 'Belfast',
      hours: '37',
      closing: '13 Oct 2026',
    });
  });

  it('reads paging from the pagination bar', () => {
    const p2 = parseSearchPage(text('ni/search-engineering-page2.html'));
    expect(p2).toMatchObject({ total: 54, pages: 6 });
    expect(p2.cards).toHaveLength(10);
  });

  it('parses UK dates', () => {
    expect(niDate('13/11/2026')).toBe('2026-11-13');
    expect(niDate('5 Oct 2026')).toBe('2026-10-05');
    expect(niDate('soon')).toBeUndefined();
  });

  it('drops engineering, barista and butcher HLAs; keeps a data apprenticeship', () => {
    expect(page.cards.filter((c) => isRelevantCard(c, true))).toEqual([]);
    const data = { ...page.cards[0]!, title: 'Data Analyst (Higher Level Apprenticeship)' };
    expect(isRelevantCard(data, true)).toBe(true);
    // From the keyword search (sector unknown) the title must say apprentice.
    expect(isRelevantCard({ ...data, title: 'Data Analyst' }, false)).toBe(false);
    expect(isRelevantCard({ ...data, title: 'Data Analyst' }, true)).toBe(true);
  });

  it('maps a card + detail page to a RawListing', () => {
    const detail = parseDetailPage(text('ni/detail-1789967.html'));
    expect(detail.facts).toMatchObject({
      'Vacancy ID': '1789967',
      'Published date': '05/10/2026',
      'Closing date': '13/11/2026',
      'Contract Type': 'Permanent',
    });
    const card = page.cards.find((c) => c.id === '1789967')!;
    const raw = niListing(card, true, detail);
    expect(raw).toMatchObject({
      source: 'ni',
      sourceId: '1789967',
      url: 'https://www.jobapplyni.com/Vacancy/VacancyDetail?Id=1789967',
      title:
        '2027 Industrial Process Engineer Apprentice - Level 5 Mechatronics Higher Level Apprenticeship (NI)',
      employerName: 'Thales UK',
      salaryText: '£24,000 per annum',
      postedDate: '2026-10-05',
      closingDate: '2026-11-13',
      knownApprenticeship: true,
      locations: [{ text: 'Belfast', nation: 'Northern Ireland' }],
    });
    expect(raw.applyUrl).toMatch(/^https:\/\/thales\.wd3\.myworkdayjobs\.com\//);
    expect(raw.descriptionHtml).toContain('<h4>Responsibilities</h4>');
    expect(raw.descriptionHtml).not.toMatch(/&#xA;/);
    expect(raw.details).toMatchObject({ hoursPerWeek: 37, positions: 1, contract: 'Permanent' });
    expect(String(raw.details?.employerAddress)).toContain('BT6 9HB');
    // Classified like any other listing: an engineering HLA isn't relevant.
    expect(normalise(raw)).toBeNull();
  });
});

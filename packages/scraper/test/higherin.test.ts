import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseCategoryPage,
  parseJobPage,
  parseSitemap,
  slugLooksRelevant,
  toRawListing,
} from '../src/sources/higherin.ts';
import { normalise } from '../src/pipeline/normalise.ts';

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/higherin/${name}`, import.meta.url), 'utf8');

describe('Higherin', () => {
  const jobs = parseSitemap(fx('job-sitemap.xml'));
  const { items, next } = parseCategoryPage(fx('category-degree-data-analysis.html'));

  it('parses the job sitemap', () => {
    expect(jobs.map((j) => j.id)).toContain('45840');
    expect(jobs[0]).toMatchObject({ lastmod: '2026-10-08' });
  });

  it('parses category cards from the embedded search state', () => {
    expect(items.length).toBe(13);
    expect(next).toBeNull();
    const thales = items.find((i) => i.jobId === 45840)!;
    expect(thales).toMatchObject({
      companyName: 'Thales',
      jobTypeName: 'Degree Apprenticeship',
      deadline: '17th February 2027',
    });
    expect(items.some((i) => i.isPreReg)).toBe(true);
  });

  it('only fetches slugs that look like data/tech apprenticeships', () => {
    const relevant = jobs.filter((j) => slugLooksRelevant(j.url)).map((j) => j.id);
    expect(relevant).toEqual(expect.arrayContaining(['45840', '45846', '45750', '43044']));
    expect(relevant).not.toContain('45866'); // finance assistant
    expect(relevant).not.toContain('44497'); // "Degree Apprenticeships 2027": only via its data category card
  });

  it('maps a JSON-LD JobPosting to a listing', () => {
    const page = parseJobPage(fx('job-45840.html'));
    expect(page.posting?.title).toBe('Level 6 Data Science Degree Apprenticeship');
    const job = jobs.find((j) => j.id === '45840')!;
    const raw = toRawListing(
      job,
      page,
      items.find((i) => i.jobId === 45840),
      ['Data analysis'],
    );
    expect(raw).toMatchObject({
      source: 'higherin',
      sourceId: '45840',
      employerName: 'Thales',
      salaryMin: 24000,
      postedDate: '2026-10-05',
      closingDate: '2027-02-17',
      knownApprenticeship: true,
    });
    expect(raw.level).toBeUndefined(); // title says Level 6 itself
    expect(raw.locations[0]).toMatchObject({
      postcode: 'RH10 9HA',
      lines: ['Manor Royal', 'Crawley', 'West Sussex'],
    });
    const n = normalise(raw)!;
    expect(n.classification).toMatchObject({ roleType: 'data_science', level: 6, isDegree: true });
  });

  it('falls back to the h1 and og:title on register-your-interest pages', () => {
    const page = parseJobPage(fx('job-45750-prereg.html'));
    expect(page.posting).toBeNull();
    expect(page.company).toBe('Financial Conduct Authority (FCA)');
    const job = jobs.find((j) => j.id === '45750')!;
    const raw = toRawListing(job, page, undefined, []);
    expect(raw.title).toMatch(/^Register Your Interest - Level 6 AI\/Machine Learning/);
    expect(raw.details?.preRegister).toBe(true);
    expect(raw.closingDate).toBeUndefined();
    expect(normalise(raw)!.classification).toMatchObject({ roleType: 'ml_ai', level: 6 });
  });

  it('uses the category as a role hint for generic titles', () => {
    const card = items.find((i) => i.jobId === 44497)!; // Barclays "Degree Apprenticeships 2027"
    const raw = toRawListing({ id: '44497', url: card.url }, null, card, ['Data analysis']);
    expect(raw.level).toBe(6);
    expect(raw.locations.map((l) => l.text)).toContain('Glasgow');
    expect(normalise(raw)!.classification.roleType).toBe('data_analyst');
  });
});

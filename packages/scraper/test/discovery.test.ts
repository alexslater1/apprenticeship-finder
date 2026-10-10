import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normaliseEmployerName } from '@af/shared';
import { isAggregator } from '../src/discovery/config.ts';
import { attributeToEmployer, employerMatcher } from '../src/employers.ts';
import { freeId, suggestionsFromListings } from '../src/discovery/learn.ts';
import { normalise } from '../src/pipeline/normalise.ts';
import { agoToDate, toRawListing } from '../src/sources/google-jobs.ts';
import { hostLabel, mentionsDataApprenticeship } from '../src/sources/web-search.ts';

const serp = JSON.parse(
  readFileSync(new URL('./fixtures/connectors/serpapi-google-jobs.json', import.meta.url), 'utf8'),
) as { jobs_results: Array<Record<string, unknown>> };

describe('Google Jobs (SerpApi)', () => {
  it('turns "5 days ago" into a date', () => {
    expect(agoToDate(['5 days ago', 'Full–time'], '2026-10-10')).toBe('2026-10-05');
    expect(agoToDate(['21 hours ago'], '2026-10-10')).toBe('2026-10-10');
    expect(agoToDate(['Full–time'], '2026-10-10')).toBeUndefined();
  });
  it("prefers the employer's own apply link over the boards", () => {
    const l = toRawListing(serp.jobs_results[0] as never, '2026-10-10')!;
    expect(l.source).toBe('google_jobs');
    expect(l.employerName).toBe('Thales');
    expect(l.url).toContain('careers.thalesgroup.com');
    expect(l.applyUrl).toBe(l.url);
  });
  it('skips results from job boards posing as employers', () => {
    const fake = { ...serp.jobs_results[0], company_name: 'InternHunt' };
    expect(toRawListing(fake as never, '2026-10-10')).toBeNull();
  });
  it('knows the aggregators', () => {
    expect(isAggregator('https://uk.linkedin.com/jobs/view/1')).toBe(true);
    expect(isAggregator('https://uk.jobrapido.com/x')).toBe(true);
    expect(isAggregator('https://careers.thalesgroup.com/job/1')).toBe(false);
  });
});

describe('web search', () => {
  it('names a company from its careers host', () => {
    expect(hostLabel('https://careers.example.co.uk/early-careers')).toBe('Example');
    expect(hostLabel('https://acme.wd3.myworkdayjobs.com/External')).toBe('Acme');
  });
  it('spots pages about data apprenticeships', () => {
    expect(mentionsDataApprenticeship('Our Data Analyst Apprenticeship opens in January')).toBe(
      true,
    );
    expect(mentionsDataApprenticeship('Our plumbing apprenticeship')).toBe(false);
  });
});

describe('learning employers from listings', () => {
  const base = {
    source: 'faa',
    sourceId: '1',
    url: 'https://www.findapprenticeship.service.gov.uk/apprenticeship/1',
    title: 'Data Analyst Apprentice',
    employerName: 'Acme Analytics Ltd',
    level: 4,
    larsCode: 80,
    locations: [{ text: 'Leeds', city: 'Leeds', nation: 'England' as const }],
  };
  it('suggests unwatched employers of strong listings, with ATS detection', () => {
    const l = normalise({
      ...base,
      applyUrl: 'https://acme.wd3.myworkdayjobs.com/External/job/x_R-1',
    })!;
    const [s] = suggestionsFromListings([l], '2026-10-10');
    expect(s).toMatchObject({ name: 'Acme Analytics Ltd', origin: 'listing' });
    expect(s!.detected?.connector).toBe('workday');
  });
  it('never auto-watches companies found on web pages (their names are guesses)', () => {
    const l = normalise({
      ...base,
      source: 'web_search',
      url: 'https://acme.wd3.myworkdayjobs.com/External/job/x_R-1',
      applyUrl: undefined,
    })!;
    const [s] = suggestionsFromListings([l], '2026-10-10');
    expect(s!.detected).toBeNull();
    expect(s!.board?.connector).toBe('workday');
  });
  it('ignores watched employers, providers and weak listings', () => {
    const watched = { ...normalise(base)!, employerId: 'acme' };
    const provider = normalise({ ...base, employerName: 'QA Limited' })!;
    const weak = normalise({
      ...base,
      title: 'Apprentice',
      larsCode: undefined,
      level: undefined,
      roleHint: 'Data',
    });
    expect(
      suggestionsFromListings([watched, provider, ...(weak ? [weak] : [])], '2026-10-10'),
    ).toEqual([]);
  });
  it("re-attributes an agency's advert to the watched employer named in its title", () => {
    const match = employerMatcher([{ id: 'pfizer', name: 'Pfizer', aliases: [] }]);
    const l = normalise({
      ...base,
      employerName: 'NonStop Consulting Ltd',
      title: 'Data Scientist Degree Apprentice - Pfizer',
    })!;
    attributeToEmployer(l, match, () => 'Pfizer');
    expect(l).toMatchObject({
      employerId: 'pfizer',
      employerName: 'Pfizer',
      providerName: 'NonStop Consulting Ltd',
      title: 'Data Scientist Degree Apprentice',
    });
    expect(normaliseEmployerName('3631 Airbus Operations Limited')).toBe('airbus operations');
  });
  it('picks a free employer id', () => {
    expect(freeId('Acme Analytics Ltd', new Set(['acme-analytics']))).toBe('acme-analytics-2');
  });
});

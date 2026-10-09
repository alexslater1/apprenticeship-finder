import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRelevantVacancy, toRawListing, Vacancy } from '../src/sources/faa.ts';
import { faaLevel } from '../src/sources/faa.ts';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/faa/${name}`, import.meta.url), 'utf8'));

const page = fixture('list.json') as { vacancies: unknown[] };
const vacancies = page.vacancies.map((v) => Vacancy.parse(v));
const byTitle = (re: RegExp) => vacancies.find((v) => re.test(v.title))!;

describe('FAA source', () => {
  it('parses every fixture vacancy', () => {
    expect(vacancies.length).toBe(page.vacancies.length);
  });

  it('keeps data roles and drops the rest', () => {
    const kept = vacancies.filter(isRelevantVacancy).map((v) => v.title);
    expect(kept).toContain('2027 Data Science Apprentice - Crawley');
    // Level 3 (here a weak "data" title and Howden's data role filed under Insurance): out of scope.
    expect(kept).not.toContain('Data Team Apprentice');
    expect(kept).not.toContain('Data Analyst Apprenticeship Programme');
    expect(kept.some((t) => /Autocare|Sandwich|Childcare|Assessor/.test(t))).toBe(false);
  });

  it('drops foundation apprenticeships', () => {
    const f = vacancies.find((v) => v.course?.type === 'Foundation');
    expect(f && isRelevantVacancy(f)).toBe(false);
  });

  it('maps a detailed vacancy to a RawListing', () => {
    const list = byTitle(/Data Science Apprentice - Crawley/);
    const detail = Vacancy.parse(fixture('detail-2000057249.json'));
    const raw = toRawListing({ ...list, ...detail });
    expect(raw).toMatchObject({
      source: 'faa',
      sourceId: '2000057249',
      level: 6,
      larsCode: 337,
      standardTitle: 'Data scientist (integrated degree)',
      employerName: 'Thales UK Limited',
      closingDate: '2027-02-17',
      knownApprenticeship: true,
    });
    expect(raw.applyUrl).toMatch(/myworkdayjobs\.com/);
    expect(raw.url).toMatch(/findapprenticeship\.service\.gov\.uk/);
    expect(raw.descriptionHtml).toContain('<h3>Training</h3>');
    expect(raw.locations[0]).toMatchObject({
      postcode: expect.any(String),
      lat: expect.any(Number),
    });
    expect(raw.details?.qualifications).toBeTruthy();
    expect(JSON.stringify(raw.raw)).not.toMatch(/employerContact/i);
  });

  it('labels NHS Jobs extras and takes their level from the title', () => {
    const nhs = vacancies.find((v) => /^C\d/.test(v.vacancyReference))!;
    const raw = toRawListing(nhs);
    expect(raw.details?.origin).toBe('NHS Jobs');
    expect(raw.larsCode).toBeUndefined();
    expect(faaLevel(nhs)).toBeUndefined();
  });

  it('display-cases SHOUTY employer names', () => {
    expect(toRawListing(byTitle(/^Data Team Apprentice$/)).employerName).toBe('First Rung Limited');
  });
});

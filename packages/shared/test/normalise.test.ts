import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  decodeEntities,
  displayCase,
  haversineMiles,
  nearestMiles,
  normaliseEmployerName,
  normalisePostcode,
  normaliseTitle,
  parseDate,
  parseSalary,
} from '../src/index.ts';
import { findPlace, nearestPlace, placeByName } from '../src/places.ts';

describe('parseSalary (real FAA wage strings)', () => {
  it.each([
    ['£20,400 a year', 20400, null],
    ['£16,257.80 a year', 16258, null],
    ['19514.00 - 19514.00', 19514, null],
    ['£32073.00 to £39043.00', 32073, 39043],
    ['£25272.00', 25272, null],
    ['£24k - £28k', 24000, 28000],
    ['£450 a week', 23400, null],
    ['Competitive salary', null, null],
    ['', null, null],
  ])('%s', (text, min, max) => {
    expect(parseSalary(text)).toEqual({ min, max });
  });
});

describe('parseDate', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  it.each([
    ['2026-11-19T23:59:59Z', '2026-11-19'],
    ['2026-10-02T00:00:00Z', '2026-10-02'],
    ['2026-10-09', '2026-10-09'],
    ['Fri Oct 09 02:01:00 UTC 2026', '2026-10-09'],
    ['10/9/2026', '2026-10-09'],
    ['Posted 2 Days Ago', '2026-10-07'],
    ['Posted Today', '2026-10-09'],
    ['Posted 30+ Days Ago', '2026-09-09'],
    ['9th October 2026', '2026-10-09'],
    ['Thu, 08 Oct 2026 10:00:00 GMT', '2026-10-08'],
  ])('%s → %s', (input, out) => {
    expect(parseDate(input, now)).toBe(out);
  });
  it('London midnight: 23:30Z in BST is the next day', () => {
    expect(parseDate('2026-07-01T23:30:00Z')).toBe('2026-07-02');
  });
  it('daysBetween', () => expect(daysBetween('2026-10-09', '2026-10-16')).toBe(7));
});

describe('names and titles', () => {
  it.each([
    ['FIRST RUNG LIMITED ', 'first rung'],
    ['BAE Systems PLC', 'bae systems'],
    ['Lloyds Banking Group', 'lloyds banking'],
    ['Thales UK Limited', 'thales'],
    ['Marks &amp; Spencer', 'marks and spencer'],
  ])('employer %s → %s', (a, b) => expect(normaliseEmployerName(a)).toBe(b));

  it.each([
    ['2027 Data Science Apprentice - Crawley', 'data science apprentice crawley'],
    ['Data Analyst Apprenticeship Programme', 'data analyst'],
    ['Apprentice Data Technician', 'data technician'],
    ['Level 6 Data Scientist Degree Apprenticeship', 'data scientist degree'],
  ])('title %s → %s', (a, b) => expect(normaliseTitle(a)).toBe(b));

  it('display case for SHOUTY names only', () => {
    expect(displayCase('FIRST RUNG LIMITED')).toBe('First Rung Limited');
    expect(displayCase('BAE Systems')).toBe('BAE Systems');
    expect(displayCase('UNIVERSITY OF NOTTINGHAM')).toBe('University of Nottingham');
    expect(displayCase('THE OPEN UNIVERSITY')).toBe('The Open University');
  });
  it('decodes entities', () =>
    expect(decodeEntities('A &amp; B &#163;5 &pound;6')).toBe('A & B £5 £6'));
});

describe('geo', () => {
  it('haversine Leeds → London ≈ 170 miles', () => {
    expect(haversineMiles(53.7997, -1.5492, 51.5072, -0.1276)).toBeCloseTo(169.5, 0);
  });
  it('nearestMiles ignores ungeocoded locations', () => {
    expect(nearestMiles({ lat: 53.8, lon: -1.55 }, [{}, { lat: 53.8, lon: -1.55 }])).toBe(0);
    expect(nearestMiles(null, [{ lat: 1, lon: 1 }])).toBeNull();
  });
  it('postcodes', () => {
    expect(normalisePostcode(' ls14bn ')).toBe('LS1 4BN');
    expect(normalisePostcode('not a postcode')).toBeNull();
  });
});

describe('gazetteer', () => {
  it.each([
    ['London, Barclays Campus', 'London'],
    ['Glasgow (Hybrid)', 'Glasgow'],
    ['Newcastle', 'Newcastle upon Tyne'],
    ['Hull', 'Kingston upon Hull'],
    ['Derry', 'Londonderry'],
    ['Crawley / Templecombe', 'Crawley'],
    ['Remote', 'Remote'],
    ['Various locations', 'Nationwide'],
    ['Offices in Leeds and Manchester', 'Leeds'],
  ])('%s → %s', (text, name) => expect(findPlace(text)?.name).toBe(name));

  it('areas have no coordinates but do have a nation', () => {
    const kent = placeByName('Kent');
    expect(kent?.lat).toBeNull();
    expect(kent?.region).toBe('South East');
  });

  it('nearest place to Templecombe coords', () => {
    expect(nearestPlace(51.0, -2.42, 5)?.name).toBe('Templecombe');
    expect(nearestPlace(0, 0)).toBeUndefined();
  });
});

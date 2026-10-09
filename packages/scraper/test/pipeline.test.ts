import type { Location, RawListing } from '@af/shared';
import { describe, expect, it } from 'vitest';
import { cityFor, enrichLocation, type PostcodeCache } from '../src/pipeline/geocode.ts';
import { dedupeKey, mergeWithinRun, normalise, sanitize } from '../src/pipeline/normalise.ts';
import { toRow } from '../src/pipeline/persist.ts';
import { detectBotWall } from '../src/http.ts';

const base: RawListing = {
  source: 'faa',
  sourceId: '1',
  url: 'https://example.com/1',
  title: 'Data Analyst Apprentice',
  employerName: 'Acme Ltd',
  locations: [
    { text: 'Leeds', city: 'Leeds', region: 'Yorkshire and the Humber', nation: 'England' },
  ],
  knownApprenticeship: true,
};

describe('sanitize', () => {
  it('strips scripts, styles, event handlers and javascript: links', () => {
    const out = sanitize(
      '<p onclick="x()">Hi<script>alert(1)</script></p><style>p{}</style><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)>',
    );
    expect(out).not.toMatch(/script|style|onclick|onerror|javascript|<img/i);
    expect(out).toContain('<p>Hi</p>');
  });
  it('forces links to open safely in a new tab', () => {
    expect(sanitize('<a href="https://x.test">x</a>')).toContain(
      'rel="noopener noreferrer nofollow"',
    );
  });
});

describe('normalise', () => {
  it('drops non-relevant listings', () => {
    expect(normalise({ ...base, title: 'Apprentice Chef' })).toBeNull();
    expect(normalise({ ...base, title: 'Data Apprenticeship Coach' })).toBeNull();
  });
  it('parses salary text and keeps the primary city', () => {
    const n = normalise({ ...base, salaryText: '£20,400 a year' })!;
    expect(n.salaryMin).toBe(20400);
    expect(n.primaryCity).toBe('Leeds');
    expect(n.nation).toBe('England');
  });
  it('national vacancies are UK-wide', () => {
    expect(normalise({ ...base, locations: [], isNational: true })!.nation).toBe('UK-wide');
  });
});

describe('dedupe', () => {
  it('ignores year, level and scheme words; keeps cities apart', () => {
    const a = dedupeKey('barclays', '2027 Data Analyst Apprenticeship Programme', 'Glasgow');
    expect(dedupeKey('barclays', 'Data Analyst Level 4 Apprenticeship', 'Glasgow')).toBe(a);
    expect(dedupeKey('barclays', 'Data Analyst Apprenticeship', 'Northampton')).not.toBe(a);
  });
  it('merges duplicates within a run and keeps every source link', () => {
    const one = normalise(base)!;
    const two = normalise({
      ...base,
      source: 'higherin',
      sourceId: 'h1',
      descriptionText: 'A much longer description of the role',
    })!;
    const merged = mergeWithinRun([one, two]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sources.map((s) => s.source)).toEqual(['faa', 'higherin']);
    expect(merged[0]!.descriptionText).toContain('much longer');
  });
});

describe('geocode', () => {
  const cache: PostcodeCache = {
    'GU30 7LQ': {
      lat: 51.07,
      lon: -0.78,
      district: 'East Hampshire',
      region: 'South East',
      country: 'England',
    },
    'EN3 4DZ': {
      lat: 51.64,
      lon: -0.05,
      district: 'Enfield',
      region: 'London',
      country: 'England',
    },
    'CH5 2NS': { lat: 53.17, lon: -2.98, district: 'Flintshire', region: null, country: 'Wales' },
  };
  it('uses the post town, not the county, from FAA address lines', () => {
    const loc: Location = {
      text: '',
      postcode: 'GU30 7LQ',
      lines: ['Highfield Lane', 'Liphook', 'Hampshire'],
    };
    enrichLocation(loc, cache);
    expect(loc).toMatchObject({ city: 'Liphook', region: 'South East', nation: 'England' });
  });
  it('London boroughs and districts become London', () => {
    const loc: Location = {
      text: '',
      postcode: 'EN3 4DZ',
      lines: ['197 High Street', 'Ponders End', 'Enfield'],
    };
    enrichLocation(loc, cache);
    expect(loc.city).toBe('London');
  });
  it('takes nation from the postcode', () => {
    const loc: Location = { text: '', postcode: 'ch52ns', nation: 'England', lines: ['Broughton'] };
    enrichLocation(loc, cache);
    expect(loc).toMatchObject({
      postcode: 'CH5 2NS',
      nation: 'Wales',
      region: 'Wales',
      city: 'Broughton',
    });
  });
  it('free-text locations go through the gazetteer', () => {
    const loc: Location = { text: 'Glasgow (Hybrid)' };
    enrichLocation(loc, cache);
    expect(loc).toMatchObject({ city: 'Glasgow', nation: 'Scotland' });
  });
  it('falls back to the nearest town', () => {
    expect(
      cityFor({ text: '', lat: 51.0, lon: -2.42, lines: ['Unit 4 Business Park'] }, null),
    ).toBe('Templecombe');
  });
});

describe('persist merge rules', () => {
  const n = normalise({
    ...base,
    postedDate: '2026-10-01',
    closingDate: '2026-11-01',
    descriptionText: 'short',
  })!;
  it('keeps the longer stored description and the earliest posted date', () => {
    const row = toRow(
      n,
      {
        id: 'x',
        dedupe_key: n.dedupeKey,
        first_seen_at: '2026-09-01T10:00:00Z',
        description_html: '<p>long stored description</p>',
        description_text: 'long stored description',
        posted_date: '2026-09-20',
        closing_date: null,
      },
      '2026-10-09',
      '2026-10-09T06:30:00Z',
    );
    expect(row.description_text).toBe('long stored description');
    expect(row.posted_date).toBe('2026-09-20');
    expect(row.closing_date).toBe('2026-11-01');
    expect(row.is_active).toBe(true);
  });
  it('a closing date in the past scores zero', () => {
    const row = toRow(
      { ...n, closingDate: '2026-10-01' },
      undefined,
      '2026-10-09',
      '2026-10-09T06:30:00Z',
    );
    expect(row.score).toBe(0);
  });
});

describe('bot-wall detection', () => {
  it('spots common challenge pages', () => {
    expect(detectBotWall('<title>Just a moment...</title>', new Headers())).not.toBeNull();
    expect(detectBotWall('<h1>Quick check needed</h1>', new Headers())).not.toBeNull();
    expect(detectBotWall('ok', new Headers({ 'cf-mitigated': 'challenge' }))).not.toBeNull();
    expect(detectBotWall('<h1>Jobs</h1>', new Headers())).toBeNull();
  });
});

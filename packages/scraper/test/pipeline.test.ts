import type { Location, RawListing } from '@af/shared';
import { describe, expect, it } from 'vitest';
import { cityFor, enrichLocation, type PostcodeCache } from '../src/pipeline/geocode.ts';
import {
  assignKeys,
  dedupeKey,
  sameEmployer,
  samePlace,
  similarTitles,
  titleTokens,
} from '../src/pipeline/dedupe.ts';
import {
  mergeWithinRun,
  normalise,
  plausibleDeadline,
  sanitize,
  splitProviderTitle,
} from '../src/pipeline/normalise.ts';
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

describe('cross-source matching', () => {
  const t = (title: string, city = 'Crawley') => titleTokens(title, [city]);
  it.each([
    ['2027 Data Science Apprentice - Crawley', 'Level 6 Data Science Degree Apprenticeship'],
    [
      '2027 AI Engineer Apprentice - Level 6 - Crawley',
      'AI Engineer Degree Apprenticeship (Level 6, Machine Learning)',
    ],
    [
      '2027 Machine Learning Apprentice - Level 6 AI Engineer',
      'Machine Learning (Level 6 AI Engineer) Degree Apprenticeship',
    ],
    ['Data Scientist Degree Apprenticeship', 'Data Science Apprentice'],
    [
      'Digital & Technology Solutions Degree Apprenticeship 2027',
      'Digital and Technology Solutions Apprentice',
    ],
  ])('%s ≈ %s', (a, b) => expect(similarTitles(t(a), t(b))).toBe(true));

  it.each([
    [
      '2027 AI Engineer Apprentice - Level 6 - Crawley',
      '2027 AI Researcher Apprentice - Level 6 - Crawley',
    ],
    [
      '2027 Software Engineering Apprentice - Crawley',
      '2027 Systems Engineering Apprentice - Crawley',
    ],
    ['Data Analyst Apprentice', 'Data Engineer Apprentice'],
    ['Degree Apprenticeships 2027', 'Degree Apprenticeship Programme'],
  ])('%s ≠ %s', (a, b) => expect(similarTitles(t(a), t(b))).toBe(false));

  it('ignores a trailing place or client tag in titles', () => {
    expect(
      similarTitles(
        titleTokens('2027 Software Engineering Apprentice - Cheadle', ['Stockport']),
        titleTokens(
          'Software Engineering Degree Apprentice - Level 6 Digital and Technology Solutions',
          ['Manchester'],
        ),
      ),
    ).toBe(true);
  });

  it('only "artificial intelligence" means AI', () => {
    expect(
      similarTitles(t('Business Intelligence Analyst Apprentice'), t('AI Analyst Apprentice')),
    ).toBe(false);
    expect(
      similarTitles(t('Artificial Intelligence Engineer Apprentice'), t('AI Engineer Apprentice')),
    ).toBe(true);
  });

  it('nearby towns count as the same place', () => {
    expect(samePlace(['Stockport'], ['Manchester'])).toBe(true);
    expect(samePlace(['Crawley'], ['Templecombe'])).toBe(false);
    expect(samePlace([], ['Leeds'])).toBe(true);
  });

  it('employer names match on a word prefix', () => {
    expect(sameEmployer('airbus', 'airbus operations')).toBe(true);
    expect(sameEmployer('bae systems', 'bae')).toBe(true);
    expect(sameEmployer('thales', 'thames water')).toBe(false);
  });

  it('a Higherin listing adopts the stored FAA listing it duplicates', () => {
    const existing = [
      {
        dedupeKey: 'faa-ds',
        employerNorm: 'thales',
        title: '2027 Data Science Apprentice - Crawley',
        cities: ['Crawley'],
      },
      {
        dedupeKey: 'faa-ai',
        employerNorm: 'thales',
        title: '2027 AI Engineer Apprentice - Level 6 - Crawley',
        cities: ['Crawley'],
      },
    ];
    const keys = assignKeys(
      [
        {
          dedupeKey: 'hi-ds',
          employerNorm: 'thales',
          title: 'Level 6 Data Science Degree Apprenticeship',
          cities: ['Crawley'],
        },
        {
          dedupeKey: 'hi-glasgow',
          employerNorm: 'thales',
          title: 'AI and Data Science Degree Apprenticeship',
          cities: ['Glasgow'],
        },
        {
          dedupeKey: 'adz-ds',
          employerNorm: 'thales',
          title: 'Data Science Apprentice',
          cities: ['Crawley'],
        },
      ],
      existing,
    );
    expect(keys).toEqual(['faa-ds', 'hi-glasgow', 'faa-ds']);
  });

  it('same-run duplicates collapse onto the first one seen', () => {
    const keys = assignKeys(
      [
        {
          dedupeKey: 'a',
          employerNorm: 'fca',
          title: 'AI/Machine Learning Degree Apprenticeship',
          cities: ['London'],
        },
        {
          dedupeKey: 'b',
          employerNorm: 'fca',
          title: 'Level 6 AI Machine Learning Apprentice 2027',
          cities: ['London'],
        },
      ],
      [],
    );
    expect(keys).toEqual(['a', 'a']);
  });
});

describe('provider-posted adverts', () => {
  it.each([
    [
      'Data Analyst Higher Apprenticeship - Grosvenor',
      'QA Limited',
      'Data Analyst Higher Apprenticeship',
      'Grosvenor',
    ],
    [
      'AI Developer & Automation Apprentice - Rawlinson & Hunter LLP',
      'QA Limited',
      'AI Developer & Automation Apprentice',
      'Rawlinson & Hunter LLP',
    ],
    [
      'Junior Data Analyst Level 3 Apprenticeship - Terberg DTS',
      'QA Limited',
      'Junior Data Analyst Level 3 Apprenticeship',
      'Terberg DTS',
    ],
  ])('%s', (title, employer, role, client) => {
    expect(splitProviderTitle(title, employer)).toEqual({
      title: role,
      employer: client,
      provider: employer,
    });
  });
  it('leaves places, levels and real employers alone', () => {
    expect(splitProviderTitle('Data Analyst Apprentice - Leeds', 'QA Limited')).toBeNull();
    expect(splitProviderTitle('IT Technician - Level 3 Apprenticeship', 'QA')).toBeNull();
    expect(splitProviderTitle('Data Analyst Apprentice - Grosvenor', 'Thales')).toBeNull();
    expect(
      splitProviderTitle('IT Level 3 Apprenticeship 2026 - CSL Data Services', 'QA Limited'),
    ).toBeNull();
  });
  it("the advert then matches the employer's own FAA listing", () => {
    const n = normalise({
      ...base,
      source: 'higherin',
      title: 'AI Developer & Automation Apprentice - Rawlinson & Hunter LLP',
      employerName: 'QA Limited',
    })!;
    expect(n).toMatchObject({ employerName: 'Rawlinson & Hunter LLP', providerName: 'QA Limited' });
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
  it('canonicalises region names', () => {
    const loc: Location = { text: '', postcode: 'LS1 4BN', lines: ['Leeds'] };
    enrichLocation(loc, {
      'LS1 4BN': {
        lat: 53.8,
        lon: -1.55,
        district: 'Leeds',
        region: 'Yorkshire and The Humber',
        country: 'England',
      },
    });
    expect(loc.region).toBe('Yorkshire and the Humber');
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
  it('another source never blanks out stored facts', () => {
    const higherin = normalise({
      ...base,
      source: 'higherin',
      applyUrl: undefined,
      locations: [],
      salaryText: undefined,
    })!;
    const row = toRow(
      higherin,
      {
        id: 'x',
        dedupe_key: higherin.dedupeKey,
        first_seen_at: '2026-10-01T10:00:00Z',
        description_html: null,
        description_text: null,
        posted_date: null,
        closing_date: null,
        apply_url: 'https://thales.wd3.myworkdayjobs.com/x',
        salary_min: 24000,
        salary_max: null,
        locations: [
          { text: 'Crawley, RH10 9HA', city: 'Crawley', region: 'South East', nation: 'England' },
        ],
        primary_city: 'Crawley',
        region: 'South East',
        nation: 'England',
        lars_code: 337,
      },
      '2026-10-09',
      '2026-10-09T06:30:00Z',
    );
    expect(row).toMatchObject({
      apply_url: 'https://thales.wd3.myworkdayjobs.com/x',
      salary_min: 24000,
      primary_city: 'Crawley',
      lars_code: 337,
    });
  });
  it('far-future placeholder deadlines are treated as none', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    expect(plausibleDeadline('2036-01-01', now)).toBeNull();
    expect(plausibleDeadline('2027-02-17', now)).toBe('2027-02-17');
  });
  it('drops a placeholder deadline stored before the fix', () => {
    const row = toRow(
      { ...n, closingDate: null },
      {
        id: 'x',
        dedupe_key: n.dedupeKey,
        first_seen_at: '2026-10-09T06:00:00Z',
        description_html: null,
        description_text: null,
        posted_date: null,
        closing_date: '2036-01-01',
      },
      '2026-10-09',
      '2026-10-09T06:30:00Z',
    );
    expect(row.closing_date).toBeNull();
  });
  it('a listing past its deadline stays closed even if still advertised', () => {
    const row = toRow(
      { ...n, closingDate: '2026-10-01' },
      undefined,
      '2026-10-09',
      '2026-10-09T06:30:00Z',
    );
    expect(row).toMatchObject({ is_active: false, closed_reason: 'closing_date_passed' });
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

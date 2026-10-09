import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, type Filters } from '@/store/filters';
import { listing, settings } from '@/test/fixtures';
import { derive, matches, sortDerived } from './derive';

const today = '2026-10-09';
const f = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });

const rows = [
  listing({ id: 'crawley' }),
  listing({
    id: 'leeds',
    title: 'Data Analyst Apprentice',
    employer_name: 'Rh Brand Ambition',
    level: 4,
    is_degree: false,
    role_type: 'data_analyst',
    score: 70,
    salary_min: 28000,
    closing_date: '2026-10-15',
    locations: [
      {
        text: 'Leeds',
        city: 'Leeds',
        region: 'Yorkshire and the Humber',
        nation: 'England',
        lat: 53.8,
        lon: -1.55,
      },
    ],
    primary_city: 'Leeds',
    region: 'Yorkshire and the Humber',
    first_seen_at: '2026-10-08T06:30:00Z',
  }),
  listing({
    id: 'l3',
    title: 'Data Technician Apprentice',
    level: 3,
    is_degree: false,
    role_type: 'data_analyst',
    score: 60,
  }),
  listing({ id: 'software', title: 'Software Developer Apprentice', role_type: 'software_tech' }),
  listing({ id: 'hidden', hidden: true }),
  listing({ id: 'closed', is_active: false }),
  listing({ id: 'nowhere', locations: [], primary_city: null, region: null, nation: 'Unknown' }),
];
const derived = derive(rows, settings, today);
const ids = (filters: Filters) =>
  derived.filter((d) => matches(d, filters, today)).map((d) => d.row.id);

describe('derive', () => {
  it('applies the Settings preferences, distance and closing days', () => {
    const leeds = derived.find((d) => d.row.id === 'leeds')!;
    expect(leeds.distance).toBeLessThan(1);
    // Data analyst High (45 instead of 38), level 4 Maybe (12 instead of 18), within 50 miles.
    expect(leeds.score).toBe(70 - 38 - 18 + 45 + 12 + 8);
    expect(leeds.daysToClose).toBe(6);
    expect(leeds.isNew).toBe(true);
  });
});

describe('matches', () => {
  it('hides hidden and closed listings by default', () => {
    expect(ids(f())).toEqual(['crawley', 'leeds', 'nowhere']);
    expect(ids(f({ includeHidden: true }))).toContain('hidden');
    expect(ids(f({ includeClosed: true }))).toContain('closed');
  });
  it("never shows levels 2–3 or roles and levels set to 'No'", () => {
    const all = f({ includeHidden: true, includeClosed: true });
    expect(ids(all)).not.toContain('l3');
    expect(ids(all)).not.toContain('software');
    expect(derived.find((d) => d.row.id === 'software')!.excluded).toBe('role');
    expect(ids(f({ levels: [3] }))).toEqual([]);
  });
  it('filters by distance and keeps unknown locations unless asked', () => {
    expect(ids(f({ maxDistance: 25 }))).toEqual(['leeds', 'nowhere']);
    expect(ids(f({ maxDistance: 25, onlyKnownLocation: true }))).toEqual(['leeds']);
  });
  it('search matches every word across title, employer and place', () => {
    expect(ids(f({ search: 'thales crawley' }))).toEqual(['crawley', 'nowhere']);
    expect(ids(f({ search: 'analyst leeds' }))).toEqual(['leeds']);
  });
  it('role, region, salary, closing and degree filters', () => {
    expect(ids(f({ roles: ['data_analyst'] }))).toEqual(['leeds']);
    expect(ids(f({ region: 'South East' }))).toEqual(['crawley']);
    expect(ids(f({ salaryMin: 25000 }))).toEqual(['leeds']);
    expect(ids(f({ closingWithinDays: 7 }))).toEqual(['leeds']);
    expect(ids(f({ degreeOnly: true }))).toEqual(['crawley', 'nowhere']);
  });
});

describe('sortDerived', () => {
  it('ranks by uncapped score so boosted listings keep their order', () => {
    const near = { locations: rows[1]!.locations };
    const top = derive(
      [
        listing({ id: 'a', score: 97, ...near }),
        listing({ id: 'b', title: 'AAA', score: 95, ...near }),
      ],
      settings,
      today,
    );
    expect(top.map((d) => d.score)).toEqual([100, 100]);
    expect(sortDerived(top, 'score').map((d) => d.row.id)).toEqual(['a', 'b']);
  });
  const visible = derived.filter((d) => matches(d, f(), today));
  it('sorts by closing date, salary and distance with unknowns last', () => {
    expect(sortDerived(visible, 'closing').map((d) => d.row.id)[0]).toBe('leeds');
    expect(sortDerived(visible, 'salary').map((d) => d.row.id)[0]).toBe('leeds');
    expect(sortDerived(visible, 'distance').map((d) => d.row.id)).toEqual([
      'leeds',
      'crawley',
      'nowhere',
    ]);
  });
});

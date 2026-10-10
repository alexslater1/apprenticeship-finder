import { describe, expect, it } from 'vitest';
import { sameAdvert } from '../src/pipeline/siblings.ts';

const row = (title: string, city: string | null, employer = 'howden') => ({
  id: title,
  title,
  employer_name_norm: employer,
  primary_city: city,
  locations: city ? [{ city }] : [],
});

describe('sameAdvert', () => {
  const faa = row('Data Analyst Apprenticeship Programme', 'Cheltenham');
  it('matches a copy that adds the year and the city to the title', () => {
    expect(
      sameAdvert(row('Data Analyst Apprenticeship Programme 2027 - Cheltenham', null), faa),
    ).toBe(true);
  });
  it('needs the same place', () => {
    expect(sameAdvert(row('Data Analyst Apprenticeship Programme', 'Glasgow'), faa)).toBe(false);
    // No place on one side and no city in its title: could be another office's advert.
    expect(sameAdvert(row('Data Analyst Apprenticeship Programme', null), faa)).toBe(false);
  });
  it('needs the same employer and title', () => {
    expect(
      sameAdvert(row('Data Analyst Apprenticeship Programme - Cheltenham', null, 'other'), faa),
    ).toBe(false);
    expect(sameAdvert(row('Software Engineer Apprentice - Cheltenham', null), faa)).toBe(false);
  });
});

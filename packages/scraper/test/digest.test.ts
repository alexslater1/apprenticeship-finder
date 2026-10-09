import { describe, expect, it } from 'vitest';
import { isEmpty, renderDigest, type DigestData, type DigestItem } from '../src/notify/digest.ts';

const item = (over: Partial<DigestItem> = {}): DigestItem => ({
  id: 'a',
  title: 'Level 6 Data Science Degree Apprenticeship',
  employer: 'Thales',
  place: 'Crawley',
  level: 'L6 degree',
  university: 'University of Exeter',
  salary: '£24,000',
  closing: '2027-02-17',
  daysToClose: 131,
  score: 92,
  status: 'none',
  preRegister: false,
  adzunaOnly: false,
  dashboardUrl: 'https://example.test/#/listing/a',
  applyUrl: 'https://higherin.com/jobs/45840',
  ...over,
});

const base: DigestData = {
  today: '2026-10-10',
  since: '2026-10-09T07:00:00Z',
  minScore: 40,
  newMatches: [],
  newBelowThreshold: 0,
  closingSoon: [],
  openedEmployers: [],
  health: [],
  dashboardUrl: 'https://example.test/',
};

describe('digest rendering', () => {
  it('is empty with nothing to say', () => {
    expect(isEmpty(base)).toBe(true);
  });

  it('groups new matches by tier and puts closing-soon first', () => {
    const mail = renderDigest({
      ...base,
      newMatches: [item(), item({ id: 'b', title: 'Data Technician Apprentice', score: 50 })],
      closingSoon: [
        item({
          id: 'c',
          title: 'AI Solutions Apprentice',
          status: 'saved',
          closing: '2026-10-15',
          daysToClose: 5,
        }),
      ],
      newBelowThreshold: 3,
    });
    expect(mail.subject).toBe('Apprenticeships: 2 new matches, 1 closing soon');
    expect(mail.html.indexOf('Closing within a week')).toBeLessThan(
      mail.html.indexOf('Strong matches'),
    );
    expect(mail.html).toContain('Strong matches (1 new)');
    expect(mail.html).toContain('Good matches (1 new)');
    expect(mail.html).toContain('closes 15 Oct (in 5 days)');
    expect(mail.html).toContain('https://example.test/#/listing/a');
    expect(mail.text).toContain('3 other new listings scored below 40');
  });

  it('escapes scraped text', () => {
    const mail = renderDigest({
      ...base,
      newMatches: [item({ title: '<script>alert(1)</script> & co' })],
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('credits Adzuna on Adzuna-only ads', () => {
    const mail = renderDigest({ ...base, newMatches: [item({ adzunaOnly: true })] });
    expect(mail.html).toContain('Jobs by Adzuna');
  });

  it('a health-only email says so in the subject', () => {
    const mail = renderDigest({ ...base, health: ['higherin: HTTP 503'] });
    expect(mail.subject).toBe('Apprenticeship Finder: scrape problems');
    expect(mail.text).toContain('higherin: HTTP 503');
  });

  it('caps each tier and links to the rest', () => {
    const many = Array.from({ length: 20 }, (_, i) => item({ id: String(i) }));
    const mail = renderDigest({ ...base, newMatches: many });
    expect(mail.text).toContain('…and 5 more on the dashboard.');
  });
});

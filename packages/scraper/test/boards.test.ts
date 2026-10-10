import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/http.ts';
import { normalise } from '../src/pipeline/normalise.ts';
import { toRawListing as adzunaListing } from '../src/sources/adzuna.ts';
import { reedDate, toRawListing as reedListing } from '../src/sources/reed.ts';

const fx = (p: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8'));

describe('Adzuna', () => {
  const results = fx('adzuna/search.json').results;
  const listings = results.map(adzunaListing);

  it('keeps apprenticeships, drops IQA and intern noise', () => {
    const kept = listings
      .map(normalise)
      .filter(Boolean)
      .map((n: { title: string }) => n.title);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.some((t: string) => /IQA|Intern\b/.test(t))).toBe(false);
    // Posted by a training provider (Back 2 Work) with no employer named: nowhere official to apply.
    expect(kept).not.toContain('Data Technician Apprentice');
  });

  it('ignores predicted salaries', () => {
    const thales = listings.find((l: { employerName: string }) => l.employerName === 'Thales');
    expect(thales.salaryMin).toBeUndefined();
    const real = listings.find((l: { title: string }) => l.title === 'Data Technician Apprentice');
    expect(real.salaryMin).toBeGreaterThan(0);
  });

  it('maps location text for the gazetteer, and drops a bare "UK"', () => {
    const thales = listings.find((l: { employerName: string }) => l.employerName === 'Thales');
    expect(thales.locations[0].text).toBe('Glasgow, Scotland');
    const iqa = listings.find((l: { title: string }) => /IQA/.test(l.title));
    expect(iqa.locations).toEqual([]);
  });
});

describe('Reed', () => {
  it('parses UK dates', () => {
    expect(reedDate('20/11/2026')).toBe('2026-11-20');
    expect(reedDate('2026-11-20T00:00:00')).toBe('2026-11-20');
  });

  it('maps search + detail to a listing', () => {
    const [r] = fx('reed/search.json').results;
    const raw = reedListing(
      { ...r, jobId: String(r.jobId) },
      { ...fx('reed/detail-55501234.json'), jobId: '55501234' },
    );
    expect(raw).toMatchObject({
      source: 'reed',
      sourceId: '55501234',
      applyUrl: 'https://careers.example.com/jobs/123',
      salaryMin: 21000,
      salaryMax: 23000,
      postedDate: '2026-10-02',
      closingDate: '2026-11-20',
    });
    expect(raw.descriptionHtml).toContain('<strong>');
    expect(normalise(raw)!.classification).toMatchObject({ roleType: 'data_analyst', level: 4 });
  });

  it('drops coaches', () => {
    const coach = fx('reed/search.json').results[1];
    expect(normalise(reedListing({ ...coach, jobId: String(coach.jobId) }))).toBeNull();
  });
});

describe('redactUrl', () => {
  it('hides API keys in URLs', () => {
    expect(redactUrl('https://api.adzuna.com/x?app_id=abc&app_key=secret&title_only=data')).toBe(
      'https://api.adzuna.com/x?app_id=…&app_key=…&title_only=data',
    );
  });
});

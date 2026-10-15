import { describe, expect, it } from 'vitest';
import { normalise } from '../src/pipeline/normalise.ts';
import { toRow } from '../src/pipeline/persist.ts';
import { manualListing } from '../src/sources/manual.ts';

const job = {
  id: 'j1',
  url: 'https://careers.example.com/jobs/123',
  title: null,
  employer_name: null,
};

const posting = `<html><head><title>Jobs | Example</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting",
"title":"Electrical Maintenance Apprentice","hiringOrganization":{"@type":"Organization","name":"Example plc"},
"description":"<p>A starting salary of £23,000 a year. Applications close on 30 November 2026.</p>",
"datePosted":"2026-10-01","jobLocation":{"@type":"Place","address":{"addressLocality":"Leeds","addressCountry":"GB"}}}
</script></head><body></body></html>`;

describe('jobs added by hand', () => {
  it('reads the JobPosting on the page', () => {
    expect(manualListing(job, posting)).toMatchObject({
      source: 'manual',
      sourceId: 'j1',
      title: 'Electrical Maintenance Apprentice',
      employerName: 'Example plc',
      postedDate: '2026-10-01',
      addedByHand: true,
    });
  });

  it('falls back to the heading and page text, and what was typed in wins', () => {
    const page =
      '<html><body><nav>Home Jobs</nav><main><h1>Data Apprentice</h1><p>Salary: £21,000 per annum. Closing date: 1 December 2026.</p></main></body></html>';
    const l = manualListing({ ...job, employer_name: 'Example' }, page);
    expect(l).toMatchObject({ title: 'Data Apprentice', employerName: 'Example' });
    expect(l.descriptionText).toContain('£21,000 per annum');
    expect(l.descriptionText).not.toContain('Home Jobs');
    expect(manualListing({ ...job, title: 'My title' }, page).title).toBe('My title');
  });

  it("still makes a listing when the page can't be read", () => {
    expect(manualListing({ ...job, title: 'Data Apprentice' }, null)).toMatchObject({
      title: 'Data Apprentice',
      employerName: 'Example',
      url: job.url,
    });
  });

  it('keeps a job the classifier would drop, and keeps it open', () => {
    const raw = manualListing(job, posting);
    expect(normalise({ ...raw, addedByHand: false })).toBeNull();
    const n = normalise(raw)!;
    expect(n.details).toMatchObject({ manual: true });
    const row = toRow(n, undefined, '2026-10-15', '2026-10-15T06:30:00Z');
    expect(row).toMatchObject({
      is_active: true,
      salary_min: 23000,
      closing_date: '2026-11-30',
    });
  });
});

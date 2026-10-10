import { describe, expect, it } from 'vitest';
import { adzunaListed, jobPageOf, looksGone } from '../src/pipeline/links.ts';
import type { Ctx } from '../src/types.ts';

describe('looksGone', () => {
  const job = 'https://careers.example.com/job/12345-data-apprentice';
  it('spots removed jobs', () => {
    expect(looksGone(job, job, 404, '')).toBe(true);
    expect(looksGone(job, job, 200, '<h1>Sorry, this job is no longer available</h1>')).toBe(true);
    expect(looksGone(job, job, 200, '<p>The vacancy has expired.</p>')).toBe(true);
    expect(looksGone(job, job, 200, '<h1>Job not found</h1>')).toBe(true);
    expect(looksGone(job, 'https://careers.example.com/', 200, '<h1>Welcome</h1>')).toBe(true);
    expect(looksGone(job, 'https://careers.example.com/jobs', 200, '<h1>Search jobs</h1>')).toBe(
      true,
    );
  });
  it('leaves live adverts alone', () => {
    const live =
      '<h1>Data Apprentice</h1><p>Closing date: 31 October. Apply now.</p><script>var notFound = "job not found"</script>';
    expect(looksGone(job, job, 200, live)).toBe(false);
    expect(looksGone(job, `${job}?ref=1`, 200, live)).toBe(false);
  });
});

describe('jobPageOf', () => {
  it('turns an application form link into the job page', () => {
    expect(
      jobPageOf(
        'https://becomeanapprentice.qa.com/jobs/8498556-data-analyst-apprentice/applications/new?promotion=2229908-not-going-to-uni',
      ),
    ).toBe('https://becomeanapprentice.qa.com/jobs/8498556-data-analyst-apprentice');
    expect(jobPageOf('https://jobs.example.com/job/123/apply')).toBe(
      'https://jobs.example.com/job/123',
    );
    expect(jobPageOf('https://jobs.example.com/job/123')).toBe('https://jobs.example.com/job/123');
  });
  it('recognises QA saying the job has closed', () => {
    const url = 'https://becomeanapprentice.qa.com/jobs/8498556-data-analyst-apprentice';
    expect(looksGone(url, url, 200, '<h1>This job is no longer active</h1>')).toBe(true);
  });
});

describe('adzunaListed', () => {
  const ctx = (reply: unknown) =>
    ({
      env: { ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'key' },
      http: {
        json: async () => {
          if (reply instanceof Error) throw reply;
          return reply;
        },
      },
    }) as unknown as Ctx;
  const ad = {
    sourceId: '5917680134',
    title: 'Corporate Responsibility Level 4 Data Analyst Apprentice',
  };
  it('is listed when the search returns its id', async () => {
    expect(await adzunaListed(ctx({ count: 1, results: [{ id: '5917680134' }] }), ad)).toBe('ok');
  });
  it('has gone when a complete search lacks it', async () => {
    expect(await adzunaListed(ctx({ count: 0, results: [] }), ad)).toBe('dead');
  });
  it("can't tell from a partial search or an error", async () => {
    expect(await adzunaListed(ctx({ count: 300, results: [{ id: '1' }] }), ad)).toBe('unknown');
    expect(await adzunaListed(ctx(new Error('503')), ad)).toBe('unknown');
  });
});

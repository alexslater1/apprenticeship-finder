import { describe, expect, it } from 'vitest';
import { looksGone } from '../src/pipeline/links.ts';

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

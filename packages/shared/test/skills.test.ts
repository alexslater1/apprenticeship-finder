import { describe, expect, it } from 'vitest';
import { extractSkills, SKILLS } from '../src/skills.ts';

const pad = (s: string) => `${s}\n${'Lorem ipsum dolor sit amet. '.repeat(30)}`;
const ctx = (text: string) =>
  Object.fromEntries((extractSkills(pad(text)) ?? []).map((m) => [m.id, m.ctx]));

describe('extractSkills', () => {
  it('needs a real description', () => {
    expect(extractSkills('Data Analyst Apprentice. Python and SQL.')).toBeNull();
    expect(extractSkills(null)).toBeNull();
  });

  it('every skill has a unique id and compiles', () => {
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
  });

  it('reads a "what you will learn" list as taught', () => {
    const c = ctx(
      'What You Will Learn\nThroughout the apprenticeship, you will gain experience and knowledge in:\nData collection and preparation.\nStatistical methods and hypothesis testing.\nProgramming languages such as Python and SQL.',
    );
    expect(c.python).toBe('taught');
    expect(c.sql).toBe('taught');
    expect(c.statistics).toBe('taught');
  });

  it('reads requirements as asked, even "nice to have" ones', () => {
    const c = ctx(
      "What we're looking for\nStrong analytical and problem-solving skills.\nExperience with data analysis tools such as Alteryx, SQL or Python would be useful but isn't essential.",
    );
    expect(c.alteryx).toBe('asked');
    expect(c.python).toBe('asked');
    expect(c.problem_solving).toBe('asked');
  });

  it('reads duties as part of the job', () => {
    expect(ctx('What you’ll do\nBuild dashboards in Power BI for the sales team.').power_bi).toBe(
      'job',
    );
  });

  it('counts "(training provided)" and "gain experience in" as taught', () => {
    expect(ctx('Use tools such as Excel and Power BI (training provided).').excel).toBe('taught');
    expect(ctx('You will gain experience in SQL and Microsoft Fabric.').sql).toBe('taught');
  });

  it('ignores company blurbs and entry requirements', () => {
    const c = ctx(
      'About us\nWe are a leading AI company with a commitment to excellence and creative thinking.\nEntry requirements: three A levels including Maths, Physics or Computer Science.',
    );
    expect(c.commitment).toBeUndefined();
    expect(c.ai).toBeUndefined();
    expect(c.creativity).toBeUndefined();
  });

  it('reads opening questions as interest, not a requirement', () => {
    const c = ctx(
      'Are you looking for an exciting opportunity? Are you curious about how machine learning can help businesses?\nWhat you will learn: machine learning concepts and model development.',
    );
    expect(c.machine_learning).toBe('taught');
    expect(c.curiosity).toBe('asked');
  });

  it('does not read "excel in" as Excel', () => {
    expect(ctx('You will excel in a fast-moving team.').excel).toBeUndefined();
    expect(ctx('You need to be confident with Microsoft Excel.').excel).toBe('asked');
  });

  it('keeps a quote for the detail panel', () => {
    const m = extractSkills(pad('You need to be confident with Microsoft Excel.'))!.find(
      (x) => x.id === 'excel',
    );
    expect(m?.quote).toBe('You need to be confident with Microsoft Excel.');
  });
});

import { describe, expect, it } from 'vitest';
import type { Derived } from './derive';
import { mostly, rankSkills } from './skills';
import { listing } from '@/test/fixtures';

const d = (score: number, over: Parameters<typeof listing>[0] = {}): Derived => ({
  row: listing(over),
  score,
  rank: score,
  distance: null,
  daysToClose: null,
  isNew: false,
  excluded: null,
  fit: null,
});

describe('rankSkills', () => {
  const all = [
    d(90, {
      id: 'a',
      skills: [
        { id: 'python', ctx: 'taught' },
        { id: 'teamwork', ctx: 'asked' },
      ],
    }),
    d(30, {
      id: 'b',
      skills: [
        { id: 'excel', ctx: 'asked' },
        { id: 'teamwork', ctx: 'asked' },
      ],
    }),
    d(80, { id: 'short', skills: null }),
    d(99, { id: 'hidden', hidden: true, skills: [{ id: 'excel', ctx: 'asked' }] }),
    d(99, { id: 'no', skills: [{ id: 'excel', ctx: 'asked' }] }),
  ];
  all[4]!.excluded = 'role';

  it('weights each advert by its match score', () => {
    const r = rankSkills(all);
    const share = Object.fromEntries(r.stats.map((s) => [s.id, s.share]));
    expect(share.teamwork).toBe(1);
    expect(share.python).toBeCloseTo(0.75);
    expect(share.excel).toBeCloseTo(0.25);
    expect(r.stats.map((s) => s.id)).toEqual(['teamwork', 'python', 'excel']);
    // Teamwork is asked for in both, so all of its bar is "asked".
    const teamwork = r.stats.find((s) => s.id === 'teamwork')!;
    expect(teamwork.byKind).toEqual({ asked: 1, not_required: 0 });
    // Python is taught, which counts as not required.
    expect(r.stats.find((s) => s.id === 'python')!.byKind.not_required).toBeCloseTo(0.75);
  });

  it('counts every advert the same when weighting is off', () => {
    const share = Object.fromEntries(
      rankSkills(all, { weighted: false }).stats.map((s) => [s.id, s.share]),
    );
    expect(share.python).toBe(0.5);
    expect(share.excel).toBe(0.5);
  });

  it('can count just one kind of mention', () => {
    const r = rankSkills(all, { kind: 'not_required' });
    expect(r.stats.map((s) => s.id)).toEqual(['python']);
    expect(r.stats[0]!.share).toBeCloseTo(0.75);
    expect(r.basis).toBe(2);
  });

  it('leaves out hidden, "No" and summary-only adverts, and says how many were too short', () => {
    const r = rankSkills(all);
    expect(r.basis).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.stats.find((s) => s.id === 'teamwork')!.listings.map((l) => l.d.row.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('says what a skill mostly is', () => {
    expect(mostly({ asked: 1, not_required: 3 })).toBe('not_required');
    expect(mostly({ asked: 2, not_required: 2 })).toBe('asked');
  });
});

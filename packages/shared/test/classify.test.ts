import { describe, expect, it } from 'vitest';
import {
  baseScore,
  classify,
  excludedByPrefs,
  matchTier,
  noiseReason,
  personalScore,
} from '../src/index.ts';

const today = '2026-10-09';

function score(
  title: string,
  extra: Parameters<typeof classify>[0] extends infer T ? Partial<T> : never = {},
) {
  const c = classify({ title, ...extra });
  return {
    c,
    s: baseScore({ title, descriptionText: extra.descriptionText, classification: c, today }),
  };
}

describe('classify: role type from real titles', () => {
  it.each([
    ['2027 Data Science Apprentice - Crawley', 'data_science'],
    ['Level 6 Data Science Degree Apprenticeship', 'data_science'],
    [
      '2027 Technology Analyst AI and Data Science Graduate Apprenticeship Programme Glasgow',
      'data_science',
    ],
    ['AI Engineer Apprentice', 'ml_ai'],
    ['2027 Machine Learning Apprentice - Level 6 AI Engineer', 'ml_ai'],
    ['AI, Data and Conversion Apprentice', 'ml_ai'],
    ['L4 AI & Automation Apprentice', 'ml_ai'],
    ['Data Engineer Apprentice', 'data_engineering'],
    ['Data Analyst Apprenticeship Programme', 'data_analyst'],
    ['Data Technician Apprentice', 'data_analyst'],
    ['Business Intelligence Apprentice', 'data_analyst'],
    ['Insight Analyst Apprentice', 'data_analyst'],
    ['2027 Software Engineering Apprentice - Cheadle', 'software_tech'],
    ['Digital and Technology Solutions Degree Apprenticeship', 'software_tech'],
    ['Cyber Security Engineer Apprentice', 'software_tech'],
    ['Data Centre Technician L4', 'other'],
    ['Autocare Technician Apprentice', 'other'],
    ['Retail Degree Apprenticeship', 'other'],
  ])('%s → %s', (title, role) => {
    expect(classify({ title }).roleType).toBe(role);
  });

  it('a bare "data" in the title is a weak data_analyst match', () => {
    const c = classify({ title: 'HR Data & Systems Apprentice' });
    expect(c.roleType).toBe('data_analyst');
    expect(c.roleVia).toBe('title_weak');
  });

  it('falls back to the LARS standard when the title says nothing', () => {
    const c = classify({
      title: 'Solutions Apprentice (Osborne Clarke)',
      larsCode: 25,
      knownApprenticeship: true,
    });
    expect(c.roleType).toBe('software_tech');
    expect(c.roleVia).toBe('standard');
    expect(c.level).toBe(6);
    expect(c.isDegree).toBe(true);
  });

  it('is case-sensitive for AI/ML/BI so ordinary words do not match', () => {
    expect(classify({ title: 'Mail Room Apprentice' }).roleType).toBe('other');
    expect(classify({ title: 'Biology Technician Apprentice' }).roleType).toBe('other');
  });
});

describe('classify: apprenticeship + noise', () => {
  it.each([
    ['Data Apprenticeship Coach'],
    ['Skills Coach - Data Analyst Apprenticeship'],
    ['Apprenticeship Assessor (Digital)'],
    ['Data Analytics Tutor'],
    ['Apprenticeship Levy Advisor'],
  ])('%s is noise', (title) => {
    expect(noiseReason(title)).not.toBeNull();
    expect(classify({ title }).relevant).toBe(false);
  });

  it('a graduate scheme is not an apprenticeship, but a Scottish Graduate Apprenticeship is', () => {
    expect(classify({ title: 'Data Science Graduate Scheme 2027' }).isApprenticeship).toBe(false);
    const ga = classify({ title: 'Data Science Graduate Apprenticeship' });
    expect(ga.isApprenticeship).toBe(true);
    expect(ga.level).toBe(6);
    expect(ga.isDegree).toBe(true);
  });

  it('FAA vacancies are apprenticeships whatever the title says', () => {
    expect(classify({ title: 'Data Analyst', knownApprenticeship: true }).relevant).toBe(true);
    expect(classify({ title: 'Data Analyst' }).relevant).toBe(false);
  });

  it('description-only role hits are not enough to keep a listing', () => {
    const c = classify({
      title: 'Digital Marketing Apprentice',
      descriptionText: 'You will use Google Analytics and AI tools',
      knownApprenticeship: true,
    });
    expect(c.roleVia).toBe('description');
    expect(c.relevant).toBe(false);
  });
});

describe('classify: level', () => {
  it.each([
    ['Level 6 Data Science Degree Apprenticeship', 6, 'title'],
    ['Data Analyst Apprentice L4', 4, 'title'],
    ['Data Analyst Higher Apprenticeship', 4, 'title'],
    ['Data Science Degree Apprenticeship', 6, 'title'],
    ["Master's Degree Apprenticeship in AI", 7, 'title'],
  ])('%s → L%i (%s)', (title, level, src) => {
    const c = classify({ title });
    expect(c.level).toBe(level);
    expect(c.levelSource).toBe(src);
  });

  it('source level beats LARS beats title', () => {
    expect(classify({ title: 'Level 3 Data', level: 4, larsCode: 337 }).levelSource).toBe('source');
    expect(classify({ title: 'Level 3 Data', larsCode: 337 }).level).toBe(6);
  });

  it('drops levels 2–3 altogether', () => {
    expect(classify({ title: 'Advanced Apprenticeship in Data' })).toMatchObject({
      level: 3,
      relevant: false,
    });
    expect(classify({ title: 'Data Technician Apprentice', larsCode: 576 }).relevant).toBe(false);
    expect(classify({ title: 'Data Analyst Apprentice', level: 3 }).relevant).toBe(false);
    expect(classify({ title: 'Data Analyst Apprentice', level: 4 }).relevant).toBe(true);
  });

  it("doesn't read an entry requirement as the apprenticeship's level", () => {
    const c = classify({
      title: 'Data Science Apprentice',
      descriptionText: 'You will need a Level 3 qualification such as A levels.',
    });
    expect(c.level).toBeNull();
    expect(c.relevant).toBe(true);
    expect(
      classify({
        title: 'Data Analyst Apprentice',
        descriptionText: 'This is a Level 3 apprenticeship in data.',
      }).relevant,
    ).toBe(false);
  });

  it('ML engineer (L6) is not a degree', () => {
    expect(classify({ title: 'AI Engineer Apprentice', larsCode: 795 }).isDegree).toBe(false);
  });
});

describe('baseScore', () => {
  it('ranks an L6 data science degree apprenticeship high', () => {
    const { s } = score('2027 Data Science Apprentice - Crawley', {
      larsCode: 337,
      knownApprenticeship: true,
    });
    expect(s.total).toBeGreaterThanOrEqual(90);
    expect(matchTier(s.total)).toBe('high');
  });

  it('penalises data-entry and data-centre roles', () => {
    expect(score('Data Entry Apprentice').s.total).toBeLessThan(20);
    expect(score('Data Centre Technician Apprentice').s.penaltyLabels).toContain(
      'admin/data-centre role',
    );
  });

  it('internal-only adverts drop to near zero', () => {
    const { s } = score('Data Analyst Apprentice', {
      descriptionText: 'This vacancy is for existing employees only.',
    });
    expect(s.total).toBeLessThan(10);
  });

  it('closed listings score 0', () => {
    const c = classify({ title: 'Data Scientist Apprentice', larsCode: 337 });
    const s = baseScore({ title: 'x', classification: c, closingDate: '2026-10-01', today });
    expect(s.total).toBe(0);
  });

  it('DTS with data words in the description beats plain DTS', () => {
    const plain = score('Technology Apprentice', { larsCode: 25 }).s.total;
    const data = score('Technology Apprentice', {
      larsCode: 25,
      descriptionText: 'Specialise in data analytics',
    }).s.total;
    expect(data).toBeGreaterThan(plain);
  });

  it('fresh listings get a small boost', () => {
    const c = classify({ title: 'Data Analyst Apprentice' });
    const fresh = baseScore({
      title: 'Data Analyst Apprentice',
      classification: c,
      postedOrFirstSeen: '2026-10-07',
      today,
    });
    const old = baseScore({
      title: 'Data Analyst Apprentice',
      classification: c,
      postedOrFirstSeen: '2026-08-01',
      today,
    });
    expect(fresh.total - old.total).toBe(4);
  });

  it('page-hash leads are capped', () => {
    const c = classify({ title: 'Data Science Degree Apprenticeship', larsCode: 337 });
    expect(
      baseScore({ title: 'x', classification: c, isLead: true, today }).total,
    ).toBeLessThanOrEqual(60);
  });
});

describe('personalScore', () => {
  const prefs = {
    roles: { data_science: 'maybe', data_analyst: 'high', software_tech: 'no' } as const,
    levels: { '6': 'high', '5': 'high', '4': 'maybe', '7': 'no' } as const,
    defaultDistanceMiles: 50,
  };
  const listing = (
    title: string,
    extra: Parameters<typeof classify>[0] extends infer T ? Partial<T> : never = {},
  ) => {
    const { c, s } = score(title, extra);
    return { score: s.total, level: c.level, role_type: c.roleType, score_breakdown: s };
  };
  const ds6 = listing('Data Science Degree Apprenticeship', { larsCode: 337 });
  const da6 = listing('Data Analyst Degree Apprenticeship', { level: 6 });
  const da4 = listing('Data Analyst Apprentice', { larsCode: 80 });
  const ds4 = listing('Data Science Apprentice', { level: 4 });

  it('swaps the role and level points for the Settings ones', () => {
    // Data science is only 'Maybe' here, so a High data-analyst role outranks it at the same level…
    expect(personalScore(da6, prefs, null)).toBeGreaterThan(personalScore(ds6, prefs, null));
    // …and a High role at a Maybe level still beats a Maybe role at the same level.
    expect(personalScore(da4, prefs, null)).toBeGreaterThan(personalScore(ds4, prefs, null));
  });
  it('matches the base score when the preferences agree with the defaults', () => {
    const all = {
      roles: { data_science: 'high' },
      levels: { '6': 'high' },
      defaultDistanceMiles: 50,
    } as const;
    expect(personalScore(ds6, all, null)).toBe(ds6.score);
  });
  it('adds a bonus within the default distance and caps at 100', () => {
    expect(personalScore(da4, prefs, 10)).toBe(personalScore(da4, prefs, 80) + 8);
    const all = { roles: {}, levels: {}, defaultDistanceMiles: 50 };
    expect(ds6.score + 8).toBeGreaterThan(100);
    expect(personalScore(ds6, all, 1)).toBe(100);
    expect(personalScore(ds6, all, 1, { clamp: false })).toBe(ds6.score + 8);
  });
  it('adds the Settings extras: university ranking, grades, start, salary, favourites', () => {
    const anywhere = { ...prefs, defaultDistanceMiles: null };
    const plain = personalScore(ds6, anywhere, null);
    const at = (extra: object, score: object = {}) =>
      personalScore({ ...ds6, ...extra }, { ...anywhere, score }, null, { clamp: false });
    // Warwick is top 10 in computer science: +12 ('some'), +18 ('lots'), nothing when off.
    expect(at({ university: 'University of Warwick' }) - plain).toBe(12);
    expect(at({ university: 'University of Warwick' }, { universityWeight: 'lots' }) - plain).toBe(
      18,
    );
    expect(at({ university: 'University of Warwick' }, { universityWeight: 'off' })).toBe(plain);
    const entry = { summary: 'BBB at A level', ucas: 120, subjects: [] };
    expect(at({ entry }, { predictedGrades: 'AAB' }) - plain).toBe(5);
    expect(at({ entry }, { predictedGrades: 'CCC' }) - plain).toBe(-20);
    expect(at({ start_date: '2027-01-05' }, { earliestStart: '2027-09-01' }) - plain).toBe(-40);
    expect(at({ salary_min: 18000 }, { minSalary: 22000 }) - plain).toBe(-10);
    expect(at({ employer_id: 'thales' }, { favourites: ['thales'] }) - plain).toBe(8);
    expect(at({ is_degree: true }, { preferDegree: true }) - plain).toBe(10);
  });
  it('ignores distance when he is happy to move anywhere', () => {
    const anywhere = { ...prefs, defaultDistanceMiles: null };
    expect(personalScore(da4, anywhere, 10)).toBe(personalScore(da4, anywhere, 400));
  });
  it('keeps zero-scored (closed) listings at zero', () => {
    expect(personalScore({ ...ds6, score: 0 }, prefs, 1)).toBe(0);
  });
  it("hides 'No' roles and levels, never unknown levels", () => {
    expect(excludedByPrefs({ level: 6, role_type: 'software_tech' }, prefs)).toBe('role');
    expect(excludedByPrefs({ level: 7, role_type: 'data_science' }, prefs)).toBe('level');
    expect(excludedByPrefs({ level: null, role_type: 'data_science' }, prefs)).toBeNull();
    expect(excludedByPrefs({ level: 5, role_type: 'other' }, prefs)).toBeNull();
  });
});

describe('internal-only penalty', () => {
  it('does not fire when existing staff are one of several entry routes', () => {
    const { s } = score('Business Analyst Apprentice', {
      larsCode: 165,
      descriptionText:
        'Entry: A levels, or a degree, or existing staff with 2+ years of experience.',
    });
    expect(s.penaltyLabels).not.toContain('internal only');
  });
  it('fires for internal-only adverts', () => {
    const { s } = score('Data Analyst Apprentice', {
      descriptionText: 'This role is only open to existing colleagues.',
    });
    expect(s.penaltyLabels).toContain('internal only');
  });
});

describe('role hints from source categories', () => {
  it('a generic title in a data category counts as a data role', () => {
    const c = classify({ title: 'Degree Apprenticeships 2027', roleHint: 'Data analysis' });
    expect(c.roleType).toBe('data_analyst');
    expect(c.roleVia).toBe('category');
    expect(c.relevant).toBe(true);
  });
  it('the title still wins over the category', () => {
    expect(
      classify({ title: 'AI Engineer Degree Apprenticeship', roleHint: 'Data analysis' }).roleType,
    ).toBe('ml_ai');
  });
});

describe('level from description text', () => {
  it('finds "Level 4 Data Analyst standard"', () => {
    const c = classify({
      title: 'Data Analyst Apprentice',
      descriptionText: 'working towards the Level 4 Data Analyst standard.',
    });
    expect(c).toMatchObject({ level: 4, levelSource: 'text' });
  });
  it('ignores unrelated levels', () => {
    expect(
      classify({
        title: 'Data Analyst Apprentice',
        descriptionText: 'Office on level 3. Great team.',
      }).level,
    ).toBeNull();
  });
});

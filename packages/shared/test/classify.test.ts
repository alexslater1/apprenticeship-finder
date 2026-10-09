import { describe, expect, it } from 'vitest';
import { baseScore, classify, matchTier, noiseReason, personalScore } from '../src/index.ts';

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
    ['Advanced Apprenticeship in Data', 3, 'title'],
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
    preferredLevels: [6, 5, 4],
    preferredRoles: ['data_science' as const],
    defaultDistanceMiles: 50,
  };
  it('adds level, role and distance boosts, capped at 100', () => {
    expect(personalScore({ score: 60, level: 6, role_type: 'data_science' }, prefs, 10)).toBe(88);
    expect(personalScore({ score: 95, level: 6, role_type: 'data_science' }, prefs, 10)).toBe(100);
    expect(personalScore({ score: 60, level: 3, role_type: 'other' }, prefs, 80)).toBe(60);
  });
  it('keeps zero-scored (closed) listings at zero', () => {
    expect(personalScore({ score: 0, level: 6, role_type: 'data_science' }, prefs, 1)).toBe(0);
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

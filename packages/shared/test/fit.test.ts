import { describe, expect, it } from 'vitest';
import {
  bestRank,
  extractEntry,
  gradeFit,
  gradesToUcas,
  ordinal,
  universityRanking,
} from '../src/fit.ts';

describe('university rankings', () => {
  it('has this year’s positions and prefers the subject tables', () => {
    const r = universityRanking('University of Nottingham')!;
    expect(r.overall).toBeGreaterThan(0);
    expect(bestRank(r).table).not.toBe('overall');
    expect(universityRanking('BPP University')).toBeNull();
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(13)).toBe('13th');
  });
});

describe('grades', () => {
  it('converts grades to UCAS points (best three A levels)', () => {
    expect(gradesToUcas('A*AB')).toBe(144);
    expect(gradesToUcas('BBC')).toBe(112);
    expect(gradesToUcas('AABB')).toBe(136);
    expect(gradesToUcas('BBBB', 'higher')).toBe(108);
  });
});

describe('extractEntry from real adverts', () => {
  it.each([
    [
      'Plus: BBB-BBC at A-Level, with B in Maths. A Statistics qualification would be preferable.',
      'BBB–BBC at A level, incl. Maths',
      112,
    ],
    [
      'You must have already achieved or be predicted a minimum of 120 UCAS points, equivalent to BBB at A level.',
      '120 UCAS points (BBB at A level)',
      120,
    ],
    [
      'Entry requirements: Achieved at least 112 UCAS points from your top three subjects (or equivalent)',
      '112 UCAS points',
      112,
    ],
    [
      'To apply, you will need: 104 UCAS points (A Level BCC) Or an equivalent qualification',
      '104 UCAS points (BCC at A level)',
      104,
    ],
    [
      'you’ll need SQA Highers at BBBB including Maths and English.',
      'BBBB at Higher, incl. Maths',
      108,
    ],
    [
      'To apply, you will need: Highers 96 UCAS points Four Highers (BBCC) including Maths or Computing',
      '96 UCAS points, incl. Maths',
      96,
    ],
    [
      'you must have a minimum of: 3 A-Levels as grade C/4 or above, with at least one in Maths, Sciences and IT',
      '3 A levels at C or above',
      96,
    ],
    [
      'Three A Levels Grade B or above or, BTEC Extended Diploma (DDM)',
      '3 A levels at B or above',
      120,
    ],
    [
      'Level 3 Qualification (Apprenticeship/A Levels/BTEC etc.) OR equivalent work experience',
      'Any Level 3 (A levels, BTEC…)',
      null,
    ],
  ])('%s', (text, summary, ucas) => {
    const e = extractEntry(text)!;
    expect(e.summary).toBe(summary);
    expect(e.ucas).toBe(ucas);
  });
  it('reads FAA’s structured qualifications', () => {
    const e = extractEntry('', [{ qualificationType: 'A Level', subject: 'Maths', grade: 'BBC' }])!;
    expect(e.ucas).toBe(112);
    expect(e.summary).toMatch(/BBC at A level/);
  });
  it('notices a subject requirement on one A level', () => {
    const e = extractEntry(
      'To apply, you will need: A Levels Three A Levels Grade B or above in Maths At least one other relevant subject',
    )!;
    expect(e.summary).toBe('3 A levels, incl. Maths at B or above');
    expect(e.subjects).toEqual(['Maths']);
  });
  it('returns null when nothing is said', () => {
    expect(extractEntry('A great opportunity to join our data team.')).toBeNull();
  });
});

describe('gradeFit', () => {
  const bbc = { summary: 'BBC at A level', ucas: 112, subjects: [] };
  it('compares his predicted grades', () => {
    expect(gradeFit(bbc, 'ABB')).toBe('meets');
    expect(gradeFit(bbc, 'BCC')).toBe('close');
    expect(gradeFit(bbc, 'CCD')).toBe('below');
    expect(gradeFit(bbc, undefined)).toBeNull();
  });
  it('flags a missing Maths A level only when we know his subjects', () => {
    const maths = { summary: 'BBC, incl. Maths', ucas: 112, subjects: ['Maths'] };
    expect(gradeFit(maths, 'AAA', ['History', 'English'])).toBe('subject');
    expect(gradeFit(maths, 'AAA', ['Maths', 'Physics'])).toBe('meets');
    expect(gradeFit(maths, 'AAA', [])).toBe('meets');
  });
});

describe('gradeFit without UCAS points', () => {
  const subjects = ['Maths', 'Chemistry', 'Biology'];
  it('meets adverts that ask for no A-level grades', () => {
    expect(
      gradeFit(extractEntry('Minimum of 5 GCSEs including English and Maths.'), 'ABB', subjects),
    ).toBe('meets');
    expect(
      gradeFit(
        extractEntry('Level 3 qualification (apprenticeship/A-levels/BTEC, etc)'),
        'ABB',
        subjects,
      ),
    ).toBe('meets');
  });
  it('counts A levels when any grades will do', () => {
    expect(gradeFit(extractEntry('You will need 2 A levels.'), 'ABB', subjects)).toBe('meets');
    expect(gradeFit(extractEntry('You will need 3 A levels.'), 'AB', ['Maths', 'Chemistry'])).toBe(
      'below',
    );
  });
  it('checks a subject grade when all his grades clear it (or none do)', () => {
    const maths = extractEntry('Three A Levels Grade B or above in Maths');
    expect(maths?.summary).toBe('3 A levels, incl. Maths at B or above');
    expect(gradeFit(maths, 'ABB', subjects)).toBe('meets');
    expect(gradeFit(maths, 'CCD', subjects)).toBe('below');
    // Mixed: it depends which grade is Maths, which Settings doesn't say.
    expect(gradeFit(maths, 'ABC', subjects)).toBeNull();
  });
  it("reads Find an Apprenticeship's A-level lines", () => {
    const anyThree = extractEntry('', [
      { qualificationType: 'A Level', subject: 'Any x3', grade: 'A-D', weighting: 'Essential' },
    ]);
    expect(gradeFit(anyThree, 'ABB', subjects)).toBe('meets');
    const ict = extractEntry('', [
      {
        qualificationType: 'A Level',
        subject: 'ICT',
        grade: 'C, or  above',
        weighting: 'Essential',
      },
    ]);
    expect(gradeFit(ict, 'ABB', subjects)).toBe('subject');
    expect(gradeFit(ict, 'ABB', ['Computer Science', 'Maths', 'Physics'])).toBe('meets');
    const similar = extractEntry('', [
      {
        qualificationType: 'A Level',
        subject: 'Maths, Science, Computer Science or similar',
        grade: 'A - C',
        weighting: 'Essential',
      },
    ]);
    expect(gradeFit(similar, 'ABB', subjects)).toBe('meets');
  });
});

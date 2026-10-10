import rankingsJson from '../../../config/university-rankings.json';

/**
 * How well a listing fits him beyond role and level: university league-table position, entry
 * requirements against his predicted grades, start date, salary, favourites. Pure functions; the
 * weights live in config/keywords.json (`personal.extras`).
 */

export interface Ranking {
  overall?: number;
  computerScience?: number;
  mathematics?: number;
}

const rankings = rankingsJson as unknown as {
  edition: string;
  universities: Record<string, Ranking>;
};
export const RANKING_EDITION = rankings.edition;

export function universityRanking(name: string | null | undefined): Ranking | null {
  return (name && rankings.universities[name]) || null;
}

/** The position that matters for a data degree: the better of Computer Science and Maths, else overall. */
export function bestRank(r: Ranking): {
  rank: number;
  table: 'computer science' | 'maths' | 'overall';
} {
  const subject = [
    r.computerScience !== undefined
      ? { rank: r.computerScience, table: 'computer science' as const }
      : null,
    r.mathematics !== undefined ? { rank: r.mathematics, table: 'maths' as const } : null,
  ].filter((x) => x !== null);
  if (subject.length) return subject.sort((a, b) => a.rank - b.rank)[0]!;
  return { rank: r.overall ?? 999, table: 'overall' };
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Entry requirements in a form we can compare: a summary to show, and UCAS points when stated. */
export interface EntryReq {
  /** 'BBC at A level, incl. Maths' / '112 UCAS points' / 'Any Level 3 (A levels, BTEC)'. */
  summary: string;
  /** Minimum UCAS tariff points, if the advert gives grades or points. */
  ucas: number | null;
  /** A-level subjects the advert insists on ('Maths'). */
  subjects: string[];
  /** How many A levels it asks for, when it says ('3 A levels'). */
  aLevels?: number;
  /** The lowest grade allowed: for every A level, or for `gradeSubjects` when given. */
  minGrade?: string;
  /** Subjects that grade applies to; any one will do (['Maths'], ['ICT']). */
  gradeSubjects?: string[];
  /** Asks for no A-level grades ('GCSEs only', 'Any Level 3'). */
  noGrades?: boolean;
}

const A_LEVEL_POINTS: Record<string, number> = { 'A*': 56, A: 48, B: 40, C: 32, D: 24, E: 16 };
const HIGHER_POINTS: Record<string, number> = { A: 33, B: 27, C: 21, D: 15 };

/** 'A*AB' → ['A*', 'A', 'B']. */
export function splitGrades(s: string): string[] {
  return [
    ...s
      .toUpperCase()
      .replace(/\s+/g, '')
      .matchAll(/A\*|[A-E]/g),
  ].map((m) => m[0]);
}

/** UCAS points for A-level grades (best three), or Scottish Highers. */
export function gradesToUcas(grades: string, kind: 'alevel' | 'higher' = 'alevel'): number | null {
  const g = splitGrades(grades);
  if (!g.length) return null;
  const table = kind === 'higher' ? HIGHER_POINTS : A_LEVEL_POINTS;
  const pts = g.map((x) => table[x] ?? 0).sort((a, b) => b - a);
  return (kind === 'alevel' ? pts.slice(0, 3) : pts).reduce((a, b) => a + b, 0);
}

const RUN = '(?:A\\*|[A-E]){3,4}';
const SUBJECTS =
  '(Further Maths|Maths|Mathematics|Computer Science|Computing|Physics|Statistics|ICT|a STEM subject|a science)';

function subjectsIn(text: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(
    `(?:incl(?:uding|\\.)?|with (?:a |an )?(?:\\b[A-E] in )?|\\b[A-E] (?:or above )?in|A[- ]?levels? in)\\s*(?:A[- ]?level\\s+)?${SUBJECTS}`,
    'gi',
  );
  for (const m of text.matchAll(re)) {
    const s = m[1]!.replace(/^Mathematics$/i, 'Maths');
    out.add(s.charAt(0).toUpperCase() + s.slice(1));
  }
  return [...out];
}

const withSubjects = (summary: string, subjects: string[]) =>
  subjects.length ? `${summary}, incl. ${subjects.join(' & ')}` : summary;

/**
 * Read entry requirements from an advert: FAA's structured qualifications first, then the text
 * ('BBB-BBC at A-Level, with B in Maths', '112 UCAS points', 'Four Highers (BBCC)').
 */
export function extractEntry(
  text: string | null | undefined,
  quals: Array<{
    qualificationType?: string;
    subject?: string;
    grade?: string;
    weighting?: string;
  }> = [],
): EntryReq | null {
  const t = (text ?? '').replace(/\s+/g, ' ');
  const aLevelQuals = quals.filter((q) => /a ?level/i.test(q.qualificationType ?? ''));
  const qualText = aLevelQuals.map((q) => `A level ${q.subject ?? ''} ${q.grade ?? ''}`).join('. ');
  const all = `${qualText}. ${t}`;
  const subjects = subjectsIn(all);

  const ucasM =
    /(\d{2,3})\s*(?:UCAS)\s*(?:tariff\s*)?points?/i.exec(all) ??
    /UCAS (?:tariff )?points? of (\d{2,3})/i.exec(all);
  const ucasStated = ucasM ? Number(ucasM[1]) : null;
  const ucas = ucasStated !== null && ucasStated >= 32 && ucasStated <= 224 ? ucasStated : null;

  // Grades next to "A level" ('BBB-BBC at A-Level', 'A Level BCC', 'equivalent to BBB at A level').
  const aRun =
    new RegExp(
      `\\b(${RUN})(?:\\s*[-–/]\\s*(${RUN}))?\\b\\)?\\s*(?:at|in|from)?\\s*A[- ]?levels?`,
      'i',
    ).exec(all) ?? new RegExp(`[Aa][- ]?[Ll]evels?[^.]{0,25}?\\b(${RUN})\\b(?!\\w)`, '').exec(all);
  const higherRun =
    new RegExp(`Highers?\\s*(?:at\\s*)?\\(?\\b([A-D]{3,5})\\b`, 'i').exec(all) ??
    new RegExp(`\\b([A-D]{3,5})\\b\\)?\\s*(?:at\\s*)?(?:SQA\\s*)?Highers?`, 'i').exec(all);

  if (aRun && /[A-E]/.test(aRun[1]!) && !/^[A-E]{4}$/.test(aRun[1]!)) {
    const grades = (aRun[2] ?? aRun[1]!).toUpperCase(); // a range: the lower end is the minimum
    const range = aRun[2] ? `${aRun[1]!.toUpperCase()}–${aRun[2].toUpperCase()}` : grades;
    const gUcas = gradesToUcas(grades);
    if (ucas !== null)
      return {
        summary: withSubjects(`${ucas} UCAS points (${range} at A level)`, subjects),
        ucas,
        subjects,
      };
    return { summary: withSubjects(`${range} at A level`, subjects), ucas: gUcas, subjects };
  }
  if (ucas !== null)
    return { summary: withSubjects(`${ucas} UCAS points`, subjects), ucas, subjects };
  if (higherRun) {
    const g = higherRun[1]!.toUpperCase();
    return {
      summary: withSubjects(`${g} at Higher`, subjects),
      ucas: gradesToUcas(g, 'higher'),
      subjects,
    };
  }
  // 'Three A Levels Grade B or above', '3 A-Levels as grade C/4 or above'
  const n =
    /\b(three|3|two|2) A[- ]?levels?(?: subjects)?[^.]{0,20}?(?:at|as)?\s*grades?\s*([A-E])\b(?:\/\d)?\s*(?:or above|or higher|\+)?/i.exec(
      all,
    );
  if (n) {
    const count = /three|3/i.test(n[1]!) ? 3 : 2;
    const grade = n[2]!.toUpperCase();
    // 'Grade B or above in Maths' is about one subject, not all three.
    const oneSubject = new RegExp(`${grade} or above in ${SUBJECTS}`, 'i').test(
      all.slice(n.index, n.index + 80),
    );
    return oneSubject
      ? {
          summary: `${count} A levels, incl. ${subjects[0] ?? 'Maths'} at ${grade} or above`,
          ucas: null,
          subjects,
          aLevels: count,
          minGrade: grade,
          gradeSubjects: [subjects[0] ?? 'Maths'],
        }
      : {
          summary: withSubjects(`${count} A levels at ${grade} or above`, subjects),
          ucas: count * (A_LEVEL_POINTS[grade] ?? 0),
          subjects,
          aLevels: count,
          minGrade: grade,
        };
  }
  if (aLevelQuals.length) {
    const q = aLevelQuals.find((x) => !/desired/i.test(x.weighting ?? '')) ?? aLevelQuals[0]!;
    const summary = `A level ${q.subject ?? ''}: ${q.grade ?? ''}`.replace(/\s+/g, ' ').trim();
    return {
      summary: summary.length > 70 ? `${summary.slice(0, 67)}…` : summary,
      ucas: null,
      subjects,
      ...(/desired/i.test(q.weighting ?? '') ? {} : faaRequirement(q.subject ?? '', q.grade ?? '')),
    };
  }
  if (/level 3 qualification|A[- ]?levels?\s*\/\s*BTEC|A[- ]?levels?, BTEC/i.test(all))
    return {
      summary: withSubjects('Any Level 3 (A levels, BTEC…)', subjects),
      ucas: null,
      subjects,
      noGrades: true,
    };
  if (/\b(?:two|three|2|3) A[- ]?levels?\b/i.test(all)) {
    const c = /\b(?:three|3) A[- ]?levels?\b/i.test(all) ? 3 : 2;
    return {
      summary: withSubjects(`${c} A levels (any grades)`, subjects),
      ucas: null,
      subjects,
      aLevels: c,
    };
  }
  const gcse = quals.some((q) => /gcse/i.test(q.qualificationType ?? '')) || /\bGCSEs?\b/.test(t);
  if (gcse && !/A[- ]?level|UCAS|Highers?/i.test(all))
    return { summary: 'GCSEs only', ucas: null, subjects: [], noGrades: true };
  return null;
}

/**
 * FAA's structured A-level line: subject 'Any x3' / 'ICT' / 'Maths, Science, Computer Science or
 * similar', grade 'A-D' / 'C, or above' / 'BBC'.
 */
function faaRequirement(subject: string, grade: string): Partial<EntryReq> {
  const out: Partial<EntryReq> = {};
  const count = /x\s*(\d)\b|\b(\d)\s*A[- ]?levels?/i.exec(subject);
  if (count) out.aLevels = Number(count[1] ?? count[2]);
  const run = new RegExp(`^\\s*(${RUN})\\s*$`).exec(grade.toUpperCase());
  if (run) out.ucas = gradesToUcas(run[1]!);
  else {
    // A range or a floor: the lowest grade mentioned is the minimum ('A-D' → D, 'C or above' → C).
    const letters = splitGrades(grade.replace(/\d[-–]\d|\(.*?\)/g, ' '));
    if (letters.length)
      out.minGrade = letters.reduce((lo, g) =>
        GRADE_ORDER.indexOf(g) > GRADE_ORDER.indexOf(lo) ? g : lo,
      );
  }
  const lenient = /\bany\b|similar|equivalent|relevant|other/i.test(subject);
  const named = subject
    .split(/,|\bor\b|\/|&|\band\b/i)
    .map((x) => x.trim())
    .filter((x) => x && !/^any\b|x\s*\d|similar|equivalent/i.test(x));
  if (named.length && !lenient) out.gradeSubjects = named;
  return out;
}

const GRADE_ORDER = ['A*', 'A', 'B', 'C', 'D', 'E'];
const atLeast = (g: string, min: string) => GRADE_ORDER.indexOf(g) <= GRADE_ORDER.indexOf(min);

/** Does he take an A level that satisfies this requirement? ('ICT' accepts Computer Science.) */
function takes(his: string[], req: string): boolean {
  const r = req.toLowerCase();
  return his.some((h) => {
    const s = h.toLowerCase();
    if (/^(maths|mathematics)$/.test(r)) return /maths/.test(s);
    if (/^(ict|it|computing|computer science)$/.test(r)) return s === 'computer science';
    if (/stem/.test(r)) return /maths|physics|chemistry|biology|computer science/.test(s);
    if (/science/.test(r)) return /physics|chemistry|biology|computer science/.test(s);
    return s === r;
  });
}

export type GradeFit = 'meets' | 'close' | 'below' | 'subject';

/** His predicted grades against an advert's requirements (null when either is unknown). */
export function gradeFit(
  entry: EntryReq | null | undefined,
  predicted: string | undefined,
  hisSubjects: string[] = [],
): GradeFit | null {
  if (!entry) return null;
  const knowsSubjects = hisSubjects.length > 0;
  const needsMaths = entry.subjects.some((s) => /maths/i.test(s));
  if (knowsSubjects && needsMaths && !hisSubjects.some((h) => /math/i.test(h))) return 'subject';
  if (
    knowsSubjects &&
    entry.gradeSubjects?.length &&
    !entry.gradeSubjects.some((s) => takes(hisSubjects, s))
  )
    return 'subject';
  const mine = predicted ? splitGrades(predicted) : [];
  if (entry.ucas !== null) {
    if (!mine.length) return null;
    const gap = entry.ucas - gradesToUcas(predicted!)!;
    if (gap <= 0) return 'meets';
    if (gap <= 8) return 'close';
    return 'below';
  }
  // No A-level grades asked for: he's taking A levels, so he's over the bar.
  if (entry.noGrades) return mine.length || knowsSubjects ? 'meets' : null;
  const count = Math.max(mine.length, hisSubjects.length);
  if (entry.aLevels && count > 0 && count < entry.aLevels) return 'below';
  if (entry.minGrade && mine.length) {
    const ok = mine.filter((g) => atLeast(g, entry.minGrade!)).length;
    if (entry.gradeSubjects?.length) {
      // His grades aren't tied to subjects, so it's only certain when all (or none) reach it.
      if (ok === mine.length) return 'meets';
      return ok === 0 ? 'below' : null;
    }
    const need = Math.min(entry.aLevels ?? 3, mine.length);
    if (ok >= need) return 'meets';
    return ok === need - 1 ? 'close' : 'below';
  }
  if (entry.aLevels && count >= entry.aLevels) return 'meets';
  return null;
}

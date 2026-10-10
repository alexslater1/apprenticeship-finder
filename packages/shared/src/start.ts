/**
 * Start dates written in the advert (Alex, 10 Oct: "add a column of start dates where known; even
 * if it's only monthwise that's okay, the more accurate the better"). Most sources don't give a
 * start date, but adverts usually say: "Start Date: 06 September 2027", "October 2026 start",
 * "Induction week … Monday 6 September … 2027", "your apprenticeship (August 2027 to August 2031)",
 * or a title ending "– September 2027". Failing those, the year ("2027 Data Analyst Apprentice"):
 * better than nothing (Alex, 10 Oct).
 */

export type StartPrecision = 'day' | 'month' | 'year';

export interface StartDate {
  /** ISO date; the 1st of the month (or 1 January) when only the month (or year) is known. */
  date: string;
  precision: StartPrecision;
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;
const MONTH =
  '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\.?';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '(20\\d\\d)';

/** Words that introduce a start date ("Start date:", "commencing", "intake"). */
const CUE =
  /\b(?:start(?:s|ing)?(?: date)?|commenc\w*|intake|cohort|induction(?: week)?|(?:programme|apprenticeship|role) (?:starts|begins|will (?:start|begin))|join(?:ing)? (?:us|date)|begin(?:s|ning)?)\b/gi;

/** A date right after a cue, before the sentence (or a closing date) intervenes. */
const AFTER = [
  // 6 September 2027, 6th Sept, 2027, Monday 6 September … 2027
  {
    re: new RegExp(`^[^.;\\n]{0,90}?\\b${DAY}\\s+${MONTH}\\b,?(?:[^.;\\n]{0,40}?\\b)?${YEAR}`, 'i'),
    day: 1,
    month: 2,
    year: 3,
  },
  // September 6, 2027
  {
    re: new RegExp(`^[^.;\\n]{0,90}?\\b${MONTH}\\s+${DAY},?\\s+${YEAR}`, 'i'),
    day: 2,
    month: 1,
    year: 3,
  },
  // 06/09/2027 (UK order)
  {
    re: /^[^.;\n]{0,90}?\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d)\b/,
    day: 1,
    month: 2,
    year: 3,
    numeric: true,
  },
  // September 2027
  { re: new RegExp(`^[^.;\\n]{0,90}?\\b${MONTH}\\s+${YEAR}`, 'i'), month: 1, year: 2 },
] as const;

/** A month and year followed by a start word: "October 2026 start", "September 2027 intake". */
const BEFORE = new RegExp(`\\b${MONTH}\\s+${YEAR}\\s+(?:start|intake|cohort|entry)\\b`, 'gi');

/** "your apprenticeship (August 2027 to August 2031)": the first date is the start. */
const SPAN = new RegExp(
  `\\b(?:apprenticeship|programme|course)\\s*\\(\\s*${MONTH}\\s+${YEAR}\\s*(?:to|until|–|-)\\s*${MONTH}\\s+${YEAR}\\s*\\)`,
  'gi',
);

/** A start word then just a year: "Start date: 2027", "starting in 2027". */
const AFTER_YEAR = /^[^.;\n]{0,40}?\b(20\d\d)\b(?!\s*[/-]\s*\d)/;
/** "2027 intake", "for a 2027 start", "2026/27 cohort" (the first year). */
const BEFORE_YEAR =
  /\b(20\d\d)(?:\s*[/-]\s*\d{2,4})?\s+(?:start|intake|cohort|entry|programme|scheme)\b/gi;
/** A year in the title: "2027 Data Analyst Apprentice", "Degree Apprenticeships 2027". */
const TITLE_YEAR = /\b(20\d\d)(?:\s*[/-]\s*\d{2,4})?\b/;

/** A month and year in the title ("… – Manchester – September 2027"). */
const TITLE = new RegExp(`\\b${MONTH}\\s+${YEAR}\\b`, 'i');

const STOP = /\b(?:clos\w*|deadline|apply by|applications?|expires?)\b/i;

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.toLowerCase().slice(0, 3) as (typeof MONTHS)[number]);
}

function iso(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return null; // 31 June
  return d.toISOString().slice(0, 10);
}

function plausible(date: string, today: string, upperOnly = false): boolean {
  // Up to four months ago (a programme that has just begun) and three years ahead.
  const t = new Date(`${today}T00:00:00Z`).getTime();
  const d = new Date(`${date}T00:00:00Z`).getTime();
  return (upperOnly || d >= t - 120 * 86_400_000) && d <= t + 3 * 365 * 86_400_000;
}

/** The start date the advert gives, preferring an exact day over a month. */
export function extractStartDate(
  title: string | null | undefined,
  text: string | null | undefined,
  today: string,
): StartDate | null {
  const found: StartDate[] = [];
  const add = (year: string, month: string | number | null, day?: string | number) => {
    if (month === null) {
      const date = `${year}-01-01`;
      if (plausible(`${year}-12-31`, today) && plausible(date, today, true))
        found.push({ date, precision: 'year' });
      return;
    }
    const m = typeof month === 'number' ? month : monthIndex(month);
    if (m < 0) return;
    const date = iso(Number(year), m, day === undefined ? 1 : Number(day));
    if (date && plausible(date, today))
      found.push({ date, precision: day === undefined ? 'month' : 'day' });
  };
  const body = (text ?? '').replace(/[ \t\u00a0]+/g, ' ');
  for (const cue of body.matchAll(CUE)) {
    let rest = body.slice(cue.index + cue[0].length, cue.index + cue[0].length + 160);
    const stop = STOP.exec(rest);
    if (stop) rest = rest.slice(0, stop.index);
    let hit = false;
    for (const p of AFTER) {
      const m = p.re.exec(rest);
      if (!m) continue;
      if ('numeric' in p) add(m[p.year]!, Number(m[p.month]) - 1, m[p.day]);
      else if ('day' in p) add(m[p.year]!, m[p.month]!, m[p.day]);
      else add(m[p.year]!, m[p.month]!);
      hit = true;
      break;
    }
    const y = hit ? null : AFTER_YEAR.exec(rest);
    if (y) add(y[1]!, null);
  }
  for (const m of body.matchAll(BEFORE_YEAR)) add(m[1]!, null);
  for (const m of body.matchAll(BEFORE)) add(m[2]!, m[1]!);
  for (const m of body.matchAll(SPAN)) add(m[2]!, m[1]!);
  const t = title ? TITLE.exec(title) : null;
  if (t) add(t[2]!, t[1]!);
  const ty = title ? TITLE_YEAR.exec(title) : null;
  if (ty) add(ty[1]!, null);
  return (
    found.find((f) => f.precision === 'day') ??
    found.find((f) => f.precision === 'month') ??
    found[0] ??
    null
  );
}

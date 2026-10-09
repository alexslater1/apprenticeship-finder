import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  classify,
  collapseSpaces,
  daysBetween,
  slugify,
  type Location,
  type RawListing,
} from '@af/shared';
import { z } from 'zod';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * Amazing Apprenticeships "Higher & Degree Vacancy Listing" (research/job-sites.md §B4): a PDF
 * made three times a year (October, January, April). Weekly: find the PDF the resource page links
 * to; when it's new, download it, run `pdftotext -layout`, parse the vacancy entries, keep the
 * Digital section plus data/tech keyword hits (the classifier does the real filtering), and
 * resolve their amapps.uk short links (TinyURL redirects: one HEAD each). Between checks the last
 * parse is re-emitted from source_state so its listings still count as advertised.
 *
 * Two layouts so far: the April 2026 mini edition is one card per vacancy ('Role … Level' labels),
 * the January 2026 edition a wide table ('Employer Role Level Location(s) …' header per page).
 */
const BASE = 'https://www.amazingapprenticeships.com';
/** The resource page links the current PDF; the landing page links the current resource page. */
export const PAGES = [
  `${BASE}/resources/higher-and-degree-listing/`,
  `${BASE}/higher-degree-listing/`,
];
const LAST_PDF = 'amazing:last_pdf';
const LAST_CHECK = 'amazing:last_check';
const PARSED = 'amazing:listings';
const CHECK_EVERY_DAYS = 6;
const MAX_RESOLVE = 80; // short links per new edition; ~30 entries pass the filter

export interface VacancyEntry {
  section: string | null;
  employer: string;
  role: string;
  level?: number;
  location: string;
  salary?: string;
  /** 'Open now', 'November 2026'. */
  opens?: string;
  /** 'May 2026', 'Ongoing'. */
  closes?: string;
  start?: string;
  /** As printed: 'amapps.uk/jan26sev9', a URL, or an email address. */
  link?: string;
}

/** Edition month, used to give bare months ('March') a year. */
export interface Edition {
  year: number;
  month: number;
}

// ---------------------------------------------------------------------------------------------
// Finding the PDF

const PDF_LINK =
  /(?:https?:\/\/[^"'\s<>]*?)?\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"'\s<>]+?\.pdf/gi;
const NOT_LISTING = /teacher|how-to|poster|lesson|guide|flyer|booklet|rapid-read/i;

/** Newest upload folder first; a stable sort keeps page order within a folder. */
function newestFirst(urls: string[]): string[] {
  const folder = (u: string) => /\/uploads\/(\d{4}\/\d{2})\//.exec(u)?.[1] ?? '';
  return [...new Set(urls)].sort((a, b) => folder(b).localeCompare(folder(a)));
}

/** Listing PDFs linked from a page, newest first (teacher guides and posters skipped). */
export function findListingPdfs(html: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(PDF_LINK)) {
    const url = new URL(m[0], BASE).toString();
    const file = url.split('/').at(-1)!;
    if (/listing|vacanc/i.test(file) && !NOT_LISTING.test(file)) urls.push(url);
  }
  return newestFirst(urls);
}

/** Resource pages for the listing linked from the landing page (a new edition may get its own). */
export function findResourcePages(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(
    /href="((?:https?:\/\/www\.amazingapprenticeships\.com)?\/resources\/[a-z0-9-]+\/?)"/g,
  )) {
    const url = new URL(m[1]!, BASE).toString();
    if (/degree[^/]*listing|listing[^/]*degree|hd-listing/i.test(url) && !NOT_LISTING.test(url))
      out.add(url);
  }
  return [...out];
}

/** The newest listing PDF linked from the resource page, the landing page, or pages it links. */
async function findCurrentPdf(ctx: Ctx): Promise<{ url: string | null; pages: number }> {
  const seen = new Set<string>();
  const pdfs: string[] = [];
  const visit = async (url: string) => {
    if (seen.has(url)) return '';
    seen.add(url);
    const html = await ctx.http.text(url, { robots: true });
    pdfs.push(...findListingPdfs(html));
    return html;
  };
  for (const page of PAGES) {
    const html = await visit(page);
    for (const linked of findResourcePages(html).slice(0, 3)) await visit(linked);
  }
  return { url: newestFirst(pdfs)[0] ?? null, pages: seen.size };
}

// ---------------------------------------------------------------------------------------------
// pdftotext

const execFileAsync = promisify(execFile);

/** `pdftotext -layout` (poppler-utils; on GitHub's ubuntu runners and most Linux installs). */
export async function pdfToText(pdf: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'af-pdf-'));
  try {
    const file = join(dir, 'listing.pdf');
    await writeFile(file, pdf);
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Parsing the text

interface Seg {
  col: number;
  text: string;
}

/** Runs of text separated by 2+ spaces, with their start columns. */
function segments(line: string): Seg[] {
  const out: Seg[] = [];
  for (const m of line.matchAll(/\S+(?: \S+)*/g)) out.push({ col: m.index, text: m[0] });
  return out;
}

/** Join wrapped cell lines: 'Newcastle-under-' + 'Lyme' → 'Newcastle-under-Lyme'. */
function joinWrapped(parts: string[]): string {
  let out = '';
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
    out = !out ? p : /\p{L}[-/]$/u.test(out) ? out + p : `${out} ${p}`;
  }
  return out;
}

/** Blank out `len` characters at `at`, keeping every other column where it was. */
function blank(line: string, at: number, len: number): string {
  return at < 0 ? line : line.slice(0, at) + ' '.repeat(len) + line.slice(at + len);
}

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const SEASON = '(?:Spring|Summer|Autumn|Winter)';
const DATE = `(?:Open(?:s|ing)?\\s+(?:now|soon)|Now open|Coming soon|Ongoing|Rolling|TBC|TBA|ASAP|Immediate(?:ly)?|Flexible|Closed|Now|(?:(?:Early|Mid|Late|End(?: of)?)[ -])?(?:${MONTH}|${SEASON})\\b(?:\\s+\\d{4})?)`;
const LINK =
  '(?:(?:https?:\\/\\/|www\\.)\\S+|[\\w.-]+@[\\w-]+(?:\\.[\\w-]+)+|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:uk|com|org|net|io|co|jobs)\\/\\S*)';
const LINK_ONLY = new RegExp(`^${LINK}$`, 'i');
/** Everything right of the level in a table row's first line. */
const ROW_TAIL = new RegExp(
  `^(?<mid>.*?)\\s*\\b(?<open>${DATE})\\s+(?<close>${DATE})\\s+(?<start>${DATE})\\s+(?<link>${LINK})\\s*$`,
  'di',
);
const SALARY_START =
  /£|\b(?:Competitive|Negotiable|Up to|Depend(?:ent|ing)|DOE|National (?:minimum|living)|(?:Apprenticeship )?minimum wage)\b|\bNational:/i;
const LEVEL_SEG = /^[2-7](?:\s*(?:\/|&|,|-|–|or|and|to)\s*[2-7])*$/;
const YEAR = /^(?:19|20)\d{2}$/;
const BARE_MONTH = new RegExp(
  `^(?:(?:Early|Mid|Late|End(?: of)?)[ -])?(?:${MONTH}|${SEASON})$`,
  'i',
);

function levelOf(text: string): number | undefined {
  const nums = [...text.matchAll(/[2-7]/g)].map((m) => Number(m[0]));
  return nums.length ? Math.max(...nums) : undefined;
}

function cleanEmployer(s: string): string {
  return collapseSpaces(s.replace(/^[^\p{L}\p{N}(]+/u, ''));
}

const PAGE_NUMBER = /^\s*\d{1,3}\s*$/;
const FOOTER =
  /^\s*(?:Important information|As of the date of publication|Higher and Degree Vacancy Listing:|Frequently Asked Questions|Useful resources)/i;

// --- Card layout (April 2026) ----------------------------------------------------------------

const CARD = {
  role: /^\s{0,4}Role\b/,
  location: /^\s{0,4}Location\(s\)/,
  dates: /^\s{0,4}Applications open\b/i,
  start: /^\s{0,4}Start Date\b/i,
  link: /^\s{0,4}Link to application details\b/i,
};
/** FAA route names, which the listing uses as section headings. */
const ROUTE =
  /^(?:Agricultur|Business and|Care services|Catering|Construction|Creative|Digital$|Education|Engineering|Hair|Health|Legal|Protective|Sales|Transport)/i;

/** Split a two-column card group into its left and right values at the right-hand label. */
function twoColumns(lines: string[], leftLabel: RegExp, rightLabel: RegExp): [string, string] {
  const left: string[] = [];
  const right: string[] = [];
  let rightCol = Infinity;
  lines.forEach((line, i) => {
    let l = line;
    if (i === 0) {
      const lm = leftLabel.exec(l);
      if (lm) l = blank(l, lm.index, lm[0].length);
      const rm = rightLabel.exec(l);
      if (rm) {
        rightCol = rm.index;
        l = blank(l, rm.index, rm[0].length);
      }
    }
    for (const s of segments(l)) (s.col >= rightCol - 8 ? right : left).push(s.text);
  });
  return [joinWrapped(left), joinWrapped(right)];
}

function parseCards(lines: string[]): VacancyEntry[] {
  const out: VacancyEntry[] = [];
  let section: string | null = null;
  let prevEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!CARD.role.test(lines[i]!) || !/\bLevel\b/.test(lines[i]!)) continue;
    const find = (re: RegExp, from: number) => {
      for (let j = from; j < Math.min(lines.length, from + 30); j++)
        if (re.test(lines[j]!)) return j;
      return -1;
    };
    const loc = find(CARD.location, i + 1);
    const dates = loc > 0 ? find(CARD.dates, loc + 1) : -1;
    const start = dates > 0 ? find(CARD.start, dates + 1) : -1;
    const link = start > 0 ? find(CARD.link, start + 1) : -1;
    if (link < 0) continue;

    // Between the previous card and this one: [page number] [section heading] employer.
    const pre = lines
      .slice(prevEnd, i)
      .map((l) => l.trim())
      .filter((l) => l && !PAGE_NUMBER.test(l));
    const employer = pre.at(-1);
    const heading = pre.slice(0, -1).findLast((l) => ROUTE.test(l));
    if (heading) section = heading;

    const roleLines = lines.slice(i, loc);
    // The 'Level' label is the last one on the label line ('…Surveyor Level' has one space).
    const levelAt = [...roleLines[0]!.matchAll(/\bLevel\b/g)].at(-1)?.index ?? -1;
    roleLines[0] = blank(blank(roleLines[0]!, levelAt, 5), roleLines[0]!.search(/\S/), 4);
    const roleParts: string[] = [];
    let level: number | undefined;
    for (const l of roleLines)
      for (const s of segments(l)) {
        if (LEVEL_SEG.test(s.text) && level === undefined) level = levelOf(s.text);
        else roleParts.push(s.text);
      }

    const location = joinWrapped(
      lines
        .slice(loc, dates)
        .flatMap((l, k) =>
          segments(k === 0 ? l.replace(CARD.location, (m) => ' '.repeat(m.length)) : l).map(
            (s) => s.text,
          ),
        ),
    );
    const [opens, closes] = twoColumns(
      lines.slice(dates, start),
      /Applications open/i,
      /Applications close/i,
    );
    const [startDate, salary] = twoColumns(
      lines.slice(start, link),
      /Start Date/i,
      /Starting salary/i,
    );

    let linkText = lines[link]!.replace(CARD.link, '').trim();
    let end = link + 1;
    for (let j = link + 1; !linkText && j < Math.min(lines.length, link + 4); j++) {
      linkText = lines[j]!.trim();
      end = j + 1;
    }
    prevEnd = end;

    if (!employer || !roleParts.length) continue;
    out.push({
      section,
      employer: cleanEmployer(employer),
      role: joinWrapped(roleParts),
      level,
      location,
      salary: salary || undefined,
      opens: opens || undefined,
      closes: closes || undefined,
      start: startDate || undefined,
      link: linkText.split(/\s+/)[0] || undefined,
    });
  }
  return out;
}

// --- Table layout (January 2026) -------------------------------------------------------------

const TABLE_HEAD = /\bEmployer\s+Role\s+Level\s+Location/;
const FIELDS = ['employer', 'role', 'location', 'salary', 'opens', 'closes', 'start'] as const;
type Field = (typeof FIELDS)[number];

interface Columns {
  employer: number;
  role: number;
  level: number;
  location: number;
  salary: number;
  opens: number;
  closes: number;
  start: number;
}

function headerColumns(head: string, below: string[]): Columns {
  const at = (re: RegExp, s = head) => s.search(re);
  const apps = at(/\bApplications\b/);
  const sub = below.find((l) => /\bOpen\b\s+\bClose\b/.test(l));
  return {
    employer: at(/\bEmployer\b/),
    role: at(/\bRole\b/),
    level: at(/\bLevel\b/),
    location: at(/\bLocation/),
    salary: at(/\bStarting\b|\bSalary\b/),
    opens: sub ? at(/\bOpen\b/, sub) : apps,
    closes: sub ? at(/\bClose\b/, sub) : apps + 12,
    start: at(/\bStart Date\b/),
  };
}

interface Row {
  values: Partial<Record<Field, string[]>>;
  cols: Partial<Record<Field, number>>;
  level?: number;
  link?: string;
}

/** A row's first line: employer, role, level, then location … link (some merged by 1 space). */
function startRow(line: string, cols: Columns): Row | null {
  const segs = segments(line);
  const li = segs.findIndex(
    (s, k) =>
      k > 0 && LEVEL_SEG.test(s.text) && s.col >= cols.level - 6 && s.col <= cols.location + 1,
  );
  if (li < 0) return null;
  const row: Row = { values: {}, cols: {}, level: levelOf(segs[li]!.text) };
  const put = (f: Field, text: string, col: number) => {
    if (!text.trim()) return;
    (row.values[f] ??= []).push(text.trim());
    row.cols[f] ??= col;
  };

  const left = segs.slice(0, li);
  if (left.length >= 2) {
    put('employer', left[0]!.text, left[0]!.col);
    for (const s of left.slice(1)) put('role', s.text, s.col);
  } else {
    // Employer and role ran together: cut at the last space before the Role column.
    const s = left[0]!;
    const cut = s.text.lastIndexOf(' ', Math.max(0, cols.role - s.col));
    if (cut <= 0) return null;
    put('employer', s.text.slice(0, cut), s.col);
    put('role', s.text.slice(cut + 1), s.col + cut + 1);
  }

  const offset = segs[li]!.col + segs[li]!.text.length;
  const tail = line.slice(offset);
  const m = ROW_TAIL.exec(tail);
  if (m?.groups && m.indices?.groups) {
    const g = m.groups;
    const ix = m.indices.groups;
    const mid = g.mid ?? '';
    const sal = SALARY_START.exec(mid);
    const midSegs = segments(mid);
    if (sal) {
      put('location', mid.slice(0, sal.index), offset + (midSegs[0]?.col ?? 0));
      put('salary', mid.slice(sal.index), offset + sal.index);
    } else if (midSegs.length >= 2) {
      for (const s of midSegs.slice(0, -1)) put('location', s.text, offset + s.col);
      put('salary', midSegs.at(-1)!.text, offset + midSegs.at(-1)!.col);
    } else if (midSegs[0]) {
      put('location', midSegs[0].text, offset + midSegs[0].col);
    }
    put('opens', g.open!, offset + ix.open![0]);
    put('closes', g.close!, offset + ix.close![0]);
    put('start', g.start!, offset + ix.start![0]);
    row.link = g.link;
    return row;
  }

  // Unexpected wording: fall back to the nearest header column for each run of text.
  for (const s of segments(tail)) {
    const col = offset + s.col;
    if (LINK_ONLY.test(s.text) && col >= cols.start) {
      row.link = s.text;
      continue;
    }
    put(nearest(col, cols, ['location', 'salary', 'opens', 'closes', 'start']), s.text, col);
  }
  return row;
}

function nearest(
  col: number,
  cols: Partial<Record<Field, number>>,
  fields: readonly Field[],
): Field {
  let best: Field = fields[0]!;
  let bestD = Infinity;
  for (const f of fields) {
    const c = cols[f];
    if (c === undefined) continue;
    const d = Math.abs(col - c);
    if (d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

/** Wrapped cell text on the lines under a row's first line. */
function continueRow(row: Row, line: string, head: Columns): void {
  const cols: Partial<Record<Field, number>> = {};
  for (const f of FIELDS) cols[f] = row.cols[f] ?? head[f];
  const segs = segments(line).flatMap((s) => {
    // 'Buckinghamshire, Cambridge, £28,808' and '2026 2026' are two cells.
    const parts: Seg[] = [];
    let col = s.col;
    for (const p of s.text.split(/ (?=£)| (?=(?:19|20)\d{2}$)/)) {
      parts.push({ col, text: p });
      col += p.length + 1;
    }
    return parts;
  });
  for (const s of segs) {
    if (YEAR.test(s.text)) {
      const bare = (['opens', 'closes', 'start'] as const).filter((f) => {
        const v = row.values[f];
        return v?.length === 1 && BARE_MONTH.test(v[0]!);
      });
      if (bare.length) {
        const f = nearest(s.col, cols, bare);
        row.values[f] = [`${row.values[f]![0]} ${s.text}`];
      }
      continue;
    }
    const f = s.text.startsWith('£')
      ? 'salary'
      : nearest(s.col, cols, [
          'employer',
          'role',
          'location',
          'salary',
          'opens',
          'closes',
          'start',
        ]);
    (row.values[f] ??= []).push(s.text);
  }
}

function parseTables(lines: string[]): VacancyEntry[] {
  const out: VacancyEntry[] = [];
  // The section heading is the line just above a table header; never wrapped cell text.
  const headingAbove = (i: number) => {
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) if (lines[j]!.trim()) return j;
    return -1;
  };
  const headings = new Set<number>();
  lines.forEach((l, i) => {
    if (TABLE_HEAD.test(l)) headings.add(headingAbove(i));
  });

  let cols: Columns | null = null;
  let section: string | null = null;
  let row: Row | null = null;
  const flush = () => {
    if (row) {
      const v = (f: Field) => (row!.values[f] ? joinWrapped(row!.values[f]!) : undefined);
      const employer = v('employer');
      const role = v('role');
      if (employer && role)
        out.push({
          section,
          employer: cleanEmployer(employer),
          role,
          level: row.level,
          location: v('location') ?? '',
          salary: v('salary'),
          opens: v('opens'),
          closes: v('closes'),
          start: v('start'),
          link: row.link,
        });
    }
    row = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (TABLE_HEAD.test(line)) {
      flush();
      cols = headerColumns(line, lines.slice(i + 1, i + 4));
      const h = headingAbove(i);
      if (h >= 0) section = collapseSpaces(lines[h]!);
      continue;
    }
    if (!cols) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    if (FOOTER.test(line)) {
      // End of the page's table; the next page repeats the header.
      flush();
      cols = null;
      continue;
    }
    if (PAGE_NUMBER.test(line) || headings.has(i)) {
      flush();
      continue;
    }
    if (/^\s*(?:Salary|Open\s+Close)\s*$/.test(line)) continue;
    const started = startRow(line, cols);
    if (started) {
      flush();
      row = started;
    } else if (row) {
      continueRow(row, line, cols);
    }
  }
  flush();
  return out;
}

/** Every vacancy entry in a listing's `pdftotext -layout` output (either layout). */
export function parseListing(text: string): VacancyEntry[] {
  const lines = text.replace(/\f/g, '\n').split('\n');
  const entries = [...parseTables(lines), ...parseCards(lines)];
  const seen = new Set<string>();
  return entries.filter((e) => {
    const k = e.link?.includes('/') ? e.link : `${e.employer}|${e.role}|${e.location}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** 'Higher and Degree Vacancy Listing: January 2026', else the upload folder or file name. */
export function editionOf(text: string, pdfUrl?: string): Edition | null {
  const head = new RegExp(`Vacancy Listing:\\s*(${MONTH})\\s+(\\d{4})`, 'i').exec(text);
  if (head)
    return { year: Number(head[2]), month: MONTHS.indexOf(head[1]!.slice(0, 3).toLowerCase()) + 1 };
  const file = pdfUrl
    ? new RegExp(`\\b(${MONTH})[a-z]*-[\\w-]*?(\\d{4})`, 'i').exec(pdfUrl.split('/').at(-1)!)
    : null;
  if (file)
    return { year: Number(file[2]), month: MONTHS.indexOf(file[1]!.slice(0, 3).toLowerCase()) + 1 };
  const folder = pdfUrl ? /\/uploads\/(\d{4})\/(\d{2})\//.exec(pdfUrl) : null;
  return folder ? { year: Number(folder[1]), month: Number(folder[2]) } : null;
}

/** 'May 2026' → {2026, 5}; a bare 'March' gets the year that puts it after the edition. */
export function monthOf(text: string | undefined, edition: Edition | null): Edition | null {
  const m = text ? new RegExp(`\\b(${MONTH})\\b(?:\\s+(\\d{4}))?`, 'i').exec(text) : null;
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1;
  if (m[2]) return { year: Number(m[2]), month };
  if (!edition) return null;
  return { year: month >= edition.month - 1 ? edition.year : edition.year + 1, month };
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Closing month → its last day (so we never close an advert early). */
function monthEnd(e: Edition | null): string | undefined {
  return e ? iso(e.year, e.month, new Date(Date.UTC(e.year, e.month, 0)).getUTCDate()) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Entries → listings

const TECH_WORDS =
  /\bdata\b|analy|digital|software|technolog|\bIT\b|cyber|\bAI\b|machine learning|artificial intelligence|computer|statistic|developer|devops|cloud|network/i;

/** Digital section, or a data/tech word in the role: the pipeline's classifier decides the rest. */
export function isWanted(e: VacancyEntry): boolean {
  if (e.section && /digital/i.test(e.section)) return true;
  if (TECH_WORDS.test(e.role)) return true;
  return classify({ title: e.role, knownApprenticeship: true }).relevant;
}

const SHORT_LINK = /^(?:https?:\/\/)?amapps\.uk\/[\w-]+\/?$/i;

/** The printed link as a URL ('amapps.uk/x' → 'https://amapps.uk/x'); null for emails. */
export function linkUrl(link: string | undefined): string | null {
  if (!link || (/@/.test(link) && !/^https?:/i.test(link))) return null;
  const url = /^https?:\/\//i.test(link) ? link : `https://${link}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

/** A specific vacancy page rather than a careers home page (job id, /jobs/, /vacancy/ …). */
export function looksLikeVacancy(url: string): boolean {
  try {
    const u = new URL(url);
    // Tracking tags ('utm_content=audit-digital-tech-app_apprentice…') say nothing about the page.
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    const rest = `${u.pathname}${u.search}`;
    return (
      rest.length > 1 &&
      /\d{3,}|job|vacanc|requisition|position|opening|posting|\/roles?\/|apply|opportunit/i.test(
        rest,
      )
    );
  } catch {
    return false;
  }
}

/** 'Bristol, Cambridge, Leeds' → three locations; 'National' → UK-wide. */
export function splitLocations(text: string): { locations: Location[]; isNational: boolean } {
  const t = collapseSpaces(text).replace(/[,;]\s*$/, '');
  if (!t) return { locations: [], isNational: false };
  if (/^(?:national(?:ly)?|nationwide|uk[- ]wide|across (?:the )?uk)$/i.test(t))
    return { locations: [], isNational: true };
  if (/^(?:multiple|various)(?: locations)?$/i.test(t)) return { locations: [], isNational: false };
  const parts = t
    .split(/\s*[,;/]\s*|\s+(?:and|or|&)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && parts.every((p) => p.split(/\s+/).length <= 4))
    return { locations: parts.map((p) => ({ text: p })), isNational: false };
  return { locations: [{ text: t }], isNational: false };
}

export function toRawListing(
  e: VacancyEntry,
  o: { pdfUrl: string; edition: Edition | null; resolved?: string | null },
): RawListing {
  const link = linkUrl(e.link);
  const url = o.resolved ?? link ?? o.pdfUrl;
  const proper = o.resolved
    ? looksLikeVacancy(o.resolved)
    : !!link && !SHORT_LINK.test(link) && looksLikeVacancy(link);
  const code = link && SHORT_LINK.test(link) ? link.replace(/\/$/, '').split('/').at(-1) : null;
  const { locations, isNational } = splitLocations(e.location);
  const closes = monthOf(e.closes, o.edition);
  const start = monthOf(e.start, o.edition);
  const opens = e.opens && !/^open(?:s)? now$|^now open$/i.test(e.opens) ? e.opens : undefined;
  return {
    source: 'amazing',
    sourceId: code ?? slugify(`${e.employer} ${e.role} ${e.location}`).slice(0, 120),
    url,
    // 'careers@neptunenorth.co.uk': the PDF's way to apply.
    applyUrl:
      e.link && !link && /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(e.link)
        ? `mailto:${e.link}`
        : undefined,
    title: e.role,
    employerName: e.employer,
    level: e.level,
    // '£27, 204 - £29, 859' (a stray space in the PDF) → '£27,204 - £29,859'.
    salaryText: e.salary?.replace(/(\d),\s+(\d{3})\b/g, '$1,$2'),
    closingDate: monthEnd(closes),
    startDate: start ? iso(start.year, start.month, 1) : undefined,
    locations,
    isNational: isNational || undefined,
    knownApprenticeship: true,
    isLead: !proper || undefined,
    details: {
      section: e.section ?? undefined,
      applicationsOpen: opens,
      closesText: e.closes && !closes ? e.closes : undefined,
      contact: e.link && !link ? e.link : undefined,
      shortLink: code ? link : undefined,
      listingPdf: o.pdfUrl,
    },
    raw: e,
  };
}

const Stored = z
  .object({
    url: z.string(),
    entries: z.number().optional(),
    listings: z.array(z.custom<RawListing>((v) => !!v && typeof v === 'object')),
  })
  .loose();
type Stored = z.infer<typeof Stored>;

/** One HEAD to the TinyURL-backed short link; its Location is the vacancy page. */
async function resolveShortLink(ctx: Ctx, url: string): Promise<string | null> {
  const res = await ctx.http.request(url, { method: 'HEAD', redirect: 'manual', robots: true });
  const to = res.headers.get('location');
  return res.status >= 300 && res.status < 400 && to ? new URL(to, url).toString() : null;
}

export const amazing: Source = {
  id: 'amazing',
  // Re-emitted daily from state, so "not seen" only means a newer edition dropped it.
  incremental: true,
  enabled: () => true,
  async run(ctx: Ctx): Promise<SourceResult> {
    const parsed = Stored.safeParse(await ctx.state.get(PARSED));
    const lastPdf = await ctx.state.get<string>(LAST_PDF);
    const lastCheck = await ctx.state.get<string>(LAST_CHECK);
    const stored = parsed.success && parsed.data.url === lastPdf ? parsed.data : null;
    const reuse = (stats: SourceResult['stats']): SourceResult => ({
      listings: stored?.listings ?? [],
      complete: false,
      stats: { pdf: lastPdf ?? 'none', fromState: stored?.listings.length ?? 0, ...stats },
    });

    if (lastCheck && stored && daysBetween(lastCheck, ctx.today) < CHECK_EVERY_DAYS) {
      return reuse({ checked: 'no', lastCheck });
    }

    let found: Awaited<ReturnType<typeof findCurrentPdf>>;
    try {
      found = await findCurrentPdf(ctx);
    } catch (err) {
      // Site down for a day: the stored edition is still the best we know, so keep emitting it.
      if (!stored) throw err;
      ctx.log.warn(`weekly check: ${(err as Error).message}`);
      return reuse({ checked: 'failed', error: (err as Error).message.slice(0, 200) });
    }
    const { url: pdfUrl, pages } = found;
    if (!pdfUrl) {
      // Page redesign or between editions: keep the last parse, look again tomorrow.
      ctx.log.warn('no listing PDF linked from the resource pages');
      return reuse({ checked: 'yes', pages, error: 'no PDF link found' });
    }
    if (stored && pdfUrl === stored.url) {
      await ctx.state.set(LAST_CHECK, ctx.today);
      return reuse({ checked: 'yes', pages, changed: 'no' });
    }

    ctx.log.info(`new listing PDF: ${pdfUrl}`);
    const text = await pdfToText(await ctx.http.bytes(pdfUrl, { robots: true, timeoutMs: 60_000 }));
    const entries = parseListing(text);
    if (!entries.length) throw new Error(`parsed 0 vacancies from ${pdfUrl}`);
    const edition = editionOf(text, pdfUrl);
    const wanted = entries.filter(isWanted);

    const listings: RawListing[] = [];
    let resolved = 0;
    let resolveErrors = 0;
    for (const e of wanted) {
      const link = linkUrl(e.link);
      let to: string | null = null;
      if (link && SHORT_LINK.test(link) && resolved + resolveErrors < MAX_RESOLVE) {
        try {
          to = await resolveShortLink(ctx, link);
          resolved++;
        } catch (err) {
          resolveErrors++;
          ctx.log.warn(`short link ${link}: ${(err as Error).message}`);
        }
      }
      listings.push(toRawListing(e, { pdfUrl, edition, resolved: to }));
    }

    await ctx.state.set(PARSED, {
      url: pdfUrl,
      entries: entries.length,
      listings,
    } satisfies Stored);
    await ctx.state.set(LAST_PDF, pdfUrl);
    await ctx.state.set(LAST_CHECK, ctx.today);
    return {
      listings,
      complete: false,
      stats: {
        pdf: pdfUrl,
        edition: edition ? iso(edition.year, edition.month, 1).slice(0, 7) : 'unknown',
        entries: entries.length,
        wanted: wanted.length,
        resolved,
        resolveErrors,
        pages,
      },
    };
  },
};

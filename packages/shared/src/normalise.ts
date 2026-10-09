const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  pound: '£',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  bull: '•',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const COMPANY_SUFFIX =
  /\b(ltd|limited|plc|llp|llc|inc|group|holdings|uk|u\.k\.|\(uk\)|the|co|company|corporation|corp)\b\.?/gi;

/** 'BAE Systems PLC' → 'bae systems'; 'FIRST RUNG LIMITED ' → 'first rung'. */
export function normaliseEmployerName(name: string): string {
  const n = decodeEntities(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\(uk\)/g, ' ')
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ');
  return collapseSpaces(n);
}

/** Tidy SHOUTY employer names for display: 'FIRST RUNG LIMITED' → 'First Rung Limited'. */
export function displayCase(s: string): string {
  const t = collapseSpaces(decodeEntities(s));
  if (t !== t.toUpperCase() || !/[A-Z]{4}/.test(t)) return t;
  return t
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Plc|Llp|Ltd|Uk|Nhs|Bt|Ai|It|Hr)\b/g, (w) => w.toUpperCase());
}

const EDGE_WORDS =
  /^(?:(?:apprenticeship|apprentice|programme|program|scheme)\s+)+|(?:\s+(?:apprenticeship|apprentice|programme|program|scheme))+$/g;

/** Title key for dedupe (PLAN.md §5.3): drop years, level tokens, punctuation, scheme words at the ends. */
export function normaliseTitle(title: string): string {
  let t = decodeEntities(title)
    .toLowerCase()
    .replace(/\b20\d\d\b/g, ' ')
    .replace(/\blevel\s*\d\b|\bl\d\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ');
  t = collapseSpaces(t);
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = collapseSpaces(t.replace(EDGE_WORDS, ''));
  }
  return t;
}

export interface Salary {
  min: number | null;
  max: number | null;
}

/**
 * Parse an annual salary from free text: '£20,400 a year', '19514.00 - 19514.00',
 * '£32073.00 to £39043.00', '£24k', '£450 a week'. Returns nulls for 'Competitive'.
 */
export function parseSalary(text: string | null | undefined): Salary {
  if (!text) return { min: null, max: null };
  const t = text.replace(/,(?=\d{3}\b)/g, '');
  let mult = 1;
  if (/\b(a|per|each)\s+week\b|\bweekly\b|\bp\.?w\b/i.test(t)) mult = 52;
  else if (/\b(a|per|each)\s+month\b|\bmonthly\b|\bp\.?c\.?m\b/i.test(t)) mult = 12;
  else if (/\b(an|per|each)\s+hour\b|\bhourly\b|\bp\.?h\b/i.test(t)) mult = 37.5 * 52;
  const nums: number[] = [];
  for (const m of t.matchAll(/£?\s?(\d+(?:\.\d+)?)\s*(k\b)?/gi)) {
    let n = Number(m[1]);
    if (m[2]) n *= 1000;
    n *= mult;
    if (n >= 5000 && n <= 250000) nums.push(Math.round(n));
  }
  if (!nums.length) return { min: null, max: null };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max: max !== min ? max : null };
}

export function slugify(s: string): string {
  return normaliseEmployerName(s).replace(/ /g, '-');
}

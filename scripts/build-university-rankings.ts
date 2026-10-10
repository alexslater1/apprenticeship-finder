// Builds config/university-rankings.json from the Complete University Guide league tables
// (overall, Computer Science, Mathematics: the departments data-science degrees sit in), mapped
// onto the names in config/universities.json. Run once a year, after the June release:
//   npx tsx scripts/build-university-rankings.ts
import { writeFileSync } from 'node:fs';
import { universityFromProvider } from '../packages/shared/src/universities.ts';

const UA =
  'apprenticeship-finder/0.1 (+https://github.com/alexslater1/apprenticeship-finder; personal non-commercial)';
const BASE = 'https://www.thecompleteuniversityguide.co.uk/league-tables/rankings';
const TABLES = { overall: '', computerScience: '/computer-science', mathematics: '/mathematics' } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** League-table rows carry the position (0-based) and the university's name. */
function parse(html: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of html.matchAll(/class="uni_lnk"[^>]*data-ga-lt-index="(\d+)"[^>]*data-ga-label="([^"]+)"/g)) {
    const name = m[2]!.replace(/&amp;/g, '&').replace(/&#39;|&#039;/g, "'");
    if (!out.has(name)) out.set(name, Number(m[1]) + 1);
  }
  return out;
}

const result: Record<string, Partial<Record<keyof typeof TABLES, number>>> = {};
const unmatched = new Set<string>();
let edition = '';
for (const [key, path] of Object.entries(TABLES) as Array<[keyof typeof TABLES, string]>) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  edition ||= /Rankings\s+(20\d\d)|League Tables\s+(20\d\d)/.exec(html)?.slice(1).find(Boolean) ?? '';
  const rows = parse(html);
  if (rows.size < 50) throw new Error(`${key}: only ${rows.size} rows; has the page changed?`);
  for (const [cugName, rank] of rows) {
    // CUG adds suffixes: 'London School of Economics and Political Science, University of London'.
    const name = universityFromProvider(cugName.replace(/\s*\(([^)]+)\)/, ' $1'));
    if (!name) {
      unmatched.add(cugName);
      continue;
    }
    (result[name] ??= {})[key] ??= rank;
  }
  await sleep(2000);
}

const sorted = Object.fromEntries(
  Object.entries(result).sort((a, b) => (a[1].overall ?? 999) - (b[1].overall ?? 999)),
);
writeFileSync(
  new URL('../config/university-rankings.json', import.meta.url),
  `${JSON.stringify(
    {
      $comment:
        'Positions in the Complete University Guide league tables (overall, Computer Science, Mathematics). Used for the university part of the match score. Rebuild yearly with scripts/build-university-rankings.ts.',
      source: 'https://www.thecompleteuniversityguide.co.uk/league-tables/rankings',
      edition,
      universities: sorted,
    },
    null,
    2,
  )}\n`,
);
console.log(`${Object.keys(sorted).length} universities (edition ${edition}); unmatched:`, [...unmatched]);

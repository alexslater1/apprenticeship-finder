import { classifiedSegments, extractSkills, MIN_SKILL_TEXT, withoutKnownSkills } from '@af/shared';
import { db, must } from '../db.ts';

/**
 * Skill tags for every stored listing. The daily scrape tags the listings it sees; this re-tags
 * the rest after config/skills.json changes (`cli reskill`).
 */

interface Row {
  id: string;
  description_text: string | null;
  skills: unknown;
}

async function allListings(columns: string, activeOnly = false): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 500) {
    let q = db()
      .from('listings')
      .select(columns)
      .order('id')
      .range(from, from + 499);
    if (activeOnly) q = q.eq('is_active', true);
    const page = must(await q, 'load listings') as unknown as Row[];
    out.push(...page);
    if (page.length < 500) return out;
  }
}

export async function reskill(
  opts: { dryRun?: boolean } = {},
): Promise<{ checked: number; changed: number }> {
  const rows = await allListings('id,description_text,skills');
  let changed = 0;
  for (const r of rows) {
    const skills = extractSkills(r.description_text);
    if (JSON.stringify(skills) === JSON.stringify(r.skills ?? null)) continue;
    changed++;
    if (!opts.dryRun)
      must(await db().from('listings').update({ skills }).eq('id', r.id), 'save skills');
  }
  return { checked: rows.length, changed };
}

const STOP = new Set(
  'a an and are as at be by can for from has have in into is it its of on or our that the their this to we will with you your all any more such other own new how what who which when where also not if than then so but'.split(
    ' ',
  ),
);
/** Words every advert uses: a phrase made only of these isn't a skill. */
const GENERIC = new Set(
  'about able across apply application apprentice apprenticeship apprenticeships business career company day develop development employer employers employment experience exciting full gain help including information job learn learning level looking need opportunity permanent practical professional programme qualification qualifications recognised requirements role skills solutions start study support team teams technical technology time tools training uk use using way well work working year years real world hands-on hands on value valuable range variety part great strong good excellent key wide high quality'.split(
    ' ',
  ),
);

/**
 * Phrases that keep turning up where adverts list requirements or training but match no skill:
 * two- and three-word phrases, and capitalised names mid-sentence (tools like "PowerShell").
 */
export async function skillCandidates(
  limit = 60,
): Promise<Array<{ phrase: string; employers: number; example: string }>> {
  const rows = (await allListings('id,description_text,employer_name', true)).filter(
    (r) => (r.description_text?.length ?? 0) >= MIN_SKILL_TEXT,
  ) as Array<Row & { employer_name: string }>;
  // Counted by employer: one employer's template repeated over 12 adverts is still one voice.
  const seen = new Map<string, { ids: Set<string>; example: string }>();
  const add = (phrase: string, employer: string, example: string) => {
    const e = seen.get(phrase) ?? { ids: new Set<string>(), example: example.slice(0, 140) };
    e.ids.add(employer);
    seen.set(phrase, e);
  };
  for (const r of rows) {
    const own = new Set(r.employer_name.toLowerCase().split(/\W+/));
    for (const seg of classifiedSegments(r.description_text!)) {
      if (seg.kind !== 'asked' && seg.kind !== 'taught') continue;
      const blanked = withoutKnownSkills(seg.text);
      for (const m of blanked.matchAll(
        /(?<=\w[\s,(]+)([A-Z][a-zA-Z+#]*[A-Z+#][a-zA-Z+#]*|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g,
      )) {
        const name = m[1]!;
        const lower = name.toLowerCase();
        if (!GENERIC.has(lower) && !STOP.has(lower) && !lower.split(' ').some((w) => own.has(w)))
          add(name, r.employer_name, seg.text);
      }
      const words = blanked
        .toLowerCase()
        .replace(/[^a-z0-9+#&|' -]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      for (let n = 2; n <= 3; n++)
        for (let i = 0; i + n <= words.length; i++) {
          const g = words.slice(i, i + n);
          if (g.includes('|') || STOP.has(g[0]!) || STOP.has(g[n - 1]!) || /^\d/.test(g[0]!))
            continue;
          if (g.every((w) => GENERIC.has(w) || STOP.has(w))) continue;
          add(g.join(' '), r.employer_name, seg.text);
        }
    }
  }
  const ranked = [...seen]
    .map(([phrase, e]) => ({
      phrase,
      employers: e.ids.size,
      key: [...e.ids].sort().join('|'),
      example: e.example,
    }))
    .filter((c) => c.employers >= 3)
    .sort((a, b) => b.employers - a.employers || b.phrase.length - a.phrase.length);
  // Drop a phrase inside a longer one said by the same employers ("security" in "security clearance").
  const kept = ranked.filter(
    (c) =>
      !ranked.some(
        (o) =>
          o !== c && o.key === c.key && o.phrase.toLowerCase().includes(c.phrase.toLowerCase()),
      ),
  );
  return kept
    .slice(0, limit)
    .map(({ phrase, employers, example }) => ({ phrase, employers, example }));
}

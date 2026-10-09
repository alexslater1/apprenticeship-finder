import universitiesJson from '../../../config/universities.json';
import { decodeEntities } from './normalise.ts';

interface UniversitySpec {
  name: string;
  aliases?: string[];
  acronyms?: string[];
  caseSensitive?: boolean;
}

interface Matcher {
  name: string;
  /** For advert text: names (case per spec) and acronyms (always case-sensitive). */
  text: RegExp[];
  /** For training-provider names, which are often SHOUTY ('UNIVERSITY OF EXETER'). */
  provider: RegExp;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[’']/g, "['’]?");
const phrase = (s: string) => esc(s).replace(/\s+/g, '\\s+').replace(/,/g, ',?');
const anyOf = (xs: string[]) => `\\b(?:${xs.join('|')})\\b`;

const matchers: Matcher[] = (
  universitiesJson as { universities: UniversitySpec[] }
).universities.map((u) => {
  const names = anyOf([u.name, ...(u.aliases ?? [])].map(phrase));
  const text = [new RegExp(names, u.caseSensitive ? 'g' : 'gi')];
  if (u.acronyms?.length) text.push(new RegExp(anyOf(u.acronyms.map(esc)), 'g'));
  return { name: u.name, text, provider: new RegExp(names, 'gi') };
});

interface Hit {
  name: string;
  start: number;
  end: number;
}

function hits(text: string, pick: (m: Matcher) => RegExp[]): Hit[] {
  const all: Hit[] = [];
  for (const m of matchers)
    for (const re of pick(m))
      for (const x of text.matchAll(re))
        all.push({ name: m.name, start: x.index, end: x.index + x[0].length });
  // Longest first, so 'Queen Mary University of London' beats a shorter overlapping name.
  all.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Hit[] = [];
  for (const h of all) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  return kept.sort((a, b) => a.start - b.start);
}

/** The university a training-provider name refers to ('Bpp University Limited' → 'BPP University'). */
export function universityFromProvider(provider: string | null | undefined): string | null {
  if (!provider) return null;
  return hits(decodeEntities(provider), (m) => [m.provider])[0]?.name ?? null;
}

/**
 * The university an apprenticeship is attached to: the training provider if it is one, else the
 * university the advert names most often (earliest on a tie). The employer's own name is ignored
 * so a university hiring an apprentice isn't mistaken for the degree partner.
 */
export function findUniversity(input: {
  provider?: string | null;
  employer?: string | null;
  texts: Array<string | null | undefined>;
}): string | null {
  const fromProvider = universityFromProvider(input.provider);
  if (fromProvider) return fromProvider;
  const employerUni = universityFromProvider(input.employer);
  const counts = new Map<string, number>();
  for (const t of input.texts) {
    if (!t) continue;
    for (const h of hits(decodeEntities(t), (m) => m.text)) {
      if (h.name === employerUni) continue;
      counts.set(h.name, (counts.get(h.name) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  for (const [name, n] of counts) if (best === null || n > counts.get(best)!) best = name;
  return best;
}

import skillsJson from '../../../config/skills.json';

/**
 * Skills mentioned in an advert (Alex, 10 Oct: rank every skill across the adverts, weighted by
 * how well each advert matches). The dictionary lives in config/skills.json; this tags an advert's
 * text with the skills it mentions and whether it asks for each one, says it will teach it, or
 * just lists it as part of the job.
 */

export type SkillCategory = 'technical' | 'tools' | 'knowledge' | 'personal';

/** asked: a requirement ("you'll need…"); taught: training ("you'll learn…"); job: a duty. */
export type SkillContext = 'asked' | 'taught' | 'job';

export interface SkillDef {
  id: string;
  label: string;
  category: SkillCategory;
  blurb?: string;
  patterns: string[];
  caseSensitive?: boolean;
}

export interface SkillMention {
  id: string;
  /** Strongest context across the advert: asked beats taught beats job. */
  ctx: SkillContext;
  /** The sentence that best shows it (for the detail panel). */
  quote: string;
}

const config = skillsJson as unknown as {
  categories: Record<SkillCategory, string>;
  skills: SkillDef[];
};

export const SKILLS: SkillDef[] = config.skills;
export const SKILL_CATEGORIES = config.categories;
export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(
  SKILLS.map((s) => [s.id, s]),
);

const matchers = SKILLS.map((s) => ({
  id: s.id,
  re: new RegExp(s.patterns.join('|'), s.caseSensitive ? 'g' : 'gi'),
}));

/** Adverts shorter than this are summaries (Adzuna, the PDF): too little to judge skills on. */
export const MIN_SKILL_TEXT = 700;

// Cues near a mention that say which kind it is. A mention under a company blurb or the benefits
// is dropped ("our commitment to excellence" isn't asking him for commitment).
const CUES: Array<[Cue['kind'], RegExp]> = [
  [
    'taught',
    /\b(?:learn(?:s|ing|t)?|taught|teach(?:es|ing)?|training(?! (?:courses? (?:in|on)|provider))|trained|you(?:'|’)?ll (?:gain|develop|build|study|get)(?: (?:[\w-]+ ){0,2}(?:experience|knowledge|skills|exposure|insight|understanding)(?: (?:in|of|with|using|across|working with))?)?|you will (?:gain|develop|build|study|get)(?: (?:[\w-]+ ){0,2}(?:experience|knowledge|skills|exposure|insight|understanding)(?: (?:in|of|with|using|across|working with))?)?|gain(?:ing)? (?:[\w-]+ ){0,2}(?:experience|knowledge|skills|exposure|insight|understanding)(?: (?:in|of|with|using|across|working with))?|develop(?:ing)? (?:your|new|the|technical|core|both|skills|knowledge|expertise|competence)|build(?:ing)? (?:your |new |strong )?(?:technical )?(?:skills|knowledge|expertise|understanding)|stud(?:y|ying) towards|modules?|curriculum|(?:will be|is) provided|introduced? (?:you )?to|exposure to|grow your|we(?:'|’)?ll (?:help|teach|train|support)|support you to|equips? (?:you|learners)|no (?:prior |previous )?experience (?:is )?(?:needed|necessary|required)|do not need to have|don(?:'|’)?t need (?:to have|any))\b/gi,
  ],
  [
    'asked',
    /\b(?:you(?:'|’)?ll need|you will need|you need|we need|need(?:s)? to (?:be|have|show|demonstrate)|must(?: be| have)?|essential|(?:skills|experience|knowledge) required|requirements|(?:we(?:'|’)?re|we are|is|are currently) looking for|looking for (?:someone|a candidate|candidates|people|individuals|an? (?:enthusiastic|motivated|talented|curious|proactive|driven|bright))|seeking|ideal(?:ly)?|desirable|preferred|you (?:have|bring|are|can)|you(?:'|’)?re|someone (?:who|with)|experience (?:with|of|in|using)|ability to|able to|strong|excellent|good|proven|demonstrat\w*|knowledge of|understanding of|comfortable|proficien\w*|familiar\w*|confident|would be (?:useful|beneficial|an advantage|a plus|great)|advantage(?:ous)?|a bonus|about you|person specification|who you are|qualities|things to consider|skills (?:and|&) (?:experience|abilities|attributes)|what you(?:'|’)?ll bring|what we want|required skills|skills needed)\b/gi,
  ],
  [
    'job',
    /\b(?:what you(?:'|’)?ll (?:do|be doing)|what you will do|responsibilities|key tasks|duties|day[- ]to[- ]day|your role|the role|in this role|as an? [\w &-]+apprentice,? you(?:'|’)?ll|you will be (?:responsible|working|supporting|involved)|responsible for|accountabilities|purpose of the role|you(?:'|’)?ll (?:support|work|help|assist|be|contribute|join)|you will (?:support|work|help|assist|be|contribute|join))\b/gi,
  ],
  [
    'ignore',
    /\b(?:about (?:the employer|us|the company|the business|our (?:company|firm))|who we are|we are (?:a|an|the|one of)|we(?:'|’)?re (?:a|an|the|experts|one of)|is (?:a|an|the) (?:leading|global|world|uk|international|growing|award|specialist|well-established)|pride ourselves|our (?:mission|values|culture|purpose|clients include)|benefits|what we offer|we offer|rewards|equal opportunit\w*|diversity|inclusion|inclusive|disability confident|reasonable adjustments|after this apprenticeship|future prospects|the apprenticeship (?:route|programme) gives)\b/gi,
  ],
];

interface Cue {
  kind: SkillContext | 'ignore';
  at: number;
  end: number;
}

function cues(segment: string): Cue[] {
  const all: Cue[] = [];
  for (const [kind, re] of CUES)
    for (const m of segment.matchAll(re))
      all.push({ kind, at: m.index, end: m.index + m[0].length });
  // A cue inside a longer one doesn't count ("experience in" within "gain real-world experience in").
  return all
    .filter(
      (c) =>
        !all.some((o) => o !== c && o.at <= c.at && o.end >= c.end && o.end - o.at > c.end - c.at),
    )
    .sort((a, b) => a.at - b.at);
}

/** Lines, sentences and list items (some descriptions lose their line breaks, some keep them). */
export function segments(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) =>
      line
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?:;])\s+(?=[A-Z0-9•·\-–(])|\s*[•·▪●◦*]\s+|\s+[-–]\s+(?=[A-Z])/),
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lists of qualifications ("A levels in Maths, Physics or Computer Science") are entry
 * requirements, which the Grades column covers; skills named in them don't count. */
const QUALIFICATIONS =
  /\b(?:GCSEs?|A[- ]?levels?|UCAS|BTEC|Highers|T[- ]?levels?|International Baccalaureate|grades? [A-E*4-9]{1,4}\b)/i;

/** The cue that governs a mention at `at` in segment `i`: the nearest one before it in the same
 * sentence, else the last cue in the sentences just before (a list's heading: "What you'll
 * learn:"), else the first one after it in the sentence. */
function contextAt(segs: string[], segCues: Cue[][], i: number, at: number): Cue['kind'] {
  const own = segCues[i]!;
  const before = own.filter((c) => c.at <= at);
  if (before.length) return before[before.length - 1]!.kind;
  let back = 0;
  for (let j = i - 1; j >= Math.max(0, i - 12) && back < 1200; j--) {
    back += segs[j]!.length;
    const c = segCues[j]!;
    if (c.length) return c[c.length - 1]!.kind;
  }
  return own[0]?.kind ?? 'job';
}

const RANK: Record<SkillContext, number> = { asked: 2, taught: 1, job: 0 };

/** Every dictionary skill the advert mentions, with its strongest context. */
export function extractSkills(text: string | null | undefined): SkillMention[] | null {
  if (!text || text.length < MIN_SKILL_TEXT) return null;
  const segs = segments(text);
  const segCues = segs.map(cues);
  const found = new Map<string, SkillMention>();
  segs.forEach((seg, i) => {
    if (QUALIFICATIONS.test(seg)) return;
    for (const { id, re } of matchers) {
      re.lastIndex = 0;
      for (const m of seg.matchAll(re)) {
        // Opening questions ("Are you curious about AI?") describe interests, not requirements.
        const ctx = /\?\s*$/.test(seg)
          ? SKILL_BY_ID[id]!.category === 'personal'
            ? 'asked'
            : 'job'
          : contextAt(segs, segCues, i, m.index);
        if (ctx === 'ignore') continue;
        const prev = found.get(id);
        if (!prev || RANK[ctx] > RANK[prev.ctx])
          found.set(id, { id, ctx, quote: seg.length > 220 ? `${seg.slice(0, 217)}…` : seg });
      }
    }
  });
  return [...found.values()].sort(
    (a, b) => SKILLS.findIndex((s) => s.id === a.id) - SKILLS.findIndex((s) => s.id === b.id),
  );
}

/** Each sentence with the kind of section it sits in (for finding skills the dictionary lacks). */
export function classifiedSegments(text: string): Array<{ text: string; kind: Cue['kind'] }> {
  const segs = segments(text);
  const segCues = segs.map(cues);
  return segs.map((t, i) => ({
    text: t,
    kind: QUALIFICATIONS.test(t)
      ? 'ignore'
      : (segCues[i]![0]?.kind ?? contextAt(segs, segCues, i, 0)),
  }));
}

/** A sentence with every dictionary match blanked out. */
export function withoutKnownSkills(segment: string): string {
  let out = segment;
  for (const { re } of matchers) out = out.replace(re, ' | ');
  return out;
}

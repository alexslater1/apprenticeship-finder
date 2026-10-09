import keywordsJson from '../../../config/keywords.json';
import standardsJson from '../../../config/standards.json';
import type { RoleType, Standard } from './types.ts';

type PatternSpec = string | { re: string; cs?: boolean };
type LevelSpec = { re: string; cs?: boolean; group?: number; level?: number };

function compile(spec: PatternSpec): RegExp {
  return typeof spec === 'string' ? new RegExp(spec, 'i') : new RegExp(spec.re, spec.cs ? '' : 'i');
}

function compileAny(specs: PatternSpec[]): RegExp[] {
  return specs.map(compile);
}

export interface LevelRule {
  re: RegExp;
  group?: number;
  level?: number;
}

function compileLevel(specs: LevelSpec[]): LevelRule[] {
  return specs.map((s) => ({ re: compile(s), group: s.group, level: s.level }));
}

const k = keywordsJson as unknown as {
  apprenticeship: PatternSpec[];
  noise: { title: PatternSpec[]; graduateOnly: string };
  roles: Array<{ role: RoleType; patterns: PatternSpec[] }>;
  weakTitle: { role: RoleType; patterns: PatternSpec[]; exclude?: string };
  dataWords: string;
  level: { title: LevelSpec[]; text: LevelSpec[] };
  degree: { title: string; text: string };
  penalties: Array<{ re: string; points: number; label: string }>;
  points: {
    role: Record<RoleType | 'software_tech_data', number>;
    weakTitleRole: number;
    descriptionRoleFactor: number;
    level: Record<string, number>;
    degree: number;
    titleSpecific: number;
    larsKnown: number;
    freshDays: number;
    fresh: number;
    closingPassed: number;
    leadCap: number;
  };
  personal: { preferredLevel: number; preferredRole: number; withinDistance: number };
};

export const rules = {
  apprenticeship: compileAny(k.apprenticeship),
  noiseTitle: compileAny(k.noise.title),
  graduateOnly: new RegExp(k.noise.graduateOnly, 'i'),
  roles: k.roles.map((r) => ({ role: r.role, patterns: compileAny(r.patterns) })),
  weakTitle: {
    role: k.weakTitle.role,
    patterns: compileAny(k.weakTitle.patterns),
    exclude: k.weakTitle.exclude ? new RegExp(k.weakTitle.exclude, 'i') : null,
  },
  dataWords: new RegExp(k.dataWords, 'i'),
  levelTitle: compileLevel(k.level.title),
  levelText: compileLevel(k.level.text),
  degreeTitle: new RegExp(k.degree.title, 'i'),
  degreeText: new RegExp(k.degree.text, 'i'),
  penalties: k.penalties.map((p) => ({
    re: new RegExp(p.re, 'i'),
    points: p.points,
    label: p.label,
  })),
  points: k.points,
  personal: k.personal,
};

export const standards: Standard[] = (standardsJson as { standards: Standard[] }).standards;
const byLars = new Map(standards.map((s) => [s.lars, s]));

export function standardFor(lars: number | null | undefined): Standard | null {
  return lars ? (byLars.get(lars) ?? null) : null;
}

/** Skills England standard page, e.g. https://skillsengland.education.gov.uk/apprenticeships/st0585 */
export function standardUrl(ref: string): string {
  return `https://skillsengland.education.gov.uk/apprenticeships/${ref.toLowerCase()}`;
}

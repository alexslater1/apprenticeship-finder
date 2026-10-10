import { rules, standardFor } from './config.ts';
import {
  MIN_LEVEL,
  type Classification,
  type LevelSource,
  type RoleType,
  type RoleVia,
} from './types.ts';

export interface ClassifyInput {
  title: string;
  descriptionText?: string;
  level?: number;
  larsCode?: number;
  standardTitle?: string;
  roleHint?: string;
  knownApprenticeship?: boolean;
  knownDegree?: boolean;
}

const firstMatch = (res: RegExp[], text: string) => res.some((re) => re.test(text));

function roleFrom(text: string): RoleType | null {
  for (const r of rules.roles) if (firstMatch(r.patterns, text)) return r.role;
  return null;
}

function levelFrom(
  rulesList: typeof rules.levelTitle,
  text: string,
): { level: number; context: string } | null {
  for (const rule of rulesList) {
    const m = rule.re.exec(text);
    if (!m) continue;
    // The match plus what follows it (text rules use a lookahead for 'apprenticeship' etc).
    const context = text.slice(m.index, m.index + m[0].length + 60);
    if (rule.level) return { level: rule.level, context };
    if (rule.group) {
      const n = Number(m[rule.group]);
      if (n >= 2 && n <= 7) return { level: n, context };
    }
  }
  return null;
}

/**
 * A level read from the advert text. Below-minimum levels only count when the text says it's
 * the apprenticeship's level: 'a Level 3 qualification' is usually an entry requirement.
 */
function textLevelFrom(text: string): number | null {
  const hit = levelFrom(rules.levelText, text);
  if (!hit) return null;
  const what = /\b(apprenticeship|standard|qualification|degree)/i.exec(hit.context)?.[1];
  if (hit.level < MIN_LEVEL && !/apprenticeship|standard/i.test(what ?? '')) return null;
  return hit.level;
}

export function isApprenticeshipTitle(text: string): boolean {
  return firstMatch(rules.apprenticeship, text);
}

/** Returns the reason a title is noise (coach, assessor, graduate-only…), or null. */
export function noiseReason(title: string): string | null {
  for (const re of rules.noiseTitle) {
    const m = re.exec(title);
    if (m) return m[0].toLowerCase();
  }
  if (rules.graduateOnly.test(title) && !/apprentic/i.test(title)) return 'graduate scheme';
  return null;
}

export function classify(input: ClassifyInput): Classification {
  const title = input.title.trim();
  const text = input.descriptionText ?? '';
  const standard = standardFor(input.larsCode);
  const standardTitle = input.standardTitle ?? standard?.title ?? '';

  const isApprenticeship =
    !!input.knownApprenticeship ||
    isApprenticeshipTitle(title) ||
    (!!standardTitle && isApprenticeshipTitle(standardTitle));

  // Level: source > LARS > title > description.
  const titleLevel = levelFrom(rules.levelTitle, title)?.level ?? null;
  const textLevel = textLevelFrom(text);
  let level: number | null = null;
  let levelSource: LevelSource | null = null;
  if (input.level && input.level >= 2 && input.level <= 7) {
    level = input.level;
    levelSource = 'source';
  } else if (standard) {
    level = standard.level;
    levelSource = 'lars';
  } else if (titleLevel !== null) {
    level = titleLevel;
    levelSource = 'title';
  } else if (textLevel !== null) {
    level = textLevel;
    levelSource = 'text';
  }

  // Role: title > weak title ('data') > standard > description.
  let roleType: RoleType = 'other';
  let roleVia: RoleVia | null = null;
  const titleRole = roleFrom(title);
  if (titleRole) {
    roleType = titleRole;
    roleVia = 'title';
  } else if (firstMatch(rules.weakTitle.patterns, title) && !rules.weakTitle.exclude?.test(title)) {
    roleType = rules.weakTitle.role;
    roleVia = 'title_weak';
  } else if (standard && standard.role !== 'other') {
    roleType = standard.role;
    roleVia = 'standard';
  } else if (standardTitle && roleFrom(standardTitle)) {
    roleType = roleFrom(standardTitle)!;
    roleVia = 'standard';
  } else if (input.roleHint && roleFrom(input.roleHint)) {
    roleType = roleFrom(input.roleHint)!;
    roleVia = 'category';
  } else if (text) {
    const r = roleFrom(text);
    if (r && r !== 'software_tech') {
      roleType = r;
      roleVia = 'description';
    }
  }

  const dataWordsInText = rules.dataWords.test(text);

  let isDegree: boolean | null = null;
  if (input.knownDegree || standard?.degree) isDegree = true;
  else if (rules.degreeTitle.test(title)) isDegree = true;
  else if ((level ?? 0) >= 6 && rules.degreeText.test(text)) isDegree = true;
  else if (standard) isDegree = false;

  // Description-only role hits ("uses Google Analytics") aren't enough to keep a listing, and
  // levels 2–3 are out of scope altogether.
  const noise = noiseReason(title);
  const relevant =
    isApprenticeship &&
    !noise &&
    (level === null || level >= MIN_LEVEL) &&
    (!!standard || (roleVia !== null && roleVia !== 'description'));

  return {
    isApprenticeship,
    noise,
    level,
    levelSource,
    isDegree,
    roleType,
    roleVia,
    dataWordsInText,
    standard,
    relevant,
  };
}

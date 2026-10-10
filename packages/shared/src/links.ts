import { normaliseEmployerName } from './normalise.ts';

/**
 * Which link to send him to. Applications should go through the employer's own site (or its
 * applicant tracking system), or an official government service; job boards and copy-sites
 * (JobLeads, StudySmarter, Jobrapido…) come last because they often want a sign-up first or have
 * gone stale.
 */
export type LinkKind = 'official' | 'government' | 'provider' | 'board' | 'third_party';

export const LINK_RANK: Record<LinkKind, number> = {
  official: 0,
  government: 1,
  provider: 2,
  board: 3,
  third_party: 4,
};

/** Employers' applicant tracking systems: applying here is applying to the employer. */
const ATS =
  /(myworkdayjobs|myworkdaysite|successfactors|jobs2web|oraclecloud|avature|tal\.net|eightfold\.ai|greenhouse\.io|lever\.co|ashbyhq|smartrecruiters|workable|teamtailor|recruitee|personio|pinpointhq|icims|taleo|csod|applicationtrack|ambertrack|brassring|dayforcehcm|kallidus|tribepad|pageuppeople|njoyn|jobtrain|eploy|current-vacancies|hirehive|jobvite|recruitive|groupgti|harbourats|clinch|attrax|recsolu|tazio)\b/i;

/** Official public services where you genuinely apply (gov.uk Find an apprenticeship, NHS Jobs…). */
const GOVERNMENT =
  /(^|\.)(gov\.uk|mod\.uk|nhs\.uk|gov\.scot|gov\.wales|police\.uk)$|(^|\.)(apprenticeships\.scot|careerswales\.gov\.wales|jobapplyni\.com|myworldofwork\.co\.uk)$/i;

/** Training providers that recruit for employers (the employer hires through them). */
const PROVIDERS =
  /(^|\.)(qa\.com|nowskills\.co\.uk|thecodersguild\.org\.uk|kaplanapprenticeships\.co\.uk|multiverse\.io|baltictraining\.com|justit\.co\.uk|firebrand\.training|corndel\.com|apprentify\.com|cambridgespark\.com|lifetimetraining\.co\.uk|bpp\.com|avado\.com|itecskills\.co\.uk|estio\.co\.uk|paragonskills\.co\.uk|learningcurvegroup\.co\.uk|ac\.uk)$/i;

/** Apprenticeship boards we collect from: real adverts, but not the employer's own page. */
const BOARDS =
  /(^|\.)(higherin\.com|notgoingtouni\.co\.uk|reed\.co\.uk|adzuna\.co\.uk|amazingapprenticeships\.com|getmyfirstjob\.co\.uk|ratemyapprenticeship\.co\.uk)$/i;

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

/** Distinctive words of an employer name to look for in a host ('thales', 'lloyds'…). */
function nameWords(employer: string): string[] {
  const norm = normaliseEmployerName(employer);
  const words = norm
    .split(' ')
    .filter(
      (w) =>
        w.length >= 4 &&
        !/^(bank|group|services|systems|careers|jobs|international|global|digital|consulting|solutions|limited|the|and)$/.test(
          w,
        ),
    );
  const joined = norm.replace(/\s+/g, '');
  return [...new Set([...words, ...(joined.length >= 4 ? [joined] : [])])];
}

/**
 * What kind of site a link is. `employer` lets a careers site on the employer's own domain count
 * as official ('careers.thalesgroup.com' for Thales); `employerHosts` adds the watchlist's known
 * careers hosts.
 */
export function linkKind(url: string, employer?: string, employerHosts: string[] = []): LinkKind {
  const h = host(url);
  if (!h) return 'third_party';
  // Higherin's apply button forwards straight to the employer's application page.
  if (/^higherin\.com$/.test(h) && /^\/redirect\b/.test(new URL(url).pathname)) return 'official';
  if (ATS.test(h)) return 'official';
  if (employerHosts.some((e) => h === e || h.endsWith(`.${e}`))) return 'official';
  if (GOVERNMENT.test(h)) return 'government';
  if (PROVIDERS.test(h)) return 'provider';
  if (BOARDS.test(h)) return 'board';
  if (employer && nameWords(employer).some((w) => h.replace(/[-.]/g, '').includes(w)))
    return 'official';
  return 'third_party';
}

export interface RankedLink {
  url: string;
  kind: LinkKind;
  host: string;
}

/** Every link a listing has, best first (official, government, provider, board, third party). */
export function rankLinks(
  r: {
    apply_url: string | null;
    url: string;
    employer_name: string;
    sources?: Array<{ source: string; url: string; dead?: boolean }>;
  },
  employerHosts: string[] = [],
): RankedLink[] {
  // A link found dead on any source is dead wherever it appears.
  const seen = new Set<string>((r.sources ?? []).filter((s) => s.dead).map((s) => s.url));
  const out: RankedLink[] = [];
  const add = (url: string | null | undefined) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, kind: linkKind(url, r.employer_name, employerHosts), host: host(url) });
  };
  // Employer sources first: their link is the employer's own job page.
  for (const s of r.sources ?? []) if (s.source.startsWith('employer:') && !s.dead) add(s.url);
  add(r.apply_url);
  for (const s of r.sources ?? []) if (!s.dead) add(s.url);
  add(r.url);
  return out.sort((a, b) => LINK_RANK[a.kind] - LINK_RANK[b.kind]);
}

export function hostOf(url: string): string {
  return host(url);
}

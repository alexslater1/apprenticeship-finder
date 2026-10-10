import { decodeEntities } from '@af/shared';
import type { Http } from '../http.ts';
import { CONNECTORS } from './index.ts';

export interface Detection {
  connector: string;
  config: Record<string, unknown>;
  /** The URL the detection came from (the page itself, or an ATS link on it). */
  via: string;
}

const GENERIC = new Set(['jsonld', 'pagehash', 'manual']);
const ATS_HOST =
  /myworkdayjobs\.com|myworkdaysite\.com|successfactors\.(?:eu|com)|jobs2web\.com|oraclecloud\.com|avature\.net|tal\.net|eightfold\.ai|greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|teamtailor\.com|recruitee\.com|personio\.(?:de|com)|pinpointhq\.com|icims\.com|taleo\.net|csod\.com/i;

/** Which connector a URL (+ its HTML) belongs to, without fetching anything. */
export function detectFrom(url: string, html?: string): Detection | null {
  for (const c of CONNECTORS) {
    if (GENERIC.has(c.id) || !c.detect) continue;
    const config = c.detect(url, html);
    if (config) return { connector: c.id, config: dropUndefined(config), via: url };
  }
  return null;
}

const dropUndefined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Links on a page that point at a known ATS host (careers pages usually link their real board). */
export function atsLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]!), base).toString();
      if (ATS_HOST.test(new URL(u).hostname)) out.add(u);
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

/**
 * Detect the job platform behind a careers URL (detect-ats CLI, Add company): the URL itself,
 * then the page after redirects, then ATS links on the page. Null means "watch the page for
 * changes" (pagehash) is the best we can do.
 */
export async function detectConnector(http: Http, url: string): Promise<Detection | null> {
  const direct = detectFrom(url);
  if (direct && direct.connector !== 'successfactors') return direct;
  const res = await http.request(url, { robots: true });
  const page = detectFrom(res.url, res.body);
  if (page) return page;
  for (const link of atsLinks(res.body, res.url)) {
    const d = detectFrom(link);
    if (d) return { ...d, via: link };
  }
  return null;
}

import { hostOf } from '@af/shared';
import { db, must } from '../db.ts';
import { BlockedError, HttpError } from '../http.ts';
import type { Ctx } from '../types.ts';
import { htmlToText } from './normalise.ts';

/**
 * Dead-link checks (Alex, 10 Oct: "some links say job not found"). Sources that sync their whole
 * board daily (FAA, Higherin, employer sites) close listings themselves; adverts that only come
 * from searches (Google Jobs, web search, Reed, Not Going To Uni, Adzuna, the PDF) are checked
 * here a few at a time, at most every few days each. A link that 404s, says the job is gone, or
 * redirects to a generic page is marked dead; a listing whose links are all dead is closed.
 */

// Adzuna's site refuses automated requests, so its links can't be checked (they expire with the ad).
const CHECKED_SOURCES = ['google_jobs', 'web_search', 'reed', 'ngtu', 'amazing'];
const PER_RUN = 40;
const RECHECK_DAYS = 3;

/** Sites that refuse automated requests (403 to everyone) or whose terms say not to fetch. */
const UNCHECKABLE =
  /(^|\.)(adzuna\.co\.uk|linkedin\.com|indeed\.com|indeed\.co\.uk|glassdoor\.co\.uk|glassdoor\.com|jobleads\.com|totaljobs\.com|higherin\.com)$/;

const GONE =
  /\b(job|vacancy|position|role|advert|posting|opportunity|listing|page)\b[^.]{0,40}\b(not found|no longer (?:available|exists|accepting|open|live|active|advertised)|has (?:expired|closed|been filled|been removed|ended)|is (?:closed|no longer available))|\bthis (?:job|vacancy|role|position|apprenticeship) (?:is )?(?:now )?(?:closed|expired|unavailable)|\bsorry,? (?:this|the|that) (?:job|page|vacancy|role)\b|\bpage not found\b|\b404\b[^.]{0,20}not found/i;

export type LinkStatus = 'ok' | 'dead' | 'unknown';

/** Does this response say the job has gone? */
export function looksGone(url: string, finalUrl: string, status: number, html: string): boolean {
  if (status === 404 || status === 410) return true;
  const text = htmlToText(
    html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '),
  ).slice(0, 30_000);
  if (GONE.test(text)) return true;
  // A job link that lands on a home or search page means the job went away.
  try {
    const from = new URL(url);
    const to = new URL(finalUrl);
    const hadId = /\d{4,}|\/job[s]?\/[^/]+/.test(from.pathname + from.search);
    const generic =
      to.pathname === '/' || /^\/(jobs?|careers?|search|vacancies)\/?$/i.test(to.pathname);
    if (hadId && generic && from.href !== to.href) return true;
  } catch {
    /* not a URL */
  }
  return false;
}

export async function checkLink(ctx: Ctx, url: string): Promise<LinkStatus> {
  if (UNCHECKABLE.test(hostOf(url))) return 'unknown';
  try {
    const res = await ctx.http.request(url, { robots: true, retries: 1, timeoutMs: 15_000 });
    return looksGone(url, res.url, res.status, res.body) ? 'dead' : 'ok';
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 410)) return 'dead';
    if (err instanceof BlockedError) return 'unknown';
    return 'unknown';
  }
}

interface Row {
  listing_id: string;
  source: string;
  source_id: string;
  url: string;
  link_status: LinkStatus | null;
}

/** Check a batch of links and close listings whose every link is dead. */
export async function checkLinks(
  ctx: Ctx,
): Promise<{ checked: number; dead: number; closed: number }> {
  const cutoff = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const due = must<Row[]>(
    await db()
      .from('listing_sources')
      .select('listing_id,source,source_id,url,link_status,listings!inner(is_active)')
      .eq('listings.is_active', true)
      .in('source', CHECKED_SOURCES)
      .or(`link_checked_at.is.null,link_checked_at.lt.${cutoff}`)
      .order('link_checked_at', { ascending: true, nullsFirst: true })
      .limit(PER_RUN),
    'links due a check',
  );
  let dead = 0;
  const touched = new Set<string>();
  for (const r of due) {
    const status = await checkLink(ctx, r.url);
    if (status === 'dead') {
      dead++;
      ctx.log.info(`dead link (${r.source}): ${r.url}`);
    }
    touched.add(r.listing_id);
    if (!ctx.dryRun)
      must(
        await db()
          .from('listing_sources')
          .update({ link_status: status, link_checked_at: new Date().toISOString() })
          .eq('source', r.source)
          .eq('source_id', r.source_id),
        'save link status',
      );
  }
  if (ctx.dryRun || !touched.size) return { checked: due.length, dead, closed: 0 };

  // Close listings where every link we hold is dead (sources that sync in full close their own).
  const all = must<Array<{ listing_id: string; link_status: string | null; source: string }>>(
    await db()
      .from('listing_sources')
      .select('listing_id,link_status,source')
      .in('listing_id', [...touched]),
    'listing links',
  );
  const byListing = new Map<string, Array<{ link_status: string | null; source: string }>>();
  for (const x of all) byListing.set(x.listing_id, [...(byListing.get(x.listing_id) ?? []), x]);
  const gone = [...byListing]
    .filter(([, links]) => links.every((l) => l.link_status === 'dead'))
    .map(([id]) => id);
  if (gone.length)
    must(
      await db()
        .from('listings')
        .update({ is_active: false, closed_reason: 'link_dead' })
        .in('id', gone),
      'close dead listings',
    );
  return { checked: due.length, dead, closed: gone.length };
}

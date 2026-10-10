import { hostOf } from '@af/shared';
import { db, must } from '../db.ts';
import { BlockedError, HttpError } from '../http.ts';
import type { Ctx } from '../types.ts';
import { htmlToText } from './normalise.ts';

/**
 * Dead-link checks (Alex, 10 Oct: "some links say job not found"). Sources that sync their whole
 * board daily (FAA, Higherin, employer sites) close listings themselves; adverts that only come
 * from searches (Google Jobs, web search, Reed, Not Going To Uni, the PDF) are checked here a few
 * at a time, at most every few days each. A link that 404s, says the job is gone, or redirects to
 * a generic page is marked dead; a listing whose links are all dead is closed.
 *
 * Two more checks (Alex, 10 Oct: closed jobs still showing):
 * - Apply links: a board can keep an advert up after the employer or training provider closed
 *   it (Grosvenor on Higherin and Not Going To Uni, closed on QA's site). When a source's own
 *   Apply link says the job has gone, the listing closes, unless the employer's site or Find an
 *   Apprenticeship (which close their own adverts) still list it.
 * - Adzuna: its site refuses automated requests, so ask its API whether the ad is still listed.
 */

// Adzuna's site refuses automated requests, so its links are checked through its API instead.
const CHECKED_SOURCES = ['google_jobs', 'web_search', 'reed', 'ngtu', 'amazing'];
/** Sources whose Apply link goes somewhere else (the employer, a training provider). */
const APPLY_SOURCES = ['ngtu', 'reed', 'amazing', 'google_jobs', 'web_search'];
/** Sources that close their own adverts: while one of them still lists a job, it's open. */
const AUTHORITATIVE = (source: string) => source === 'faa' || source.startsWith('employer:');
const PER_RUN = 40;
const APPLY_PER_RUN = 25;
const ADZUNA_PER_RUN = 15;
const RECHECK_DAYS = 3;
const ADZUNA_API = 'https://api.adzuna.com/v1/api/jobs/gb/search/1';

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

/** The job page behind an application-form link ('…/jobs/8498556-data-analyst/applications/new'). */
export function jobPageOf(url: string): string {
  return url
    .replace(/\/applications?\/new\b.*$/i, '')
    .replace(/\/apply(?:\/?|\?.*)$/i, '')
    .replace(/[?&]promotion=[^&]*$/i, '');
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

/**
 * Is this Adzuna ad still listed? Search its title over the last four months and look for its
 * id. Only a search small enough to see every result can say it's gone. Adzuna drops and
 * re-posts ads, so this only closes listings Adzuna is the sole source of.
 */
export async function adzunaListed(
  ctx: Ctx,
  ad: { sourceId: string; title: string },
): Promise<LinkStatus> {
  if (!ctx.env.ADZUNA_APP_ID || !ctx.env.ADZUNA_APP_KEY) return 'unknown';
  const words = (s: string) =>
    s
      .replace(/[^\p{L}\p{N}&' ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  // Every word of the title (a phrase or title-only search misses ads Adzuna still lists).
  const params = new URLSearchParams({
    app_id: ctx.env.ADZUNA_APP_ID,
    app_key: ctx.env.ADZUNA_APP_KEY,
    what_and: words(ad.title),
    max_days_old: '120',
    results_per_page: '50',
  });
  try {
    const body = (await ctx.http.json(`${ADZUNA_API}?${params}`)) as {
      count?: number;
      results?: Array<{ id?: string | number }>;
    };
    const ids = new Set((body.results ?? []).map((r) => String(r.id)));
    if (ids.has(ad.sourceId)) return 'ok';
    return (body.count ?? 0) <= 50 ? 'dead' : 'unknown';
  } catch {
    return 'unknown'; // Adzuna answers 503 when asked too often; try again another day
  }
}

/** Check a batch of links and close listings whose every link is dead. */
export async function checkLinks(
  ctx: Ctx,
): Promise<{ checked: number; dead: number; closed: number; applyClosed: number }> {
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

  // Adzuna ads, through the API.
  const adzunaDue = must<Array<Row & { raw: { title?: string } | null }>>(
    await db()
      .from('listing_sources')
      .select('listing_id,source,source_id,url,link_status,raw,listings!inner(is_active)')
      .eq('listings.is_active', true)
      .eq('source', 'adzuna')
      .or(`link_checked_at.is.null,link_checked_at.lt.${cutoff}`)
      .order('link_checked_at', { ascending: true, nullsFirst: true })
      .limit(ADZUNA_PER_RUN),
    'Adzuna ads due a check',
  );
  for (const r of adzunaDue) {
    if (!r.raw?.title) continue;
    const status = await adzunaListed(ctx, {
      sourceId: r.source_id,
      title: r.raw.title,
    });
    if (status === 'dead') {
      dead++;
      ctx.log.info(`Adzuna no longer lists ${r.source_id} (${r.raw.title})`);
    }
    touched.add(r.listing_id);
    if (!ctx.dryRun)
      must(
        await db()
          .from('listing_sources')
          .update({ link_status: status, link_checked_at: new Date().toISOString() })
          .eq('source', r.source)
          .eq('source_id', r.source_id),
        'save Adzuna status',
      );
  }

  // Where the Apply buttons go.
  const applyDue = must<Array<Row & { apply_url: string }>>(
    await db()
      .from('listing_sources')
      .select('listing_id,source,source_id,url,link_status,apply_url,listings!inner(is_active)')
      .eq('listings.is_active', true)
      .in('source', APPLY_SOURCES)
      .not('apply_url', 'is', null)
      .or(`apply_checked_at.is.null,apply_checked_at.lt.${cutoff}`)
      .order('apply_checked_at', { ascending: true, nullsFirst: true })
      .limit(APPLY_PER_RUN),
    'apply links due a check',
  );
  const applyDead = new Set<string>();
  for (const r of applyDue) {
    const target = jobPageOf(r.apply_url);
    const status = /(^|\.)higherin\.com$/.test(hostOf(target))
      ? 'unknown' // robots.txt asks us not to follow Higherin's redirects
      : await checkLink(ctx, target);
    if (status === 'dead') {
      applyDead.add(r.listing_id);
      ctx.log.info(`closed at the application page (${r.source}): ${target}`);
    }
    if (!ctx.dryRun)
      must(
        await db()
          .from('listing_sources')
          .update({ apply_status: status, apply_checked_at: new Date().toISOString() })
          .eq('source', r.source)
          .eq('source_id', r.source_id),
        'save apply status',
      );
  }

  if (ctx.dryRun || (!touched.size && !applyDead.size))
    return {
      checked: due.length + adzunaDue.length + applyDue.length,
      dead,
      closed: 0,
      applyClosed: 0,
    };

  // Close listings where every link we hold is dead (sources that sync in full close their own).
  const all = !touched.size
    ? []
    : must<Array<{ listing_id: string; link_status: string | null; source: string }>>(
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

  // Closed where you'd apply, and no source that closes its own adverts still has it.
  let applyClosed = 0;
  if (applyDead.size) {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const srcs = must<Array<{ listing_id: string; source: string; last_seen_at: string }>>(
      await db()
        .from('listing_sources')
        .select('listing_id,source,last_seen_at')
        .in('listing_id', [...applyDead]),
      'apply-closed listing sources',
    );
    const keep = new Set(
      srcs
        .filter((x) => AUTHORITATIVE(x.source) && x.last_seen_at >= recent)
        .map((x) => x.listing_id),
    );
    const close = [...applyDead].filter((id) => !keep.has(id));
    if (close.length)
      must(
        await db()
          .from('listings')
          .update({ is_active: false, closed_reason: 'apply_closed' })
          .in('id', close),
        'close listings closed at the application page',
      );
    applyClosed = close.length;
  }
  return {
    checked: due.length + adzunaDue.length + applyDue.length,
    dead,
    closed: gone.length,
    applyClosed,
  };
}

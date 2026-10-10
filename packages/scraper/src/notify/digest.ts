import { mkdirSync, writeFileSync } from 'node:fs';
import {
  MIN_LEVEL,
  daysBetween,
  excludedByPrefs,
  londonToday,
  matchTier,
  nearestMiles,
  personalScore,
  type ListingRow,
  type SettingsRow,
} from '@af/shared';
import { db, must } from '../db.ts';
import { env, REPO_ROOT } from '../env.ts';
import { logger } from '../log.ts';
import { canSend, recipients, sendMail, type Mail } from './email.ts';

/** Daily email (PLAN.md §9.3): new matches, closing-soon reminders, opened employers, health. */

export interface DigestItem {
  id: string;
  title: string;
  employer: string;
  place: string;
  level: string;
  university: string | null;
  salary: string | null;
  closing: string | null;
  daysToClose: number | null;
  score: number;
  status: ListingRow['status'];
  preRegister: boolean;
  adzunaOnly: boolean;
  dashboardUrl: string;
  applyUrl: string;
}

export interface DigestData {
  today: string;
  since: string | null;
  minScore: number;
  newMatches: DigestItem[];
  newBelowThreshold: number;
  closingSoon: DigestItem[];
  openedEmployers: Array<{ name: string; url: string | null }>;
  /** Discovery: companies watched automatically since the last email, and how many await a tap. */
  newCompanies: { auto: string[]; pending: number };
  health: string[];
  dashboardUrl: string;
}

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function toItem(r: ListingRow, score: number, today: string, dashboard: string): DigestItem {
  const cities = [...new Set((r.locations ?? []).map((l) => l.city).filter(Boolean))];
  const place = r.is_national
    ? 'Nationwide'
    : cities.length > 1
      ? `${cities[0]} +${cities.length - 1}`
      : (r.primary_city ?? (r.nation !== 'Unknown' ? r.nation : 'Location unknown'));
  return {
    id: r.id,
    title: r.title,
    employer: r.employer_name,
    place,
    level: r.level ? `L${r.level}${r.is_degree ? ' degree' : ''}` : r.is_degree ? 'Degree' : '',
    university: r.university,
    salary:
      r.salary_min && r.salary_max
        ? `${gbp.format(r.salary_min)}–${gbp.format(r.salary_max)}`
        : r.salary_min
          ? gbp.format(r.salary_min)
          : null,
    closing: r.closing_date,
    daysToClose: r.closing_date ? daysBetween(today, r.closing_date) : null,
    score,
    status: r.status,
    preRegister: r.pre_register,
    adzunaOnly: r.sources.length > 0 && r.sources.every((s) => s.source === 'adzuna'),
    dashboardUrl: `${dashboard}#/listing/${r.id}`,
    applyUrl: r.apply_url || r.url,
  };
}

async function fetchAll<T>(
  build: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must<T[]>(await build(from), what);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function gatherDigest(
  now = new Date(),
): Promise<{ data: DigestData; settings: SettingsRow }> {
  const e = env();
  const today = londonToday(now);
  const settings = must<SettingsRow>(
    await db().from('settings').select('*').eq('id', 1).single(),
    'settings',
  );
  const last = must<Array<{ sent_at: string }>>(
    await db()
      .from('digest_log')
      .select('sent_at')
      .eq('kind', 'daily')
      .order('sent_at', { ascending: false })
      .limit(1),
    'digest_log',
  );
  const since = last[0]?.sent_at ?? null;

  const prefs = {
    roles: settings.role_prefs ?? {},
    levels: settings.level_prefs ?? {},
    defaultDistanceMiles: settings.default_distance_miles,
    score: settings.score_prefs ?? {},
  };
  const home =
    settings.home_lat != null && settings.home_lon != null
      ? { lat: settings.home_lat, lon: settings.home_lon }
      : null;
  const scoreOf = (r: ListingRow) => personalScore(r, prefs, nearestMiles(home, r.locations ?? []));
  const rankOf = (r: ListingRow) =>
    personalScore(r, prefs, nearestMiles(home, r.locations ?? []), { clamp: false });
  // Like the dashboard: roles and levels set to 'No' in Settings stay out.
  // Register-interest adverts aren't applications: the email waits for the real advert.
  const wanted = (r: ListingRow) =>
    !r.pre_register && !excludedByPrefs(r, prefs) && (r.level === null || r.level >= MIN_LEVEL);

  // First digest ever: the last week, so the very first email isn't the whole database.
  const newSince = since ?? new Date(now.getTime() - 7 * 86_400_000).toISOString();
  type Row = ListingRow;
  const fresh = await fetchAll<Row>(
    (from) =>
      db()
        .from('v_listings')
        .select('*')
        .eq('is_active', true)
        .eq('hidden', false)
        .gt('first_seen_at', newSince)
        .range(from, from + 999),
    'new listings',
  );
  const scored = fresh.filter(wanted).map((r) => ({ r, score: scoreOf(r), rank: rankOf(r) }));
  const newMatches = scored
    .filter((x) => x.score >= settings.digest_min_score)
    .sort((a, b) => b.rank - a.rank)
    .map((x) => toItem(x.r, x.score, today, e.DASHBOARD_URL));

  const weekAhead = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const closing = await fetchAll<Row>(
    (from) =>
      db()
        .from('v_listings')
        .select('*')
        .eq('is_active', true)
        .in('status', ['saved', 'applied'])
        .gte('closing_date', today)
        .lte('closing_date', weekAhead)
        .order('closing_date', { ascending: true })
        .range(from, from + 999),
    'closing soon',
  );

  const opened = must<
    Array<{ name: string; early_careers_url: string | null; job_search_url: string | null }>
  >(
    await db()
      .from('employers')
      .select('name,early_careers_url,job_search_url')
      .eq('status', 'open')
      .gt('opened_at', newSince),
    'opened employers',
  );

  const suggestions = must<Array<{ name: string | null; status: string; auto: boolean }>>(
    await db().from('employer_suggestions').select('name,status,auto').gt('created_at', newSince),
    'new suggestions',
  );
  const pendingTotal = must<Array<{ id: string }>>(
    await db().from('employer_suggestions').select('id').eq('status', 'pending'),
    'pending suggestions',
  ).length;

  const health: string[] = [];
  const erroring = must<Array<{ name: string }>>(
    await db().from('employers').select('name').eq('watch', true).eq('status', 'error'),
    'erroring employers',
  );
  if (erroring.length)
    health.push(
      `${plural(erroring.length, 'company site')} couldn't be checked: ${erroring
        .slice(0, 6)
        .map((x) => x.name)
        .join(', ')}${erroring.length > 6 ? '…' : ''} (see Health).`,
    );
  for (const [key, label] of [
    ['budget:serpapi', 'Google Jobs (SerpApi)'],
    ['budget:tavily', 'web search (Tavily)'],
  ] as const) {
    const b = must<Array<{ value: { month: string; used: number; limit?: number } }>>(
      await db().from('source_state').select('value').eq('key', key).limit(1),
      key,
    )[0]?.value;
    if (b && b.month === today.slice(0, 7) && b.limit && b.used >= b.limit * 0.8)
      health.push(`${label} has used ${b.used} of its ${b.limit} searches this month.`);
  }
  const runs = must<
    Array<{
      started_at: string;
      status: string | null;
      stats: Record<string, Record<string, unknown>> | null;
      error: string | null;
    }>
  >(
    await db()
      .from('scrape_runs')
      .select('started_at,status,stats,error')
      .order('started_at', { ascending: false })
      .limit(1),
    'latest run',
  );
  const run = runs[0];
  if (!run) health.push('No scrape has run yet.');
  else {
    const ageH = (now.getTime() - Date.parse(run.started_at)) / 3_600_000;
    if (ageH > 36) health.push(`No scrape for ${Math.round(ageH / 24)} days.`);
    if (run.status && run.status !== 'ok')
      health.push(`Last scrape was ${run.status}${run.error ? `: ${run.error}` : ''}.`);
    for (const [source, st] of Object.entries(run.stats ?? {})) {
      if (st && typeof st === 'object' && 'error' in st)
        health.push(`${source}: ${String(st.error).slice(0, 160)}`);
    }
  }

  return {
    settings,
    data: {
      today,
      since,
      minScore: settings.digest_min_score,
      newMatches,
      newBelowThreshold: scored.length - newMatches.length,
      closingSoon: closing.map((r) => toItem(r, scoreOf(r), today, e.DASHBOARD_URL)),
      openedEmployers: opened.map((o) => ({
        name: o.name,
        url: o.job_search_url ?? o.early_careers_url,
      })),
      newCompanies: {
        auto: suggestions.filter((x) => x.auto && x.name).map((x) => x.name!),
        pending: pendingTotal,
      },
      health,
      dashboardUrl: e.DASHBOARD_URL,
    },
  };
}

export function isEmpty(d: DigestData): boolean {
  return (
    !d.newMatches.length &&
    !d.closingSoon.length &&
    !d.openedEmployers.length &&
    !d.newCompanies.auto.length &&
    !d.health.length
  );
}

// ---------------------------------------------------------------------------
// Rendering (pure; see test/digest.test.ts)
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function closingText(i: DigestItem): string | null {
  if (!i.closing) return i.preRegister ? 'register your interest' : null;
  const d = i.daysToClose ?? 99;
  const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : d <= 30 ? `in ${d} days` : null;
  return `closes ${shortDate(i.closing)}${when ? ` (${when})` : ''}`;
}

function facts(i: DigestItem): string[] {
  return [i.employer, i.place, i.level, i.university, i.salary, closingText(i)].filter(
    (x): x is string => !!x,
  );
}

const TIER_LABEL = { high: 'Strong matches', medium: 'Good matches', low: 'Worth a look' } as const;
const TIER_COLOUR = { high: '#15803d', medium: '#b45309', low: '#6b7280' } as const;

function itemHtml(i: DigestItem): string {
  const soon = i.daysToClose !== null && i.daysToClose <= 7;
  return `<tr><td style="padding:12px 0;border-top:1px solid #e5e7eb">
<a href="${esc(i.dashboardUrl)}" style="font-size:16px;font-weight:600;color:#1d4ed8;text-decoration:none">${esc(i.title)}</a>
<div style="font-size:14px;color:#374151;margin-top:2px">${facts(i)
    .map((f) =>
      soon && f.startsWith('closes')
        ? `<span style="color:#b91c1c;font-weight:600">${esc(f)}</span>`
        : esc(f),
    )
    .join(' · ')}</div>
<div style="font-size:13px;margin-top:4px"><span style="color:#6b7280">Match ${i.score}</span> · <a href="${esc(i.applyUrl)}" style="color:#1d4ed8">View advert</a>${
    i.adzunaOnly
      ? ` · <a href="https://www.adzuna.co.uk" style="color:#6b7280">Jobs by Adzuna</a>`
      : ''
  }</div>
</td></tr>`;
}

function itemText(i: DigestItem): string {
  return `- ${i.title}\n  ${facts(i).join(' · ')}\n  ${i.dashboardUrl}\n  Advert: ${i.applyUrl}${i.adzunaOnly ? ' (Jobs by Adzuna)' : ''}`;
}

const MAX_PER_TIER = 15;

export function renderDigest(d: DigestData): Mail {
  const parts: string[] = [];
  if (d.newMatches.length) parts.push(plural(d.newMatches.length, 'new match', 'new matches'));
  if (d.closingSoon.length) parts.push(`${d.closingSoon.length} closing soon`);
  if (d.openedEmployers.length)
    parts.push(plural(d.openedEmployers.length, 'employer opened', 'employers opened'));
  if (d.newCompanies.auto.length)
    parts.push(plural(d.newCompanies.auto.length, 'new company', 'new companies'));
  const subject = parts.length
    ? `Apprenticeships: ${parts.join(', ')}`
    : 'Apprenticeship Finder: scrape problems';

  const html: string[] = [];
  const text: string[] = [];
  const section = (title: string) => {
    html.push(`<h2 style="font-size:18px;margin:28px 0 4px;color:#111827">${esc(title)}</h2>`);
    text.push(`\n${title.toUpperCase()}\n`);
  };

  if (d.closingSoon.length) {
    section('Closing within a week (you’re tracking these)');
    html.push(
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${d.closingSoon.map(itemHtml).join('')}</table>`,
    );
    text.push(d.closingSoon.map(itemText).join('\n'));
  }

  if (d.newMatches.length) {
    for (const tier of ['high', 'medium', 'low'] as const) {
      const items = d.newMatches.filter((i) => matchTier(i.score) === tier);
      if (!items.length) continue;
      section(`${TIER_LABEL[tier]} (${items.length} new)`);
      html[html.length - 1] = html[html.length - 1]!.replace(
        'color:#111827',
        `color:${TIER_COLOUR[tier]}`,
      );
      const shown = items.slice(0, MAX_PER_TIER);
      html.push(
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${shown.map(itemHtml).join('')}</table>`,
      );
      text.push(shown.map(itemText).join('\n'));
      if (items.length > shown.length) {
        const more = `…and ${items.length - shown.length} more on the dashboard.`;
        html.push(
          `<p style="font-size:14px"><a href="${esc(d.dashboardUrl)}" style="color:#1d4ed8">${esc(more)}</a></p>`,
        );
        text.push(more);
      }
    }
    if (d.newBelowThreshold > 0) {
      const note = `${plural(d.newBelowThreshold, 'other new listing')} scored below ${d.minScore} (change this in Settings).`;
      html.push(`<p style="font-size:13px;color:#6b7280">${esc(note)}</p>`);
      text.push(note);
    }
  }

  if (d.openedEmployers.length) {
    section('Employers that just opened applications');
    html.push(
      `<ul style="padding-left:20px;font-size:15px">${d.openedEmployers
        .map(
          (o) =>
            `<li>${o.url ? `<a href="${esc(o.url)}" style="color:#1d4ed8">${esc(o.name)}</a>` : esc(o.name)}</li>`,
        )
        .join('')}</ul>`,
    );
    text.push(d.openedEmployers.map((o) => `- ${o.name}${o.url ? ` ${o.url}` : ''}`).join('\n'));
  }

  if (d.newCompanies.auto.length || d.newCompanies.pending) {
    section('New companies found');
    const parts: string[] = [];
    if (d.newCompanies.auto.length)
      parts.push(
        `Now watching: ${d.newCompanies.auto.slice(0, 10).join(', ')}${d.newCompanies.auto.length > 10 ? '…' : ''}.`,
      );
    if (d.newCompanies.pending)
      parts.push(`${plural(d.newCompanies.pending, 'suggestion')} waiting in the Suggested tab.`);
    const link = `${d.dashboardUrl}#/companies`;
    html.push(
      `<p style="font-size:15px">${parts.map(esc).join(' ')} <a href="${esc(link)}" style="color:#1d4ed8">Companies</a></p>`,
    );
    text.push(`${parts.join(' ')} ${link}`);
  }

  if (d.health.length) {
    section('Scraper health');
    html.push(
      `<ul style="padding-left:20px;font-size:14px;color:#b91c1c">${d.health.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`,
    );
    text.push(d.health.map((h) => `- ${h}`).join('\n'));
  }

  const footer = `Open the dashboard: ${d.dashboardUrl} · Turn this email off or change the score threshold in Settings.`;
  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;background:#f9fafb"><div style="max-width:600px;margin:0 auto;padding:20px 16px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;background:#ffffff">
<div style="font-size:14px;color:#6b7280">Apprenticeship Finder · ${esc(shortDate(d.today))}</div>
${html.join('\n')}
<p style="margin-top:32px;font-size:12px;color:#6b7280">${esc(footer).replace(esc(d.dashboardUrl), `<a href="${esc(d.dashboardUrl)}" style="color:#6b7280">${esc(d.dashboardUrl)}</a>`)}</p>
</div></body></html>`,
    text: `Apprenticeship Finder · ${shortDate(d.today)}\n${text.join('\n')}\n\n${footer}\n`,
  };
}

export async function runDigest({ dryRun = false } = {}): Promise<void> {
  const log = logger('digest');
  const e = env();
  const { data, settings } = await gatherDigest();
  const mail = renderDigest(data);
  mkdirSync(`${REPO_ROOT}logs`, { recursive: true });
  writeFileSync(`${REPO_ROOT}logs/digest.html`, mail.html);
  writeFileSync(`${REPO_ROOT}logs/digest.txt`, mail.text);
  log.info(
    `${data.newMatches.length} new matches, ${data.closingSoon.length} closing soon, ${data.openedEmployers.length} opened, ${data.health.length} health notes`,
  );
  if (!settings.digest_enabled) return log.info('digest turned off in Settings; not sending');
  if (isEmpty(data)) return log.info('nothing to send');
  if (dryRun)
    return log.info(
      `[dry] would send "${mail.subject}" to ${recipients(e).length} recipients (logs/digest.html)`,
    );
  if (!canSend(e)) return log.warn('email not configured; skipping');

  const to = await sendMail(e, mail);
  must(
    await db()
      .from('digest_log')
      .insert({
        kind: 'daily',
        recipients: to,
        listing_ids: [...data.newMatches, ...data.closingSoon].map((i) => i.id),
        employer_ids: [],
      }),
    'digest_log',
  );
  log.info(`sent "${mail.subject}" to ${to.length} recipients`);
}

/** Workflow `if: failure()` step: tell both of you the daily run broke. */
export async function sendFailureEmail(): Promise<void> {
  const e = env();
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
  let detail = '';
  try {
    const runs = must<Array<{ status: string | null; error: string | null; started_at: string }>>(
      await db()
        .from('scrape_runs')
        .select('status,error,started_at')
        .order('started_at', { ascending: false })
        .limit(1),
      'latest run',
    );
    if (runs[0])
      detail = `Latest recorded run (${runs[0].started_at}): ${runs[0].status ?? 'running'}${runs[0].error ? ` — ${runs[0].error}` : ''}`;
  } catch (err) {
    detail = `Couldn't read the database either (${(err as Error).message}). If Supabase paused the project, restore it from the dashboard.`;
  }
  const lines = [
    'The daily apprenticeship scrape failed.',
    detail,
    runUrl ? `Logs: ${runUrl}` : '',
    'Re-run it from GitHub: Actions → scrape → Run workflow.',
  ].filter(Boolean);
  await sendMail(e, {
    subject: 'Apprenticeship Finder: daily scrape failed',
    text: lines.join('\n\n'),
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px">${lines
      .map((l) => `<p>${esc(l).replace(/(https:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`)
      .join('')}</div>`,
  });
}

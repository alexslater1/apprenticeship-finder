import { mkdirSync, writeFileSync } from 'node:fs';
import { londonToday, type RawListing } from '@af/shared';
import { db, must } from './db.ts';
import { env, REPO_ROOT } from './env.ts';
import { Http } from './http.ts';
import { logger, startLogFile } from './log.ts';
import { geocodeAll } from './pipeline/geocode.ts';
import { inheritLevels } from './pipeline/siblings.ts';
import { checkLinks } from './pipeline/links.ts';
import { mergeWithinRun, normalise, type NormalisedListing } from './pipeline/normalise.ts';
import { assignKeys } from './pipeline/dedupe.ts';
import {
  expireStale,
  knownEmployerIds,
  knownSourceIds,
  loadMatchables,
  markMissing,
  persist,
} from './pipeline/persist.ts';
import type { Employer } from './connectors/types.ts';
import { saveSuggestions, suggestionsFromListings } from './discovery/learn.ts';
import { processApproved } from './discovery/process.ts';
import {
  attributeToEmployer,
  employerMatcher,
  loadEmployerConfig,
  loadEmployers,
  runEmployers,
  saveEmployerStatus,
  statusFor,
  syncEmployers,
  type EmployerRun,
} from './employers.ts';
import { SOURCES } from './sources/index.ts';
import { StateStore } from './state.ts';
import type { Ctx, SourceResult } from './types.ts';

const STALE_DAYS = 30;
const INCREMENTAL = SOURCES.filter((s) => s.incremental).map((s) => s.id);

export interface RunOptions {
  /** Aggregator ids to run; 'employers' runs every watched employer. Default: everything. */
  sources?: string[];
  /** Only these employer ids (implies no aggregators unless `sources` names some). */
  employers?: string[];
  dryRun: boolean;
  record: boolean;
}

/** Employers to check this run: config merged with stored status (dry runs don't sync). */
async function employersForRun(o: RunOptions): Promise<Employer[]> {
  const stored = new Map((await loadEmployers()).map((e) => [e.id, e]));
  const all: Employer[] = o.dryRun
    ? [
        ...loadEmployerConfig().map((c) => ({
          ...stored.get(c.id),
          ...c,
          connector: c.connector ?? null,
        })),
        ...[...stored.values()].filter((e) => e.origin !== 'seed'),
      ]
    : [...stored.values()];
  return all.filter(
    (e) => e.connector && (o.employers ? o.employers.includes(e.id) : e.watch !== false),
  );
}

export interface RunSummary {
  status: 'ok' | 'partial' | 'failed';
  stats: Record<string, unknown>;
  newListingIds: string[];
}

/** One scrape run (PLAN.md §5). Errors in a source are recorded, never abort the run. */
export async function runScrape(o: RunOptions): Promise<RunSummary> {
  const e = env();
  const startedAt = new Date();
  startLogFile(`scrape-${startedAt.toISOString().replace(/[:.]/g, '-')}.log`);
  const log = logger('scrape');
  const today = londonToday(startedAt);
  const trigger =
    e.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : e.GITHUB_EVENT_NAME ? 'manual' : 'local';

  let runId: string | undefined;
  if (!o.dryRun) {
    const row = must<{ id: string }>(
      await db()
        .from('scrape_runs')
        .insert({ started_at: startedAt.toISOString(), status: 'running', trigger })
        .select('id')
        .single(),
      'start scrape_runs row',
    );
    runId = row.id;
    log.info(`run ${runId} started (${trigger})`);
  } else {
    log.info('dry run: nothing will be written');
  }

  const ctx: Ctx = {
    env: e,
    http: new Http({ record: o.record }),
    log,
    state: new StateStore(o.dryRun),
    dryRun: o.dryRun,
    today,
    knownSourceIds: (source) =>
      o.dryRun ? Promise.resolve(new Set<string>()) : knownSourceIds(source),
  };

  const stats: Record<string, unknown> = {};
  const results: Array<{ source: string; result: SourceResult }> = [];
  let ran = 0;
  let failed = 0;

  const wantSources = o.sources ?? (o.employers ? [] : undefined);
  const wantEmployers = o.employers?.length || !o.sources || o.sources.includes('employers');

  async function runSources() {
    for (const source of SOURCES) {
      if (wantSources && !wantSources.includes(source.id)) continue;
      if (!source.enabled(e)) {
        stats[source.id] = { skipped: 'not configured' };
        log.info(`${source.id}: skipped (not configured)`);
        continue;
      }
      ran++;
      const t0 = Date.now();
      try {
        const result = await source.run({ ...ctx, log: log.child(source.id) });
        results.push({ source: source.id, result });
        stats[source.id] = {
          ...result.stats,
          fetched: result.listings.length,
          ms: Date.now() - t0,
        };
        log.info(`${source.id}: ${result.listings.length} listings in ${Date.now() - t0} ms`);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        stats[source.id] = { error: msg, ms: Date.now() - t0 };
        log.error(`${source.id}: ${msg}`);
      }
    }
  }

  // Employer careers sites run alongside the aggregators (different hosts, so no contention).
  let employerRuns: EmployerRun[] = [];
  async function runAllEmployers() {
    if (!wantEmployers) return;
    if (!o.dryRun) log.info(`employers: synced ${await syncEmployers()} from config`);
    // Companies approved in the Suggested tab (or auto-approved yesterday) are checked today.
    try {
      const disc = await processApproved({ ...ctx, log: log.child('discovery') });
      stats.employersAdded = disc.added;
      if (disc.needsReview.length) stats.employersNeedReview = disc.needsReview;
    } catch (err) {
      log.error(`discovery: ${(err as Error).message}`);
    }
    const employers = await employersForRun(o);
    const known = o.dryRun ? new Map<string, Set<string>>() : await knownEmployerIds();
    const t0 = Date.now();
    employerRuns = await runEmployers(ctx, employers, known);
    log.info(`employers: ${employerRuns.length} checked in ${Date.now() - t0} ms`);
  }

  await Promise.all([runSources(), runAllEmployers()]);
  for (const r of employerRuns) {
    if (r.result) {
      results.push({
        source: `employer:${r.employer.id}`,
        result: {
          listings: r.result.jobs,
          complete: r.result.complete,
          stats: r.result.stats ?? {},
          total: r.result.total,
        },
      });
    }
  }

  const raw: RawListing[] = results.flatMap((r) => r.result.listings);
  let newListingIds: string[] = [];
  let pipelineError: string | null = null;
  try {
    await geocodeAll(raw, ctx);
    const kept = raw.map(normalise).filter((l): l is NormalisedListing => l !== null);
    // Which watchlist employer each listing belongs to (FAA's 'BARCLAYS BANK UK PLC' → barclays).
    const storedEmployers = await loadEmployers().catch(() => []);
    const matchEmployer = employerMatcher(storedEmployers);
    const nameById = new Map(storedEmployers.map((x) => [x.id, x.name]));
    for (const l of kept) attributeToEmployer(l, matchEmployer, (id) => nameById.get(id));
    const relevantBySource = new Map<string, number>();
    // An employer is "open" when it has real adverts, not just a register-interest page.
    for (const l of kept)
      for (const s of l.sources)
        if (s.source.startsWith('employer:') && !l.details?.preRegister)
          relevantBySource.set(s.source, (relevantBySource.get(s.source) ?? 0) + 1);
    // Same vacancy on several sources (or re-titled since yesterday) → one listing.
    const existing = await loadMatchables(); // read-only, so dry runs show real merges too
    const keys = assignKeys(
      kept.map((l) => ({
        dedupeKey: l.dedupeKey,
        employerNorm: l.employerNameNorm,
        title: l.title,
        cities: l.locations.map((x) => x.city).filter((c): c is string => !!c),
      })),
      existing,
    );
    const existingKeys = new Set(existing.map((x) => x.dedupeKey));
    const matchedExisting = kept.filter(
      (l, i) => keys[i] !== l.dedupeKey && existingKeys.has(keys[i]!),
    ).length;
    kept.forEach((l, i) => (l.dedupeKey = keys[i]!));
    const merged = mergeWithinRun(kept);
    const multiSource = merged.filter(
      (l) => new Set(l.sources.map((s) => s.source)).size > 1,
    ).length;
    const saved = await persist(merged, ctx);

    // D1–D3: companies we don't watch yet, from strong listings and web search hits.
    try {
      const inputs = [
        ...suggestionsFromListings(merged, today),
        ...results.flatMap((r) => r.result.suggestions ?? []),
      ];
      stats.discovery = await saveSuggestions(
        inputs,
        { ...ctx, log: log.child('discovery') },
        (norm) => matchEmployer(norm) !== null,
        storedEmployers,
      );
    } catch (err) {
      log.error(`suggestions: ${(err as Error).message}`);
    }
    newListingIds = saved.newIds;
    let deactivated = 0;
    if (!o.dryRun) {
      for (const { source, result } of results) {
        // A "complete" sync that returned nothing is more likely an outage than an empty market
        // (employer boards also count as healthy when they list other jobs).
        if (result.complete && (result.listings.length > 0 || (result.total ?? 0) > 0)) {
          deactivated += await markMissing(source, startedAt.toISOString(), INCREMENTAL);
        }
      }
      // Incremental sources (Adzuna) never report closures; retire what we haven't seen in a while.
      deactivated += await expireStale(STALE_DAYS);
      try {
        const levels = await inheritLevels();
        if (levels.filled)
          log.info(
            `levels from other adverts: ${levels.filled} (${levels.closed} below the minimum)`,
          );
        deactivated += levels.closed;
      } catch (err) {
        log.error(`levels from other adverts: ${(err as Error).message}`);
      }
      try {
        stats.links = await checkLinks({ ...ctx, log: log.child('links') });
      } catch (err) {
        log.error(`link checks: ${(err as Error).message}`);
      }
      if (employerRuns.length) {
        const { opened } = await saveEmployerStatus(
          employerRuns,
          relevantBySource,
          new Date().toISOString(),
        );
        if (opened.length) log.info(`employers opened: ${opened.join(', ')}`);
        stats.openedEmployers = opened;
      }
    }
    if (employerRuns.length) stats.employers = employerSummary(employerRuns, relevantBySource);
    stats.total = {
      raw: raw.length,
      relevant: kept.length,
      listings: merged.length,
      inserted: saved.inserted,
      updated: saved.updated,
      deactivated,
      matchedExisting,
      multiSource,
      requests: ctx.http.requests,
    };
    log.info(
      `pipeline: ${raw.length} raw → ${kept.length} relevant → ${merged.length} listings (${saved.inserted} new, ${saved.updated} updated, ${deactivated} deactivated; ${multiSource} on several sources, ${matchedExisting} matched a stored listing)`,
    );
  } catch (err) {
    pipelineError = err instanceof Error ? err.message : String(err);
    log.error(`pipeline: ${pipelineError}`);
  }

  const status: RunSummary['status'] = pipelineError
    ? 'failed'
    : failed === 0
      ? 'ok'
      : ran > 0 && failed * 2 > ran
        ? 'failed'
        : 'partial';

  if (runId) {
    must(
      await db()
        .from('scrape_runs')
        .update({
          finished_at: new Date().toISOString(),
          status,
          stats,
          new_listing_ids: newListingIds,
          error: pipelineError ?? (failed ? `${failed}/${ran} sources failed` : null),
        })
        .eq('id', runId),
      'finish scrape_runs row',
    );
  }

  writeLastRun({ date: today, finished_at: new Date().toISOString(), status, trigger, stats });
  log.info(`run finished: ${status}`);
  return { status, stats, newListingIds };
}

function employerSummary(runs: EmployerRun[], relevantBySource: Map<string, number>) {
  const counts: Record<string, number> = {};
  const byId: Record<string, unknown> = {};
  for (const r of runs) {
    const relevant = relevantBySource.get(`employer:${r.employer.id}`) ?? 0;
    const status = statusFor(r, relevant);
    counts[status] = (counts[status] ?? 0) + 1;
    if (r.transient) counts.outage = (counts.outage ?? 0) + 1;
    byId[r.employer.id] = {
      status,
      total: r.result?.total ?? null,
      candidates: r.result?.jobs.length ?? 0,
      relevant,
      ms: r.ms,
      ...(r.error ? { error: r.error.slice(0, 200) } : {}),
    };
  }
  return { checked: runs.length, ...counts, byId };
}

/** Public, non-private summary committed by the workflow (keeps the cron alive, PLAN.md §9.1). */
function writeLastRun(summary: Record<string, unknown>): void {
  mkdirSync(`${REPO_ROOT}data`, { recursive: true });
  writeFileSync(`${REPO_ROOT}data/last-run.json`, JSON.stringify(summary, null, 2) + '\n');
}

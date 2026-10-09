import { mkdirSync, writeFileSync } from 'node:fs';
import { londonToday, type RawListing } from '@af/shared';
import { db, must } from './db.ts';
import { env, REPO_ROOT } from './env.ts';
import { Http } from './http.ts';
import { logger, startLogFile } from './log.ts';
import { geocodeAll } from './pipeline/geocode.ts';
import { mergeWithinRun, normalise, type NormalisedListing } from './pipeline/normalise.ts';
import { knownSourceIds, markMissing, persist } from './pipeline/persist.ts';
import { SOURCES } from './sources/index.ts';
import { StateStore } from './state.ts';
import type { Ctx, SourceResult } from './types.ts';

export interface RunOptions {
  sources?: string[];
  dryRun: boolean;
  record: boolean;
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

  for (const source of SOURCES) {
    if (o.sources && !o.sources.includes(source.id)) continue;
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
      stats[source.id] = { ...result.stats, fetched: result.listings.length, ms: Date.now() - t0 };
      log.info(`${source.id}: ${result.listings.length} listings in ${Date.now() - t0} ms`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      stats[source.id] = { error: msg, ms: Date.now() - t0 };
      log.error(`${source.id}: ${msg}`);
    }
  }

  const raw: RawListing[] = results.flatMap((r) => r.result.listings);
  let newListingIds: string[] = [];
  let pipelineError: string | null = null;
  try {
    await geocodeAll(raw, ctx);
    const kept = raw.map(normalise).filter((l): l is NormalisedListing => l !== null);
    const merged = mergeWithinRun(kept);
    const saved = await persist(merged, ctx);
    newListingIds = saved.newIds;
    let deactivated = 0;
    if (!o.dryRun) {
      for (const { source, result } of results) {
        // A "complete" sync that returned nothing is more likely an outage than an empty market.
        if (result.complete && result.listings.length > 0) {
          deactivated += await markMissing(source, startedAt.toISOString());
        }
      }
    }
    stats.total = {
      raw: raw.length,
      relevant: kept.length,
      listings: merged.length,
      inserted: saved.inserted,
      updated: saved.updated,
      deactivated,
      requests: ctx.http.requests,
    };
    log.info(
      `pipeline: ${raw.length} raw → ${kept.length} relevant → ${merged.length} listings (${saved.inserted} new, ${saved.updated} updated, ${deactivated} deactivated)`,
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

/** Public, non-private summary committed by the workflow (keeps the cron alive, PLAN.md §9.1). */
function writeLastRun(summary: Record<string, unknown>): void {
  mkdirSync(`${REPO_ROOT}data`, { recursive: true });
  writeFileSync(`${REPO_ROOT}data/last-run.json`, JSON.stringify(summary, null, 2) + '\n');
}

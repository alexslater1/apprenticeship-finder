import { readFileSync } from 'node:fs';
import { normaliseEmployerName } from '@af/shared';
import { z } from 'zod';
import { connectorById } from './connectors/index.ts';
import type { ConnectorResult, Employer, EmployerStatus } from './connectors/types.ts';
import { db, must } from './db.ts';
import { REPO_ROOT } from './env.ts';
import { BlockedError } from './http.ts';
import type { Ctx } from './types.ts';

/**
 * The employer watchlist (PLAN.md §6.3–6.4): identity and connector config live in
 * config/employers.json (synced to the `employers` table each run); status, counts and the
 * watch flag live in the database.
 */

export const ConfigEmployer = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  sector: z.string().nullish(),
  relevance: z.enum(['core', 'adjacent']).nullish(),
  confidence: z.string().nullish(),
  early_careers_url: z.string().nullish(),
  job_search_url: z.string().nullish(),
  ats_family: z.string().nullish(),
  connector: z.string().nullish(),
  connector_config: z.record(z.string(), z.unknown()).default({}),
  data_schemes: z.array(z.string()).default([]),
  typical_window: z.string().nullish(),
  opens_month: z.number().int().min(1).max(12).nullish(),
  closes_month: z.number().int().min(1).max(12).nullish(),
  locations: z.array(z.string()).default([]),
  training_provider: z.string().nullish(),
  notes_md: z.string().nullish(),
});
export type ConfigEmployer = z.infer<typeof ConfigEmployer>;

export function loadEmployerConfig(): ConfigEmployer[] {
  const raw = JSON.parse(readFileSync(`${REPO_ROOT}config/employers.json`, 'utf8')) as unknown[];
  return raw.map((e) => ConfigEmployer.parse(e));
}

/** Upsert config employers. Never deletes, never touches status, counts or `watch`. */
export async function syncEmployers(): Promise<number> {
  const rows = loadEmployerConfig().map((e) => ({
    id: e.id,
    name: e.name,
    aliases: e.aliases,
    origin: 'seed',
    sector: e.sector ?? null,
    relevance: e.relevance ?? null,
    confidence: e.confidence ?? null,
    early_careers_url: e.early_careers_url ?? null,
    job_search_url: e.job_search_url ?? null,
    ats_family: e.ats_family ?? null,
    connector: e.connector ?? null,
    connector_config: e.connector_config,
    data_schemes: e.data_schemes,
    typical_window: e.typical_window ?? null,
    opens_month: e.opens_month ?? null,
    closes_month: e.closes_month ?? null,
    locations: e.locations,
    training_provider: e.training_provider ?? null,
    notes_md: e.notes_md ?? null,
  }));
  must(await db().from('employers').upsert(rows, { onConflict: 'id' }), 'sync employers');
  return rows.length;
}

export async function loadEmployers(): Promise<Employer[]> {
  return must<Employer[]>(
    await db()
      .from('employers')
      .select('id,name,aliases,connector,connector_config,early_careers_url,job_search_url,watch,status,last_total_jobs,page_hash,origin'),
    'load employers',
  );
}

/**
 * Finds which watchlist employer a listing's employer name refers to: exact name/alias match,
 * or a word-prefix match for longer names ('barclays' ~ 'barclays bank'). Short names only match
 * exactly so 'sky' doesn't swallow 'sky betting and gaming'.
 */
export function employerMatcher(employers: Array<Pick<Employer, 'id' | 'name' | 'aliases'>>) {
  const names = employers.flatMap((e) =>
    [e.name, ...(e.aliases ?? [])].map((n) => ({ id: e.id, norm: normaliseEmployerName(n) })),
  );
  const exact = new Map(names.map((n) => [n.norm, n.id]));
  const prefixable = names.filter((n) => n.norm.length >= 6 || n.norm.includes(' '));
  return (norm: string): string | null => {
    const hit = exact.get(norm);
    if (hit) return hit;
    let best: { id: string; len: number } | null = null;
    for (const n of prefixable) {
      if (norm.startsWith(`${n.norm} `) || n.norm.startsWith(`${norm} `)) {
        if (!best || n.norm.length > best.len) best = { id: n.id, len: n.norm.length };
      }
    }
    return best?.id ?? null;
  };
}

export interface EmployerRun {
  employer: Employer;
  result?: ConnectorResult;
  error?: string;
  blocked?: boolean;
  ms: number;
}

const EMPLOYER_TIMEOUT_MS = 8 * 60_000;
const CONCURRENCY = 6;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
    }),
  );
}

/** Run every watched employer's connector (bounded concurrency; one host at a time via Http). */
export async function runEmployers(
  ctx: Ctx,
  employers: Employer[],
  known: Map<string, Set<string>>,
): Promise<EmployerRun[]> {
  const runs: EmployerRun[] = [];
  await pool(employers, CONCURRENCY, async (employer) => {
    const t0 = Date.now();
    const source = `employer:${employer.id}`;
    const log = ctx.log.child(source);
    const connector = employer.connector ? connectorById.get(employer.connector) : undefined;
    if (!connector) {
      runs.push({ employer, error: `unknown connector ${employer.connector ?? '(none)'}`, ms: 0 });
      return;
    }
    try {
      const cfg = connector.config.parse(employer.connector_config ?? {});
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        connector.run(cfg as never, { ...ctx, log, employer, source, known: known.get(source) ?? new Set() }),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('timed out')), EMPLOYER_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      runs.push({ employer, result, ms: Date.now() - t0 });
      log.info(
        `${result.jobs.length} candidates of ${result.total ?? '?'} jobs in ${Date.now() - t0} ms`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runs.push({ employer, error: msg, blocked: err instanceof BlockedError, ms: Date.now() - t0 });
      log.warn(msg);
    }
  });
  return runs;
}

export function statusFor(run: EmployerRun, relevant: number): EmployerStatus {
  if (run.employer.connector === 'manual') return 'manual';
  if (run.blocked) return 'blocked';
  if (run.error) return 'error';
  return relevant > 0 ? 'open' : 'closed';
}

/** Write each employer's watchlist status and counts (PLAN.md §5 step 9). */
export async function saveEmployerStatus(
  runs: EmployerRun[],
  relevantBySource: Map<string, number>,
  nowIso: string,
): Promise<{ opened: string[] }> {
  const opened: string[] = [];
  for (const run of runs) {
    const e = run.employer;
    const relevant = relevantBySource.get(`employer:${e.id}`) ?? 0;
    const status = statusFor(run, relevant);
    const patch: Record<string, unknown> = {
      status,
      last_checked_at: nowIso,
      last_error: run.error ?? null,
    };
    if (run.result) {
      patch.last_ok_at = nowIso;
      patch.last_total_jobs = run.result.total;
      patch.last_apprentice_jobs = run.result.jobs.length;
      patch.last_relevant_jobs = relevant;
      if (run.result.pageHash) patch.page_hash = run.result.pageHash;
    }
    if (status === 'open' && e.status !== 'open') {
      patch.opened_at = nowIso;
      opened.push(e.id);
    }
    must(await db().from('employers').update(patch).eq('id', e.id), `update employer ${e.id}`);
  }
  return { opened };
}

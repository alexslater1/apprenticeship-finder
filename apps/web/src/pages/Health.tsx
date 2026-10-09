import { Link } from 'react-router';
import { Page } from '@/components/Layout';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useBudgets, useScrapeRuns, type ScrapeRun } from '@/lib/queries';
import { useEmployers } from '@/lib/companies';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<string, string> = {
  ok: 'bg-match-high/15 text-match-high',
  partial: 'bg-match-medium/15 text-match-medium',
  failed: 'bg-destructive/15 text-destructive',
  running: 'bg-muted text-muted-foreground',
};

const NOT_SOURCES = new Set([
  'total',
  'employers',
  'discovery',
  'employersAdded',
  'employersNeedReview',
  'openedEmployers',
]);

const STATUS_WORDS: Record<string, string> = {
  open: 'open',
  closed: 'no apprenticeships',
  manual: 'checked by hand',
  blocked: 'blocked',
  error: 'failing',
  unknown: 'not checked yet',
};

const BUDGET_LABELS: Record<string, string> = {
  'budget:serpapi': 'Google Jobs (SerpApi)',
  'budget:tavily': 'Web search (Tavily)',
};

const show = (v: unknown) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v));

function duration(r: ScrapeRun): string {
  if (!r.finished_at) return '—';
  const s = Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export default function Health() {
  const { data: runs, isLoading, error } = useScrapeRuns();
  const lastOk = runs?.find((r) => r.status === 'ok' || r.status === 'partial');
  const latest = runs?.[0];
  // Per-source stats objects; employer and discovery summaries get their own sections.
  const sources = Object.entries(latest?.stats ?? {}).filter(
    ([k, v]) => !NOT_SOURCES.has(k) && v && typeof v === 'object' && !Array.isArray(v),
  );
  const employers = useEmployers();
  const budgets = useBudgets();
  const problem = (employers.data ?? []).filter(
    (e) => e.watch && (e.status === 'error' || e.status === 'blocked'),
  );
  const empty = (employers.data ?? []).filter(
    (e) =>
      e.watch &&
      e.status === 'closed' &&
      e.last_total_jobs === 0 &&
      e.connector !== 'pagehash' &&
      e.connector !== 'manual',
  );
  const counts = new Map<string, number>();
  for (const e of employers.data ?? [])
    if (e.watch) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);

  return (
    <Page title="Scrape health">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {(error as Error).message}
        </p>
      ) : isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <div className="grid gap-6">
          <p className="text-sm">
            Last successful run:{' '}
            <strong>{lastOk ? formatDateTime(lastOk.finished_at) : 'never'}</strong>. The scrape
            runs daily at about 07:23 UK time (06:23 UTC).
          </p>

          {latest && (
            <section>
              <h2 className="mb-2 font-semibold">Sources in the latest run</h2>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map(([name, st]) => (
                      <tr key={name} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">{name}</td>
                        <td
                          className={cn(
                            'px-3 py-2',
                            'error' in (st as object) && 'text-destructive',
                          )}
                        >
                          {Object.entries(st as Record<string, unknown>)
                            .map(([k, v]) => `${k}: ${show(v)}`)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="grid gap-2">
            <h2 className="font-semibold">Company sites</h2>
            <p className="text-sm text-muted-foreground">
              {[...counts].map(([k, n]) => `${n} ${STATUS_WORDS[k] ?? k}`).join(' · ') ||
                'Not checked yet.'}
            </p>
            {problem.length > 0 && (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Company</th>
                      <th className="px-3 py-2 font-medium">Problem</th>
                      <th className="px-3 py-2 font-medium">Last worked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problem.map((e) => (
                      <tr key={e.id} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">
                          <Link to={`/companies/${e.id}`} className="hover:underline">
                            {e.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-destructive">
                          {e.status === 'blocked' ? 'Blocked: ' : ''}
                          {e.last_error ?? '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDateTime(e.last_ok_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {empty.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Listed no jobs at all (worth a look, the job system may have moved):{' '}
                {empty.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && ', '}
                    <Link to={`/companies/${e.id}`} className="text-primary hover:underline">
                      {e.name}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </section>

          {budgets.data && budgets.data.length > 0 && (
            <section className="grid gap-1">
              <h2 className="font-semibold">Search budgets this month</h2>
              {budgets.data.map((b) => (
                <p key={b.key} className="text-sm">
                  {BUDGET_LABELS[b.key] ?? b.key}: {b.used} of {b.limit ?? '?'} used
                  {b.month ? ` (${b.month})` : ''}
                </p>
              ))}
            </section>
          )}

          <section>
            <h2 className="mb-2 font-semibold">Recent runs</h2>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Started</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Trigger</th>
                    <th className="px-3 py-2 font-medium">Took</th>
                    <th className="px-3 py-2 font-medium">Listings</th>
                    <th className="px-3 py-2 font-medium">New</th>
                    <th className="px-3 py-2 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs?.map((r) => {
                    const total = (r.stats?.total ?? {}) as Record<string, unknown>;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDateTime(r.started_at)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-medium',
                              STATUS_STYLE[r.status ?? 'running'],
                            )}
                          >
                            {r.status ?? 'running'}
                          </span>
                        </td>
                        <td className="px-3 py-2">{r.trigger ?? '—'}</td>
                        <td className="px-3 py-2">{duration(r)}</td>
                        <td className="px-3 py-2 tabular-nums">{String(total.listings ?? '—')}</td>
                        <td className="px-3 py-2 tabular-nums">{r.new_listing_ids?.length ?? 0}</td>
                        <td className="max-w-xs px-3 py-2 text-destructive">{r.error ?? ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Page>
  );
}

import { Page } from '@/components/Layout';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useScrapeRuns, type ScrapeRun } from '@/lib/queries';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<string, string> = {
  ok: 'bg-match-high/15 text-match-high',
  partial: 'bg-match-medium/15 text-match-medium',
  failed: 'bg-destructive/15 text-destructive',
  running: 'bg-muted text-muted-foreground',
};

function duration(r: ScrapeRun): string {
  if (!r.finished_at) return '—';
  const s = Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export default function Health() {
  const { data: runs, isLoading, error } = useScrapeRuns();
  const lastOk = runs?.find((r) => r.status === 'ok' || r.status === 'partial');
  const latest = runs?.[0];
  const sources = Object.entries(latest?.stats ?? {}).filter(([k]) => k !== 'total');

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
                        <td className={cn('px-3 py-2', 'error' in st && 'text-destructive')}>
                          {Object.entries(st)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

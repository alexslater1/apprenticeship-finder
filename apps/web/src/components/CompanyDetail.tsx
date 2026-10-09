import type { EmployerRow } from '@af/shared';
import { Bell, BellOff, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CONNECTOR_LABELS, careersUrl, useSetWatch, usualWindow } from '@/lib/companies';
import { ago, formatDate } from '@/lib/format';
import { useFilters } from '@/store/filters';
import { OriginBadge, StatusPill } from './CompanyCard';
import { Notes } from './Notes';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

function checkedVia(e: EmployerRow): string {
  if (e.status === 'manual') return e.manual_reason ?? 'Not checked automatically.';
  const via = e.connector ? (CONNECTOR_LABELS[e.connector] ?? e.connector) : 'nothing yet';
  if (e.connector === 'pagehash')
    return `Watching the careers page for changes (checked ${ago(e.last_checked_at)}).`;
  const counts =
    e.last_total_jobs !== null
      ? ` · ${e.last_total_jobs} jobs listed, ${e.last_apprentice_jobs ?? 0} apprenticeships, ${e.last_relevant_jobs ?? 0} data/tech`
      : '';
  return `Checked via ${via} ${ago(e.last_checked_at)}${counts}.`;
}

export function CompanyDetail({ e, onClose }: { e: EmployerRow | undefined; onClose: () => void }) {
  const setWatch = useSetWatch();
  const navigate = useNavigate();
  const setFilters = useFilters((s) => s.set);
  const url = e ? careersUrl(e) : null;
  return (
    <Sheet open={!!e} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        {e && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill e={e} />
                <OriginBadge origin={e.origin} />
              </div>
              <SheetTitle className="text-xl">{e.name}</SheetTitle>
              <SheetDescription>
                {[e.sector, e.locations?.join(', ')].filter(Boolean).join(' · ')}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-6 px-4 pb-8">
              <div className="flex flex-wrap gap-2">
                {e.active_listings > 0 && (
                  <Button
                    onClick={() => {
                      setFilters({ employerId: e.id, includeClosed: false });
                      navigate('/');
                    }}
                  >
                    View {e.active_listings} listing{e.active_listings === 1 ? '' : 's'}
                  </Button>
                )}
                {url && (
                  <Button variant="outline" asChild>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      Careers site <ExternalLink />
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setWatch.mutate({ id: e.id, watch: !e.watch })}
                >
                  {e.watch ? <BellOff /> : <Bell />}
                  {e.watch ? 'Stop watching' : 'Watch'}
                </Button>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Fact label="Usual window">{usualWindow(e) ?? '—'}</Fact>
                <Fact label="Next closing date">{formatDate(e.next_closing)}</Fact>
                <Fact label="Last season">
                  {e.last_season_first_seen
                    ? `${formatDate(e.last_season_first_seen, { year: true })} – ${formatDate(e.last_season_closed, { year: true })}`
                    : '—'}
                </Fact>
                <Fact label="Training provider">{e.training_provider ?? '—'}</Fact>
                <Fact label="Opened">
                  {e.opened_at ? formatDate(e.opened_at, { year: true }) : '—'}
                </Fact>
                <Fact label="Relevance">
                  {e.relevance === 'core'
                    ? 'Named data scheme'
                    : e.relevance === 'adjacent'
                      ? 'Tech / adjacent'
                      : '—'}
                </Fact>
              </dl>

              {e.typical_window && (
                <section className="grid gap-1">
                  <h3 className="font-semibold">When it usually opens</h3>
                  <p className="text-sm text-muted-foreground">{e.typical_window}</p>
                </section>
              )}

              {e.data_schemes?.length ? (
                <section className="grid gap-1">
                  <h3 className="font-semibold">Data and tech schemes</h3>
                  <ul className="list-disc pl-5 text-sm">
                    {e.data_schemes.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="grid gap-1">
                <h3 className="font-semibold">How it’s checked</h3>
                <p className="text-sm text-muted-foreground">{checkedVia(e)}</p>
                {e.last_error && (
                  <p className="text-sm text-destructive">Last problem: {e.last_error}</p>
                )}
              </section>

              {e.notes_md && (
                <section className="grid gap-1">
                  <h3 className="font-semibold">Research notes</h3>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{e.notes_md}</p>
                </section>
              )}

              <Notes target={{ kind: 'employer', id: e.id }} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

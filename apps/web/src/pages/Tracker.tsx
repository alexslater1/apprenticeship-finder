import { rankLinks, STATUS_LABELS, type TrackStatus } from '@af/shared';
import { AlarmClock, ChevronDown, Download } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { ClosingBadge, LevelBadge } from '@/components/badges';
import { STATUS_DOT } from '@/lib/status';
import { useOpenListing } from '@/lib/useOpenListing';
import { Page } from '@/components/Layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Derived } from '@/lib/derive';
import { downloadCsv } from '@/lib/csv';
import { formatDate, locationLabel } from '@/lib/format';
import { useSetStatus } from '@/lib/queries';
import { useListingData } from '@/lib/useListingData';
import { cn } from '@/lib/utils';

const STAGES: TrackStatus[] = ['saved', 'applied', 'interview', 'offer', 'rejected'];

/** The obvious next step from each stage. */
const NEXT: Partial<Record<TrackStatus, { to: TrackStatus; label: string }>> = {
  saved: { to: 'applied', label: 'I’ve applied' },
  applied: { to: 'interview', label: 'Got an interview' },
  interview: { to: 'offer', label: 'Got an offer' },
};

const EMPTY: Record<string, string> = {
  saved: 'Nothing saved. Use “Track…” on a listing to save it here.',
  applied: 'No applications yet. Press “I’ve applied” on a saved job.',
  interview: 'No interviews yet.',
  offer: 'No offers yet.',
  rejected: 'Nothing here, which is good.',
};

function Row({ d }: { d: Derived }) {
  const open = useOpenListing();
  const setStatus = useSetStatus();
  const r = d.row;
  const next = NEXT[r.status];
  return (
    <li className="relative flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 hover:bg-accent/40 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <a
          href={`#/listing/${r.id}`}
          onClick={(e) => {
            e.preventDefault();
            open(r.id);
          }}
          className="font-medium after:absolute after:inset-0 after:content-['']"
        >
          {r.title}
        </a>
        <p className="text-sm text-muted-foreground">
          {r.employer_name} · {locationLabel(r)}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <LevelBadge level={r.level} isDegree={r.is_degree} />
          {r.is_active ? (
            <span className="whitespace-nowrap">
              {r.closing_date ? (
                <>
                  Closes {formatDate(r.closing_date)} <ClosingBadge days={d.daysToClose} />
                </>
              ) : (
                <span className="text-muted-foreground">No closing date given</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Closed</span>
          )}
          {r.applied_at && (
            <span className="text-muted-foreground">Applied {formatDate(r.applied_at)}</span>
          )}
        </p>
      </div>
      <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-2">
        {next && (
          <Button size="sm" onClick={() => setStatus(r, next.to)}>
            {next.label}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" aria-label={`Move ${r.title} to another stage`}>
              Move <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {STAGES.filter((s) => s !== r.status).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => setStatus(r, s)}>
                <span className={cn('size-2 rounded-full', STATUS_DOT[s])} aria-hidden />
                {STATUS_LABELS[s]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setStatus(r, 'none')}>Stop tracking</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function exportCsv(rows: Derived[]) {
  downloadCsv(
    `apprenticeship-tracker-${new Date().toLocaleDateString('en-CA')}.csv`,
    [
      'Status',
      'Title',
      'Employer',
      'Location',
      'Level',
      'University',
      'Closing date',
      'Applied on',
      'Apply link',
      'Notes',
    ],
    rows.map((d) => [
      STATUS_LABELS[d.row.status],
      d.row.title,
      d.row.employer_name,
      locationLabel(d.row),
      d.row.level ?? '',
      d.row.university ?? '',
      d.row.closing_date ?? '',
      d.row.applied_at ?? '',
      rankLinks(d.row)[0]?.url ?? d.row.url,
      d.row.notes_count,
    ]),
  );
}

export default function Tracker() {
  const { derived, isLoading } = useListingData();
  const tracked = useMemo(() => derived.filter((d) => d.row.status !== 'none'), [derived]);
  const byStage = useMemo(() => {
    const out = Object.fromEntries(STAGES.map((s) => [s, [] as Derived[]])) as Record<
      TrackStatus,
      Derived[]
    >;
    for (const d of tracked) out[d.row.status]?.push(d);
    for (const list of Object.values(out))
      list.sort((a, b) => (a.daysToClose ?? 9999) - (b.daysToClose ?? 9999));
    return out;
  }, [tracked]);
  const [params, setParams] = useSearchParams();
  // Remembered in the URL (?stage=applied); otherwise the first stage with something in it.
  const tab = (STAGES as string[]).includes(params.get('stage') ?? '')
    ? params.get('stage')!
    : (STAGES.find((s) => byStage[s].length) ?? 'saved');
  const closingSoon = useMemo(
    () =>
      tracked
        .filter(
          (d) =>
            d.row.is_active &&
            (d.row.status === 'saved' || d.row.status === 'applied') &&
            d.daysToClose !== null &&
            d.daysToClose >= 0 &&
            d.daysToClose <= 7,
        )
        .sort((a, b) => a.daysToClose! - b.daysToClose!),
    [tracked],
  );

  return (
    <Page
      title="Tracker"
      actions={
        <div className="flex items-center gap-2">
          {tracked.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => exportCsv(tracked)}>
              <Download /> Export CSV
            </Button>
          )}
        </div>
      }
    >
      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : tracked.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          Nothing tracked yet. Use the status menu on a listing to save it.
        </div>
      ) : (
        <div className="grid gap-6">
          {closingSoon.length > 0 && (
            <section
              aria-labelledby="closing-soon"
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <h2 id="closing-soon" className="mb-3 flex items-center gap-2 font-semibold">
                <AlarmClock className="size-4 text-destructive" aria-hidden /> Closing within 7 days
              </h2>
              <ul className="grid gap-2">
                {closingSoon.map((d) => (
                  <Row key={d.row.id} d={d} />
                ))}
              </ul>
            </section>
          )}
          <Tabs
            value={tab}
            onValueChange={(v) => setParams({ stage: v }, { replace: true })}
            className="min-w-0"
          >
            <TabsList className="h-auto max-w-full justify-start overflow-x-auto [scrollbar-width:none]">
              {STAGES.map((s) => (
                <TabsTrigger key={s} value={s} className="h-9 flex-none gap-1.5 px-3">
                  <span className={cn('size-2 rounded-full', STATUS_DOT[s])} aria-hidden />
                  {STATUS_LABELS[s]}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {byStage[s].length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            {STAGES.map((s) => (
              <TabsContent key={s} value={s} className="mt-3">
                {byStage[s].length ? (
                  <ul className="grid gap-2">
                    {byStage[s].map((d) => (
                      <Row key={d.row.id} d={d} />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {EMPTY[s]}
                  </p>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}
    </Page>
  );
}

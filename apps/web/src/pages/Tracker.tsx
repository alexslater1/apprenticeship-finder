import { STATUS_LABELS, type TrackStatus } from '@af/shared';
import { AlarmClock, Download, EyeOff } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { ClosingBadge, LevelBadge } from '@/components/badges';
import { STATUS_DOT } from '@/lib/status';
import { useOpenListing } from '@/lib/useOpenListing';
import { Page } from '@/components/Layout';
import { StatusSelect } from '@/components/StatusSelect';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Derived } from '@/lib/derive';
import { formatDate, locationLabel } from '@/lib/format';
import { useListingData } from '@/lib/useListingData';
import { cn } from '@/lib/utils';

const GROUPS: TrackStatus[] = ['saved', 'applied', 'interview', 'offer', 'rejected'];

function Row({ d }: { d: Derived }) {
  const open = useOpenListing();
  const r = d.row;
  return (
    <li className="relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card p-3 hover:bg-accent/40">
      <div className="min-w-0 flex-1 basis-56">
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
      </div>
      <div className="relative z-10 flex items-center gap-3">
        <LevelBadge level={r.level} isDegree={r.is_degree} />
        <span className="text-sm whitespace-nowrap">
          {r.is_active ? (
            <>
              {formatDate(r.closing_date)} <ClosingBadge days={d.daysToClose} className="block" />
            </>
          ) : (
            <span className="text-muted-foreground">Closed</span>
          )}
        </span>
        <StatusSelect row={r} compact />
      </div>
    </li>
  );
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: Derived[]) {
  const header = [
    'Status',
    'Title',
    'Employer',
    'Location',
    'Level',
    'Closing date',
    'Applied on',
    'Apply link',
    'Notes',
  ];
  const lines = rows.map((d) =>
    [
      STATUS_LABELS[d.row.status],
      d.row.title,
      d.row.employer_name,
      locationLabel(d.row),
      d.row.level ?? '',
      d.row.closing_date ?? '',
      d.row.applied_at ?? '',
      d.row.apply_url || d.row.url,
      d.row.notes_count,
    ]
      .map(csvCell)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `apprenticeship-tracker-${new Date().toLocaleDateString('en-CA')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Tracker() {
  const { derived, isLoading } = useListingData();
  const tracked = useMemo(() => derived.filter((d) => d.row.status !== 'none'), [derived]);
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
          <Button variant="ghost" size="sm" asChild>
            <Link to="/hidden">
              <EyeOff /> Hidden
            </Link>
          </Button>
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
          {GROUPS.map((status) => {
            const items = tracked
              .filter((d) => d.row.status === status)
              .sort((a, b) => (a.daysToClose ?? 9999) - (b.daysToClose ?? 9999));
            if (!items.length) return null;
            return (
              <section key={status} aria-labelledby={`g-${status}`}>
                <h2 id={`g-${status}`} className="mb-2 flex items-center gap-2 font-semibold">
                  <span className={cn('size-2.5 rounded-full', STATUS_DOT[status])} aria-hidden />
                  {STATUS_LABELS[status]}
                  <span className="text-sm font-normal text-muted-foreground">{items.length}</span>
                </h2>
                <ul className="grid gap-2">
                  {items.map((d) => (
                    <Row key={d.row.id} d={d} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Page>
  );
}

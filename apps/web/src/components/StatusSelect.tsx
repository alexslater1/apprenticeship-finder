import { STATUS_LABELS, TRACK_STATUSES, type ListingRow, type TrackStatus } from '@af/shared';
import { cn } from '@/lib/utils';
import { useSetStatus } from '@/lib/queries';
import { STATUS_DOT } from '@/lib/status';

/** Native select: best on phones, keyboard-friendly everywhere. */
export function StatusSelect({
  row,
  className,
  compact,
}: {
  row: Pick<ListingRow, 'id' | 'status' | 'applied_at' | 'title'>;
  className?: string;
  compact?: boolean;
}) {
  const setStatus = useSetStatus();
  return (
    <label
      className={cn('relative inline-flex items-center', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="sr-only">Status for {row.title}</span>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-2.5 size-2 rounded-full',
          row.status === 'none' ? 'ring-1 ring-muted-foreground/50' : STATUS_DOT[row.status],
        )}
      />
      <select
        value={row.status}
        onChange={(e) => setStatus(row, e.target.value as TrackStatus)}
        className={cn(
          'h-10 appearance-none rounded-lg border border-input bg-background pr-7 pl-6 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8 dark:bg-input/30',
          compact ? 'w-[7.5rem]' : 'w-full',
        )}
      >
        {TRACK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s === 'none' ? 'Track…' : STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground"
      >
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </label>
  );
}

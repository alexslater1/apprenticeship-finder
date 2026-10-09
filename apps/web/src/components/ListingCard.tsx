import { EyeOff, Eye, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Derived } from '@/lib/derive';
import { formatSalary, locationLabel, milesLabel } from '@/lib/format';
import { useSetHidden } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { ClosingBadge, LevelBadge, MatchChip, NewDot, SourceBadges } from './badges';
import { useOpenListing } from '@/lib/useOpenListing';
import { StatusSelect } from './StatusSelect';

export function ListingCard({ d }: { d: Derived }) {
  const r = d.row;
  const setHidden = useSetHidden();
  const open = useOpenListing();
  const salary = formatSalary(r);
  const miles = milesLabel(d.distance);
  return (
    <article
      className={cn(
        'relative rounded-xl border bg-card p-4 shadow-xs transition-colors focus-within:ring-2 focus-within:ring-ring/50 hover:bg-accent/40',
        !r.is_active && 'opacity-60',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <MatchChip score={d.score} />
        <LevelBadge level={r.level} isDegree={r.is_degree} />
        {d.isNew && <NewDot />}
        {!r.is_active && <span className="text-xs text-muted-foreground">Closed</span>}
      </div>
      <h2 className="leading-snug font-semibold">
        {/* The whole card is clickable via this link's ::after overlay. */}
        <a
          href={`#/listing/${r.id}`}
          onClick={(e) => {
            e.preventDefault();
            open(r.id);
          }}
          className="after:absolute after:inset-0 after:content-[''] focus:outline-none"
        >
          {r.title}
        </a>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {r.employer_name} · {locationLabel(r)}
        {miles && ` · ${miles}`}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {salary && <span>{salary}</span>}
        <ClosingBadge days={d.daysToClose} />
      </p>
      <div className="relative z-10 mt-3 flex items-center gap-2">
        <StatusSelect row={r} compact />
        <SourceBadges sources={r.sources} />
        <span className="ml-auto flex items-center gap-1">
          {r.notes_count > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Notes">
              <MessageSquare className="size-3.5" aria-hidden />
              {r.notes_count}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={r.hidden ? `Unhide ${r.title}` : `Hide ${r.title}`}
            onClick={() => setHidden(r.id, !r.hidden, { undo: true })}
          >
            {r.hidden ? <Eye /> : <EyeOff />}
          </Button>
        </span>
      </div>
    </article>
  );
}

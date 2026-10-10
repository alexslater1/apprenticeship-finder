import { matchTier, type GradeFit, type ListingRow } from '@af/shared';
import { cn } from '@/lib/utils';
import { SOURCE_LABELS, SOURCE_SHORT, sourceKey } from '@/lib/derive';
import { closingLabel, levelLabel } from '@/lib/format';

const TIER_STYLE = {
  high: 'bg-match-high/15 text-match-high ring-match-high/30',
  medium: 'bg-match-medium/15 text-match-medium ring-match-medium/30',
  low: 'bg-match-low/15 text-match-low ring-match-low/30',
};
const TIER_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

export function MatchChip({ score, className }: { score: number; className?: string }) {
  const tier = matchTier(score);
  return (
    <span
      title={`Match score ${score}/100`}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold tabular-nums ring-1 ring-inset',
        TIER_STYLE[tier],
        className,
      )}
    >
      {score}
      <span className="font-medium">{TIER_LABEL[tier]}</span>
    </span>
  );
}

export function LevelBadge({
  level,
  isDegree,
}: {
  level: number | null;
  isDegree: boolean | null;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        level !== null && level >= 5
          ? 'bg-primary/10 text-primary ring-primary/25'
          : 'bg-muted text-muted-foreground ring-border',
      )}
    >
      {levelLabel(level, isDegree)}
    </span>
  );
}

export function ClosingBadge({ days, className }: { days: number | null; className?: string }) {
  const label = closingLabel(days);
  if (!label) return null;
  return (
    <span
      className={cn(
        'text-xs font-medium',
        days !== null && days <= 7 ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {label}
    </span>
  );
}

export function SourceBadges({ sources }: { sources: ListingRow['sources'] }) {
  // One tag per source; a source whose only link now says "job not found" is struck through.
  const seen = new Map<string, { url: string; dead: boolean }>();
  for (const s of sources) {
    const prev = seen.get(sourceKey(s.source));
    if (!prev || (prev.dead && !s.dead))
      seen.set(sourceKey(s.source), { url: s.url, dead: !!s.dead });
  }
  return (
    <span className="flex flex-wrap gap-1">
      {[...seen.entries()].map(([key, { url, dead }]) => (
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={
            dead
              ? `${SOURCE_LABELS[key] ?? key}: this link no longer works`
              : (SOURCE_LABELS[key] ?? key)
          }
          className={cn(
            'inline-flex h-5 items-center rounded border px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground',
            dead && 'line-through opacity-60',
          )}
        >
          {SOURCE_SHORT[key] ?? key}
        </a>
      ))}
    </span>
  );
}

export function PreRegisterBadge() {
  return (
    <span
      title="Applications aren't open yet: register your interest to be told when they are."
      className="inline-flex h-6 items-center rounded-md bg-st-interview/15 px-1.5 text-xs font-medium whitespace-nowrap text-st-interview"
    >
      Register interest
    </span>
  );
}

export function NewDot() {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold tracking-wide text-primary-foreground uppercase">
      New
    </span>
  );
}

const FIT: Record<GradeFit, { label: string; className: string }> = {
  meets: {
    label: 'Meets your grades',
    className: 'bg-match-high/15 text-match-high ring-match-high/30',
  },
  close: {
    label: 'Just above your grades',
    className: 'bg-match-medium/15 text-match-medium ring-match-medium/30',
  },
  below: {
    label: 'Above your grades',
    className: 'bg-destructive/10 text-destructive ring-destructive/30',
  },
  subject: {
    label: 'Needs A-level Maths',
    className: 'bg-match-medium/15 text-match-medium ring-match-medium/30',
  },
};

/** How his predicted grades compare with the advert's entry requirements. */
export function GradeFitBadge({ fit }: { fit: GradeFit | null }) {
  if (!fit) return null;
  const f = FIT[fit];
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        f.className,
      )}
    >
      {f.label}
    </span>
  );
}

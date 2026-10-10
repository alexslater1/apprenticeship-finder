import type { EmployerRow } from '@af/shared';
import { Bell, BellOff, ExternalLink, MessageSquare, Star } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { careersUrl, sectionOf, statusLabel, useSetWatch, usualWindow } from '@/lib/companies';
import { ago, formatDate } from '@/lib/format';
import { useSettings, useUpdateScorePrefs } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useFilters } from '@/store/filters';

const STATUS_STYLE = {
  open: 'bg-match-high/15 text-match-high ring-match-high/30',
  soon: 'bg-match-medium/15 text-match-medium ring-match-medium/30',
  closed: 'bg-muted text-muted-foreground ring-border',
  manual: 'bg-primary/10 text-primary ring-primary/25',
  error: 'bg-destructive/10 text-destructive ring-destructive/30',
  unwatched: 'bg-muted text-muted-foreground ring-border',
} as const;

export function StatusPill({ e, className }: { e: EmployerRow; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        STATUS_STYLE[sectionOf(e)],
        className,
      )}
    >
      {statusLabel(e)}
    </span>
  );
}

export function OriginBadge({ origin }: { origin: EmployerRow['origin'] }) {
  if (origin === 'seed') return null;
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-secondary px-1.5 text-xs text-secondary-foreground">
      {origin === 'manual' ? 'Added by you' : 'Discovered'}
    </span>
  );
}

/** Star a company: its listings get a bonus in the match score (Settings → What else counts). */
export function FavouriteButton({ id, name }: { id: string; name: string }) {
  const { data: settings } = useSettings();
  const save = useUpdateScorePrefs();
  const favs = settings?.score_prefs?.favourites ?? [];
  const on = favs.includes(id);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
      title={on ? 'Favourite (boosts its listings)' : 'Add to favourites'}
      onClick={() => save({ favourites: on ? favs.filter((f) => f !== id) : [...favs, id] })}
    >
      <Star className={on ? 'fill-match-medium text-match-medium' : undefined} />
    </Button>
  );
}

export function CompanyCard({ e, onOpen }: { e: EmployerRow; onOpen: () => void }) {
  const setWatch = useSetWatch();
  const navigate = useNavigate();
  const setFilters = useFilters((s) => s.set);
  const usual = usualWindow(e);
  const url = careersUrl(e);
  return (
    <article className="relative min-w-0 rounded-xl border bg-card p-4 shadow-xs transition-colors focus-within:ring-2 focus-within:ring-ring/50 hover:bg-accent/40">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <StatusPill e={e} />
        <OriginBadge origin={e.origin} />
      </div>
      <h3 className="leading-snug font-semibold break-words">
        <a
          href={`#/companies/${e.id}`}
          onClick={(ev) => {
            ev.preventDefault();
            onOpen();
          }}
          className="after:absolute after:inset-0 after:content-[''] focus:outline-none"
        >
          {e.name}
        </a>
      </h3>
      {(e.sector || e.data_schemes?.[0]) && (
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
          {[e.sector, e.data_schemes?.[0]].filter(Boolean).join(' · ')}
        </p>
      )}
      <p className="mt-1 text-sm">
        {e.next_closing ? `Next closing date ${formatDate(e.next_closing)}` : (usual ?? '')}
      </p>
      {e.last_season_first_seen && !e.active_listings && (
        <p className="text-xs text-muted-foreground">
          Last seen open {formatDate(e.last_season_first_seen)}
          {e.last_season_closed && ` – ${formatDate(e.last_season_closed)}`}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {e.status === 'manual' ? 'Not checked automatically' : `Checked ${ago(e.last_checked_at)}`}
      </p>
      <div className="relative z-10 mt-2 flex flex-wrap items-center gap-2">
        {e.active_listings > 0 && (
          <Button
            size="sm"
            onClick={() => {
              setFilters({ employerId: e.id, includeClosed: false });
              navigate('/');
            }}
          >
            View {e.active_listings} listing{e.active_listings === 1 ? '' : 's'}
          </Button>
        )}
        {url && (
          <Button size="sm" variant="outline" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              Careers site <ExternalLink />
            </a>
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1">
          {e.notes_count > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Notes">
              <MessageSquare className="size-3.5" aria-hidden />
              {e.notes_count}
            </span>
          )}
          <FavouriteButton id={e.id} name={e.name} />
          <Button
            variant="ghost"
            size="icon"
            aria-label={e.watch ? `Stop watching ${e.name}` : `Watch ${e.name}`}
            title={e.watch ? 'Stop watching' : 'Watch'}
            onClick={() => setWatch.mutate({ id: e.id, watch: !e.watch })}
          >
            {e.watch ? <Bell /> : <BellOff />}
          </Button>
        </span>
      </div>
    </article>
  );
}

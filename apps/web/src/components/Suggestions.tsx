import type { SuggestionRow } from '@af/shared';
import { Check, ExternalLink, Undo2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { CONNECTOR_LABELS, useDecideSuggestion } from '@/lib/companies';
import { ago, formatDate } from '@/lib/format';
import { SOURCE_LABELS } from '@/lib/derive';

const ORIGIN_LABELS: Record<SuggestionRow['origin'], string> = {
  listing: 'a listing',
  google_jobs: 'Google Jobs',
  web_search: 'a web search',
  lists: 'an employer list',
  ai: 'AI discovery',
  manual: 'you',
};

function Evidence({ s }: { s: SuggestionRow }) {
  const items = s.evidence.slice(0, 3);
  if (!items.length) return null;
  return (
    <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
      {items.map((ev, i) => (
        <li key={i} className="min-w-0 break-words">
          {ev.title ? `“${ev.title}”` : 'Seen'} on {SOURCE_LABELS[ev.source] ?? ev.source}
          {ev.seen_at ? `, ${formatDate(ev.seen_at)}` : ''}
          {ev.url && (
            <>
              {' '}
              <a
                href={ev.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                link <ExternalLink className="size-3" />
              </a>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function Row({ s, children }: { s: SuggestionRow; children: ReactNode }) {
  return (
    <li className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="font-semibold break-words">{s.name ?? s.careers_url}</h3>
        <span className="text-xs text-muted-foreground">
          from {ORIGIN_LABELS[s.origin]} · {ago(s.created_at)}
        </span>
      </div>
      <p className="text-sm">
        {s.detected_connector
          ? `Job system: ${CONNECTOR_LABELS[s.detected_connector] ?? s.detected_connector}`
          : 'Job system: not detected yet'}
      </p>
      <Evidence s={s} />
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

/** Suggested tab: pending suggestions (Watch / Dismiss) and what the rules auto-added this week. */
export function Suggestions({ rows }: { rows: SuggestionRow[] }) {
  const decide = useDecideSuggestion();
  const { session } = useAuth();
  const userId = session?.user.id;
  const pending = rows.filter((s) => s.status === 'pending');
  const [weekAgo] = useState(() => Date.now() - 7 * 86_400_000);
  const autoAdded = rows.filter(
    (s) =>
      s.auto &&
      (s.status === 'added' || s.status === 'approved') &&
      Date.parse(s.created_at) > weekAgo,
  );
  const queued = rows.filter((s) => !s.auto && s.status === 'approved');

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h2 className="font-semibold">Waiting for you ({pending.length})</h2>
        {pending.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {pending.map((s) => (
              <Row key={s.id} s={s}>
                <Button
                  size="sm"
                  onClick={() => decide.mutate({ suggestion: s, decision: 'approved', userId })}
                >
                  <Check /> Watch
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => decide.mutate({ suggestion: s, decision: 'dismissed', userId })}
                >
                  <X /> Dismiss
                </Button>
                {s.careers_url && (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={s.careers_url} target="_blank" rel="noopener noreferrer nofollow">
                      Careers site <ExternalLink />
                    </a>
                  </Button>
                )}
              </Row>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No suggestions waiting. New companies found by the daily run appear here.
          </p>
        )}
      </section>

      {queued.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-semibold">Added, waiting for the next run ({queued.length})</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {queued.map((s) => (
              <Row key={s.id} s={s}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => decide.mutate({ suggestion: s, decision: 'dismissed', userId })}
                >
                  <Undo2 /> Remove
                </Button>
              </Row>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3">
        <h2 className="font-semibold">Auto-added this week ({autoAdded.length})</h2>
        {autoAdded.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {autoAdded.map((s) => (
              <Row key={s.id} s={s}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => decide.mutate({ suggestion: s, decision: 'dismissed', userId })}
                >
                  <Undo2 /> Undo
                </Button>
              </Row>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Companies with a strong listing and a job system we can read are watched automatically.
          </p>
        )}
      </section>
    </div>
  );
}

import { ROLE_LABELS, standardFor, standardUrl } from '@af/shared';
import DOMPurify from 'dompurify';
import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { SOURCE_LABELS, sourceKey, type Derived } from '@/lib/derive';
import { formatDate, formatSalary, milesLabel } from '@/lib/format';
import { useListingDetail, useSetHidden, useUpdateTracking } from '@/lib/queries';
import { AdzunaAttribution, ClosingBadge, LevelBadge, MatchChip, PreRegisterBadge } from './badges';
import { Notes } from './Notes';
import { StatusSelect } from './StatusSelect';

// Links in scraped descriptions open in a new tab, safely.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

interface Qualification {
  weighting?: string;
  qualificationType?: string;
  subject?: string;
  grade?: string;
}

export function ListingDetail({ d, onClose }: { d: Derived | undefined; onClose: () => void }) {
  const { data: detail, isLoading } = useListingDetail(d?.row.id);
  const setHidden = useSetHidden();
  const tracking = useUpdateTracking();
  const rawHtml = detail?.description_html;
  const html = useMemo(
    () =>
      rawHtml
        ? DOMPurify.sanitize(rawHtml, {
            ALLOWED_TAGS: [
              'p',
              'br',
              'ul',
              'ol',
              'li',
              'strong',
              'b',
              'em',
              'i',
              'u',
              'a',
              'h3',
              'h4',
              'h5',
              'blockquote',
            ],
            ALLOWED_ATTR: ['href', 'target', 'rel'],
          })
        : '',
    [rawHtml],
  );

  const r = d?.row;
  const standard = standardFor(r?.lars_code);
  const det = (detail?.details ?? {}) as Record<string, unknown>;
  const quals = (det.qualifications as Qualification[] | undefined) ?? [];

  return (
    <Sheet open={!!d} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="gap-0 overflow-x-hidden overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        {r && (
          <>
            <SheetHeader className="gap-2 border-b pr-12">
              <div className="flex flex-wrap items-center gap-1.5">
                <MatchChip score={d.score} />
                <LevelBadge level={r.level} isDegree={r.is_degree} />
                {r.pre_register && <PreRegisterBadge />}
                <span className="text-xs text-muted-foreground">{ROLE_LABELS[r.role_type]}</span>
                {!r.is_active && (
                  <span className="text-xs font-medium text-destructive">Closed</span>
                )}
              </div>
              <SheetTitle className="text-lg leading-snug">{r.title}</SheetTitle>
              <SheetDescription>
                {r.employer_name}
                {r.primary_city && ` · ${r.primary_city}`}
                {milesLabel(d.distance) && ` · ${milesLabel(d.distance)}`}
              </SheetDescription>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button asChild size="lg">
                  <a href={r.apply_url || r.url} target="_blank" rel="noopener noreferrer">
                    Apply <ExternalLink />
                  </a>
                </Button>
                <StatusSelect row={r} compact className="h-11 sm:h-9" />
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setHidden(r.id, !r.hidden, { undo: true })}
                >
                  {r.hidden ? <Eye /> : <EyeOff />}
                  {r.hidden ? 'Unhide' : 'Hide'}
                </Button>
              </div>
            </SheetHeader>

            <div className="grid gap-6 p-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Fact label="Closes">
                  {formatDate(r.closing_date, { year: true })}{' '}
                  <ClosingBadge days={d.daysToClose} className="block" />
                </Fact>
                <Fact label="Salary">{formatSalary(r) ?? r.salary_text ?? '—'}</Fact>
                <Fact label="Starts">{formatDate(r.start_date, { year: true })}</Fact>
                <Fact label="Standard">
                  {standard ? (
                    <a
                      href={standardUrl(standard.ref)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {r.standard_title ?? standard.title}
                    </a>
                  ) : (
                    (r.standard_title ?? '—')
                  )}
                  {r.lars_code ? (
                    <span className="text-xs text-muted-foreground"> · LARS {r.lars_code}</span>
                  ) : null}
                </Fact>
                <Fact label="University">
                  {r.university ?? (r.is_degree ? 'Not named in the advert' : '—')}
                </Fact>
                <Fact label="Training provider">{r.provider_name ?? '—'}</Fact>
                <Fact label="Duration">{(det.duration as string) ?? '—'}</Fact>
                <Fact label="Hours">{det.hoursPerWeek ? `${det.hoursPerWeek} a week` : '—'}</Fact>
                <Fact label="Posted">
                  {formatDate(r.posted_date ?? r.first_seen_at, { year: true })}
                </Fact>
                <Fact label="Positions">{(det.positions as number) ?? '—'}</Fact>
                <Fact label="Locations">
                  {r.is_national
                    ? 'Nationwide'
                    : (r.locations ?? []).map((l) => l.text).join('; ') || r.nation}
                </Fact>
                {r.status === 'applied' || r.applied_at ? (
                  <Fact label="Applied on">
                    <Input
                      type="date"
                      aria-label="Applied on"
                      value={r.applied_at ?? ''}
                      onChange={(e) =>
                        tracking.mutate({ id: r.id, patch: { applied_at: e.target.value || null } })
                      }
                      className="h-9"
                    />
                  </Fact>
                ) : null}
              </dl>

              {quals.length > 0 && (
                <section>
                  <h3 className="mb-2 font-semibold">Entry requirements</h3>
                  <ul className="grid gap-1 text-sm">
                    {quals.map((q, i) => (
                      <li key={i}>
                        <span className="font-medium">{q.qualificationType}</span> {q.subject}
                        {q.grade && ` · ${q.grade}`}
                        {q.weighting === 'Desired' && (
                          <span className="text-muted-foreground"> (desirable)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-2 font-semibold">Description</h3>
                {isLoading ? (
                  <div className="grid gap-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                  </div>
                ) : html ? (
                  <div
                    className="prose-sm grid gap-3 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_h3]:mt-2 [&_h3]:font-semibold [&_h4]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No description. Open the advert for details.
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 font-semibold">Where it’s listed</h3>
                <ul className="grid gap-1 text-sm">
                  {(
                    detail?.listing_sources ??
                    r.sources.map((s) => ({
                      ...s,
                      first_seen_at: r.first_seen_at,
                      last_seen_at: r.last_seen_at,
                    }))
                  ).map((s) => (
                    <li key={s.source + s.url}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {SOURCE_LABELS[sourceKey(s.source)] ?? s.source}
                      </a>
                      <span className="text-muted-foreground">
                        {' '}
                        · first seen {formatDate(s.first_seen_at)}
                      </span>
                    </li>
                  ))}
                  {typeof det.employerWebsite === 'string' && (
                    <li>
                      <a
                        href={det.employerWebsite}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        Employer website
                      </a>
                    </li>
                  )}
                </ul>
                <div className="mt-2">
                  <AdzunaAttribution sources={r.sources} />
                </div>
                {r.sources.some((s) => s.source === 'faa') && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Contains public sector information licensed under the Open Government Licence
                    v3.0.
                  </p>
                )}
              </section>

              <Notes target={{ kind: 'listing', id: r.id }} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

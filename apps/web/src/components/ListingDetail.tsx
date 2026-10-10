import { rankLinks, ROLE_LABELS, standardFor, standardUrl } from '@af/shared';
import DOMPurify from 'dompurify';
import { Eye, EyeOff } from 'lucide-react';
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
import { formatDate, formatSalary, milesLabel, providerLabel } from '@/lib/format';
import { ApplyButton } from './ApplyButton';
import { WhyThisMatch } from './WhyThisMatch';
import { useEmployers } from '@/lib/companies';
import { useListingDetail, useSetHidden, useUpdateTracking } from '@/lib/queries';
import { AdvertSkills } from './AdvertSkills';
import { ClosingBadge, GradeFitBadge, LevelBadge, MatchChip, PreRegisterBadge } from './badges';
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

/**
 * Plain-text descriptions: keep the source's blank lines; a long single block (Workday, Google)
 * is broken every few sentences so it reads like an advert, not a wall of text.
 */
function paragraphs(text: string): string[] {
  const blocks = text.split(/\n{2,}/);
  if (blocks.length > 1 || text.length < 600) return blocks;
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) out.push(sentences.slice(i, i + 3).join(' '));
  return out;
}

/** Why the description is missing or short, and where the full advert is. */
function MissingNote({ r, textLength }: { r: Derived['row']; textLength: number }) {
  const only = new Set(
    r.sources.map((x) => (x.source.startsWith('employer:') ? 'employer' : x.source)),
  );
  let why: string | null = null;
  if (r.is_lead)
    why = 'This is a line from a careers page or an apprenticeship listing, not a full advert.';
  else if (textLength === 0 && r.pre_register)
    why =
      'Higherin’s “register your interest” pages don’t have a job description yet. The full advert appears when applications open.';
  else if (textLength === 0 && only.has('amazing'))
    why =
      'This comes from the Amazing Apprenticeships listing (a PDF), which only gives the title and a link.';
  else if (textLength === 0) why = 'The source didn’t include a description.';
  else if (textLength < 700 && only.size === 1 && only.has('adzuna'))
    why = 'Adzuna only shares a short summary of each advert.';
  if (!why) return null;
  return (
    <p className="mt-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
      {why}{' '}
      <a
        href={rankLinks(r)[0]?.url ?? r.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-2 hover:underline"
      >
        Open the full advert
      </a>
      .
    </p>
  );
}

/** The provider is worth its own line when it isn't just the university again. */
const universityDiffers = (r: { university: string | null; provider_name: string | null }) =>
  !!r.provider_name && providerLabel(r.provider_name).toLowerCase() !== r.university?.toLowerCase();

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
  // Research notes record which university or provider each employer used last year.
  const { data: employers } = useEmployers();
  const employer = r?.employer_id ? employers?.find((e) => e.id === r.employer_id) : undefined;
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
                <ApplyButton r={r} employer={employer} />
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
                <Fact label="Where you’d study">
                  {r.university ??
                    (r.provider_name
                      ? `${providerLabel(r.provider_name)} (training provider)`
                      : 'Not named in this advert')}
                  {!r.university && employer?.training_provider && (
                    <span className="block text-xs text-muted-foreground">
                      Last cycle at {employer.name}: {employer.training_provider}
                    </span>
                  )}
                </Fact>
                {r.university && r.provider_name && universityDiffers(r) && (
                  <Fact label="Training provider">{providerLabel(r.provider_name)}</Fact>
                )}
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

              <WhyThisMatch d={d} />

              {(quals.length > 0 || r.entry) && (
                <section>
                  <h3 className="mb-2 font-semibold">Entry requirements</h3>
                  {r.entry && (
                    <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{r.entry.summary}</span>
                      <GradeFitBadge fit={d.fit} />
                    </p>
                  )}
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

              <AdvertSkills skills={detail?.skills} />

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
                ) : detail?.description_text ? (
                  <div className="grid gap-3 text-sm leading-relaxed">
                    {paragraphs(detail.description_text).map((p, i) => (
                      <p key={i} className="whitespace-pre-line">
                        {p}
                      </p>
                    ))}
                  </div>
                ) : null}
                {!isLoading && (
                  <MissingNote r={r} textLength={detail?.description_text?.length ?? 0} />
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
                      link_status: s.dead ? ('dead' as const) : null,
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
                        {s.link_status === 'dead' && ' · this link no longer works'}
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
                <div className="mt-2"></div>
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

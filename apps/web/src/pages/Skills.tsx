import { SKILL_CATEGORIES, SKILLS, type SkillCategory, type SkillContext } from '@af/shared';
import { ChevronDown, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { MatchChip } from '@/components/badges';
import { Page } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { downloadCsv } from '@/lib/csv';
import { CONTEXT_LABELS, mostly, rankSkills, type SkillStat } from '@/lib/skills';
import { useListingData } from '@/lib/useListingData';
import { useOpenListing } from '@/lib/useOpenListing';
import { cn } from '@/lib/utils';

const CONTEXT_DOT: Record<SkillContext, string> = {
  asked: 'bg-amber-500',
  taught: 'bg-sky-500',
  job: 'bg-muted-foreground/50',
};

const SHOWN = 12;

function ContextSplit({ s }: { s: SkillStat }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {(['asked', 'taught', 'job'] as const)
        .filter((k) => s[k] > 0)
        .map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={cn('size-2 rounded-full', CONTEXT_DOT[k])} aria-hidden />
            {CONTEXT_LABELS[k]} {s[k]}
          </span>
        ))}
    </span>
  );
}

function SkillRow({ s, rank, top }: { s: SkillStat; rank: number; top: number }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const openListing = useOpenListing();
  const pct = Math.round(s.share * 100);
  const listings = all ? s.listings : s.listings.slice(0, SHOWN);
  return (
    <li className="rounded-lg border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-3 p-3 text-left hover:bg-accent/40"
      >
        <span className="w-6 shrink-0 pt-0.5 text-right text-sm text-muted-foreground tabular-nums">
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{s.label}</span>
            <span className="text-sm tabular-nums">
              {pct}%<span className="sr-only"> of the weighted adverts</span>
            </span>
          </span>
          <span
            className="mt-1.5 block h-2 overflow-hidden rounded-full bg-muted"
            role="presentation"
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${top > 0 ? (s.share / top) * 100 : 0}%` }}
            />
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              In {s.count} {s.count === 1 ? 'advert' : 'adverts'} · mostly{' '}
              {CONTEXT_LABELS[mostly(s)].toLowerCase()}
            </span>
            <ContextSplit s={s} />
          </span>
          {s.blurb && <span className="mt-1 block text-xs text-muted-foreground">{s.blurb}</span>}
        </span>
        <ChevronDown
          className={cn(
            'mt-0.5 size-4 shrink-0 text-muted-foreground transition',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="border-t px-3 py-2">
          <ul className="grid gap-1">
            {listings.map(({ d, ctx }) => (
              <li key={d.row.id}>
                <button
                  type="button"
                  onClick={() => openListing(d.row.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-accent/60"
                >
                  <MatchChip score={d.score} />
                  <span className="min-w-0 flex-1 truncate">
                    {d.row.title}
                    <span className="text-muted-foreground"> · {d.row.employer_name}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                    <span className={cn('size-2 rounded-full', CONTEXT_DOT[ctx])} aria-hidden />
                    {CONTEXT_LABELS[ctx]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {s.listings.length > SHOWN && (
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${s.listings.length}`}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

type Tab = 'all' | SkillCategory;

export default function Skills() {
  const { derived, isLoading, error } = useListingData();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('group') as Tab | null) ?? 'all';
  const [weighted, setWeighted] = useState(true);
  const ranking = useMemo(() => rankSkills(derived, { weighted }), [derived, weighted]);
  const shown = ranking.stats.filter((s) => tab === 'all' || s.category === tab);
  const top = shown[0]?.share ?? 0;

  return (
    <Page
      title="Skills"
      actions={
        <Button
          variant="ghost"
          size="sm"
          disabled={!ranking.stats.length}
          onClick={() =>
            downloadCsv(
              `skills-${new Date().toLocaleDateString('en-CA')}.csv`,
              [
                'Rank',
                'Skill',
                'Group',
                'Share %',
                'Adverts',
                'Asked for',
                'Taught',
                'Part of the job',
              ],
              ranking.stats.map((s, i) => [
                i + 1,
                s.label,
                SKILL_CATEGORIES[s.category],
                Math.round(s.share * 100),
                s.count,
                s.asked,
                s.taught,
                s.job,
              ]),
            )
          }
        >
          <Download /> <span className="hidden sm:inline">Export</span>
        </Button>
      }
    >
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        What the adverts mention, ranked by how much it matters to him.{' '}
        {weighted
          ? 'Each advert counts in proportion to its match score, so the best-fitting adverts count most.'
          : 'Every advert counts the same.'}{' '}
        {!isLoading && (
          <>
            Based on {ranking.basis} live adverts
            {ranking.skipped > 0 &&
              ` (${ranking.skipped} more only have a short summary, so they’re left out)`}
            .
          </>
        )}
      </p>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onValueChange={(v) => setParams(v === 'all' ? {} : { group: v }, { replace: true })}
        >
          <TabsList className="h-auto max-w-full justify-start overflow-x-auto [scrollbar-width:none]">
            <TabsTrigger value="all" className="h-9 flex-none px-3">
              All
            </TabsTrigger>
            {(Object.keys(SKILL_CATEGORIES) as SkillCategory[]).map((c) => (
              <TabsTrigger key={c} value={c} className="h-9 flex-none px-3">
                {SKILL_CATEGORIES[c]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={weighted} onCheckedChange={(v) => setWeighted(v === true)} />
          Weight by match score
        </label>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive"
        >
          {(error as Error).message}
        </p>
      ) : isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No skills found yet. They’re read from advert descriptions after each daily scrape.
        </p>
      ) : (
        <ol className="grid gap-2">
          {shown.map((s, i) => (
            <SkillRow key={s.id} s={s} rank={i + 1} top={top} />
          ))}
        </ol>
      )}

      <details className="mt-6 max-w-3xl rounded-lg border p-3 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">How this works</summary>
        <div className="mt-2 grid gap-2">
          <p>
            Each advert is checked against a list of {SKILLS.length} skills, each with the different
            ways adverts word it (“Power BI”, “PowerBI”). The list lives in{' '}
            <code>config/skills.json</code> and grows as new adverts mention things it doesn’t know.
          </p>
          <p>
            The percentage is the share of adverts that mention the skill. With weighting on, an
            advert scoring 90 counts three times as much as one scoring 30. The bar is relative to
            the top skill in the list.
          </p>
          <p>
            <strong className="text-foreground">Asked for</strong> means the advert lists it as
            something you need (“You’ll need…”, “Experience with… would be useful”).{' '}
            <strong className="text-foreground">Taught</strong> means the training covers it
            (“You’ll learn…”, “training provided”).{' '}
            <strong className="text-foreground">Part of the job</strong> means it’s one of the
            duties. These are read from the wording around each mention, so a few will be wrong.
            Open an advert to see the sentence each skill came from.
          </p>
          <p>
            Hidden adverts, “No” preferences and “register interest” pages are left out, and so are
            adverts with only a short summary (Adzuna, the PDF list).
          </p>
        </div>
      </details>
    </Page>
  );
}

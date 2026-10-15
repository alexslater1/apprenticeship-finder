import type { Location, RawListing } from '@af/shared';
import { employerFromPage, pageTitle, parseJobPosting } from '../connectors/common.ts';
import { db, must } from '../db.ts';
import { htmlToText } from '../pipeline/normalise.ts';
import type { Ctx, Source, SourceResult } from '../types.ts';
import { hostLabel } from './web-search.ts';

/**
 * Jobs added by hand on the Listings page ("Add a job"). Each link is read every run (robots
 * respected): the page's JobPosting if it has one, else its heading and text. A page we can't
 * read still becomes a listing from the link and whatever was typed in, to fill in by hand.
 * These skip the relevance filter: whoever added the job wants to see it.
 */

interface ManualJob {
  id: string;
  url: string;
  title: string | null;
  employer_name: string | null;
}

/** The readable part of a page with no JobPosting: <main> or <article>, else the body. */
function pageText(html: string): string | undefined {
  const part =
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ??
    /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  if (!part) return undefined;
  const text = htmlToText(
    part.replace(/<(script|style|nav|header|footer|form)[^>]*>[\s\S]*?<\/\1>/gi, ' '),
  );
  return text.length > 40 ? text.slice(0, 20_000) : undefined;
}

export function manualListing(job: ManualJob, html: string | null): RawListing {
  const posting = html ? parseJobPosting(html) : null;
  const typedTitle = job.title?.trim() || undefined;
  const typedEmployer = job.employer_name?.trim() || undefined;
  const locations: Location[] = posting?.locations ?? [];
  return {
    source: 'manual',
    sourceId: job.id,
    url: job.url,
    title: typedTitle ?? posting?.title ?? (html ? pageTitle(html) : undefined) ?? job.url,
    employerName:
      typedEmployer ??
      posting?.employer ??
      (html ? employerFromPage(html) : undefined) ??
      hostLabel(job.url),
    descriptionHtml: posting?.descriptionHtml,
    descriptionText: posting?.descriptionHtml ? undefined : html ? pageText(html) : undefined,
    postedDate: posting?.postedDate,
    closingDate: posting?.closingDate,
    locations,
    addedByHand: true,
  };
}

export const manual: Source = {
  id: 'manual',
  enabled: () => true,
  async run(ctx: Ctx): Promise<SourceResult> {
    const jobs = must<ManualJob[]>(
      await db().from('manual_jobs').select('id,url,title,employer_name'),
      'load jobs added by hand',
    );
    const listings: RawListing[] = [];
    let unread = 0;
    for (const job of jobs) {
      let html: string | null = null;
      let error: string | null = null;
      try {
        html = await ctx.http.text(job.url, { robots: true });
      } catch (err) {
        error = (err as Error).message.slice(0, 300);
        unread++;
        ctx.log.info(`couldn't read ${job.url}: ${error}`);
      }
      listings.push(manualListing(job, html));
      if (!ctx.dryRun)
        must(
          await db()
            .from('manual_jobs')
            .update({ checked_at: new Date().toISOString(), error })
            .eq('id', job.id),
          'save job check',
        );
    }
    // Every job on the list, every run: one taken off the list is gone.
    return { listings, complete: true, total: jobs.length, stats: { jobs: jobs.length, unread } };
  },
};

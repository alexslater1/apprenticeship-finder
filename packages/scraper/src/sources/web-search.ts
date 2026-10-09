import { collapseSpaces, decodeEntities, rules, type RawListing } from '@af/shared';
import { z } from 'zod';
import { employerFromPage } from '../connectors/common.ts';
import { detectFrom } from '../connectors/detect.ts';
import { isCandidateTitle, parseJobPosting } from '../connectors/common.ts';
import { discoveryConfig, isAggregator, spend, type SuggestionInput } from '../discovery/config.ts';
import { htmlToText } from '../pipeline/normalise.ts';
import type { Ctx, Source, SourceResult } from '../types.ts';

/**
 * Open web search via Tavily (PLAN.md §6.5 D2, research/discovery.md): catches pages that
 * aren't job ads yet ("applications open in November"), early-careers pages, and adverts on ATS
 * hosts we don't watch. New result URLs are fetched (robots respected, capped): a JobPosting
 * page becomes a listing; an ATS URL or a page about a data apprenticeship becomes a suggestion.
 * Behind a tiny provider interface so Brave or another engine can replace Tavily.
 */

export interface SearchHit {
  title: string;
  url: string;
  content: string;
}

export interface SearchProvider {
  id: string;
  search(
    ctx: Ctx,
    q: { query: string; include_domains?: string[]; exclude_domains?: string[] },
  ): Promise<SearchHit[]>;
}

const TavilyBody = z
  .object({
    results: z.array(
      z
        .object({ title: z.string().nullish(), url: z.string(), content: z.string().nullish() })
        .loose(),
    ),
  })
  .loose();

export const tavily: SearchProvider = {
  id: 'tavily',
  async search(ctx, q) {
    const body = TavilyBody.parse(
      await ctx.http.json('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.env.TAVILY_API_KEY}`,
        },
        body: JSON.stringify({
          query: q.query,
          search_depth: 'basic',
          topic: 'general',
          time_range: 'week',
          country: 'united kingdom',
          max_results: 10,
          ...(q.include_domains ? { include_domains: q.include_domains } : {}),
          ...(q.exclude_domains?.length ? { exclude_domains: q.exclude_domains } : {}),
        }),
      }),
    );
    return body.results.map((r) => ({
      title: r.title ?? '',
      url: r.url,
      content: r.content ?? '',
    }));
  },
};

const SEEN_KEY = 'tavily:seen';
const SEEN_DAYS = 60;

/** A page worth suggesting: it talks about an apprenticeship and data/AI work. */
export function mentionsDataApprenticeship(text: string): boolean {
  return /apprentic/i.test(text) && rules.dataWords.test(text);
}

export const webSearch: Source = {
  id: 'web_search',
  incremental: true,
  enabled: (env) => !!env.TAVILY_API_KEY,
  async run(ctx: Ctx): Promise<SourceResult> {
    const cfg = discoveryConfig().tavily;
    const queries = ctx.dryRun ? cfg.queries.slice(0, 1) : cfg.queries;
    const seen = (await ctx.state.get<Record<string, string>>(SEEN_KEY)) ?? {};
    const cutoff = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - SEEN_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const [u, d] of Object.entries(seen)) if (d < cutoff) delete seen[u];

    const hits = new Map<string, SearchHit>();
    let searched = 0;
    let budgetStop = 'no';
    for (const q of queries) {
      if (!(await spend(ctx, 'budget:tavily', cfg.monthlyBudget))) {
        budgetStop = 'yes';
        break;
      }
      try {
        for (const h of await tavily.search(ctx, { ...q, exclude_domains: cfg.excludeDomains }))
          if (!seen[h.url] && !isAggregator(h.url)) hits.set(h.url, h);
        searched++;
      } catch (err) {
        ctx.log.warn(`query "${q.query}": ${(err as Error).message}`);
      }
    }

    const listings: RawListing[] = [];
    const suggestions: SuggestionInput[] = [];
    let fetched = 0;
    for (const h of hits.values()) {
      seen[h.url] = ctx.today;
      const evidence = {
        source: 'web_search',
        url: h.url,
        title: collapseSpaces(h.title),
        seen_at: ctx.today,
      };
      const detected = detectFrom(h.url);
      if (fetched >= cfg.maxPageFetches) {
        if (detected)
          suggestions.push({
            name: hostLabel(h.url),
            origin: 'web_search',
            careersUrl: h.url,
            evidence,
            detected,
          });
        continue;
      }
      fetched++;
      let html: string;
      try {
        html = await ctx.http.text(h.url, { robots: true });
      } catch (err) {
        ctx.log.info(`skip ${h.url}: ${(err as Error).message}`);
        continue;
      }
      const posting = parseJobPosting(html);
      const name = posting?.employer ?? employerFromPage(html) ?? hostLabel(h.url);
      if (posting?.title && isCandidateTitle(posting.title)) {
        listings.push({
          source: 'web_search',
          sourceId: h.url,
          url: h.url,
          title: posting.title,
          employerName: decodeEntities(name),
          descriptionHtml: posting.descriptionHtml,
          descriptionText: posting.descriptionHtml
            ? htmlToText(posting.descriptionHtml)
            : undefined,
          postedDate: posting.postedDate,
          closingDate: posting.closingDate,
          locations: posting.locations,
        });
      }
      if (
        detected ||
        mentionsDataApprenticeship(`${h.title}\n${h.content}\n${htmlToText(html).slice(0, 20_000)}`)
      ) {
        suggestions.push({ name, origin: 'web_search', careersUrl: h.url, evidence, detected });
      }
    }
    await ctx.state.set(SEEN_KEY, seen);
    return {
      listings,
      suggestions,
      complete: false,
      stats: {
        queries: searched,
        newUrls: hits.size,
        fetched,
        listings: listings.length,
        suggestions: suggestions.length,
        budgetStop,
      },
    };
  },
};

/** 'careers.example.co.uk' → 'Example'; ATS hosts → the tenant ('barclays.wd3…' → 'Barclays'). */
export function hostLabel(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const parts = host.split('.');
  const ats =
    /myworkdayjobs|tal\.net|avature|eightfold|greenhouse|lever|teamtailor|workable|pinpointhq|icims|taleo|csod/.test(
      host,
    );
  const word = ats
    ? parts[0]!
    : (parts.find((p) => !/^(careers?|jobs?|apply|recruitment|work|join)$/.test(p)) ?? parts[0]!);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

import type { RawListing } from '@af/shared';
import type { Env } from './env.ts';
import type { Http } from './http.ts';
import type { Logger } from './log.ts';
import type { StateStore } from './state.ts';
import type { SuggestionInput } from './discovery/config.ts';

export interface Ctx {
  env: Env;
  http: Http;
  log: Logger;
  state: StateStore;
  dryRun: boolean;
  /** Europe/London date of the run, YYYY-MM-DD. */
  today: string;
  /** Source ids already stored for a source (skip detail calls for these). */
  knownSourceIds(source: string): Promise<Set<string>>;
}

export interface SourceResult {
  listings: RawListing[];
  /**
   * True when this was a full sync of everything the source has, so anything we didn't see
   * is gone (feeds closure detection). False for partial/incremental fetches.
   */
  complete: boolean;
  stats: Record<string, number | string>;
  /** Employer boards: every job listed (not just apprenticeships), so 0 candidates isn't an outage. */
  total?: number | null;
  /** Companies the source came across that might be worth watching (web search). */
  suggestions?: SuggestionInput[];
}

/** An aggregator (FAA, Higherin, Reed…), PLAN.md §6.1. */
export interface Source {
  id: string;
  /** Only returns recent ads (e.g. last 3 days), so absence never means closed. */
  incremental?: boolean;
  enabled(env: Env): boolean;
  run(ctx: Ctx): Promise<SourceResult>;
}

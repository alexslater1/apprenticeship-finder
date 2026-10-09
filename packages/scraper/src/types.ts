import type { RawListing } from '@af/shared';
import type { Env } from './env.ts';
import type { Http } from './http.ts';
import type { Logger } from './log.ts';
import type { StateStore } from './state.ts';

export interface Ctx {
  env: Env;
  http: Http;
  log: Logger;
  state: StateStore;
  dryRun: boolean;
  /** Europe/London date of the run, YYYY-MM-DD. */
  today: string;
}

export interface SourceResult {
  listings: RawListing[];
  /**
   * True when this was a full sync of everything the source has, so anything we didn't see
   * is gone (feeds closure detection). False for partial/incremental fetches.
   */
  complete: boolean;
  stats: Record<string, number | string>;
}

/** An aggregator (FAA, Higherin, Reed…), PLAN.md §6.1. */
export interface Source {
  id: string;
  enabled(env: Env): boolean;
  run(ctx: Ctx): Promise<SourceResult>;
}

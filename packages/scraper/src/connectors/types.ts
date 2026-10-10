import type { RawListing } from '@af/shared';
import type { z } from 'zod';
import type { Ctx } from '../types.ts';

/** An employer as stored in `employers` (config/employers.json + runtime status). */
export interface Employer {
  id: string;
  name: string;
  aliases: string[];
  connector: string | null;
  connector_config: Record<string, unknown>;
  early_careers_url?: string | null;
  job_search_url?: string | null;
  watch?: boolean;
  status?: EmployerStatus;
  last_total_jobs?: number | null;
  page_hash?: string | null;
  origin?: string;
}

export type EmployerStatus = 'unknown' | 'open' | 'closed' | 'blocked' | 'error' | 'manual';

export interface EmployerCtx extends Ctx {
  employer: Employer;
  /** `employer:{id}` — the listing_sources source for this employer. */
  source: string;
  /** Job ids already stored for this employer (skip detail calls for these). */
  known: Set<string>;
}

export interface ConnectorResult {
  /** Apprenticeship candidates (title says apprentice/school leaver, or a facet says so), detailed. */
  jobs: RawListing[];
  /** Every job the employer lists (all countries if the board can't filter), for health alerts. */
  total: number | null;
  /** The whole board was read, so a stored job we didn't see has gone. */
  complete: boolean;
  /** pagehash: the new hash of the watched page. */
  pageHash?: string;
  stats?: Record<string, number | string>;
}

/** An ATS adapter (PLAN.md §6.1). Config shapes live in research/ats-platforms.md §20. */
export interface Connector<C = Record<string, unknown>> {
  id: string;
  config: z.ZodType<C>;
  run(cfg: C, ctx: EmployerCtx): Promise<ConnectorResult>;
  /** Config from a careers/job URL (and optionally its HTML), for `detect-ats` and Add company. */
  detect?(url: string, html?: string): Record<string, unknown> | null;
}

export const defineConnector = <C>(c: Connector<C>): Connector<C> => c;

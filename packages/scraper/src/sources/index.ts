import type { Source } from '../types.ts';
import { adzuna } from './adzuna.ts';
import { amazing } from './amazing.ts';
import { faa } from './faa.ts';
import { googleJobs } from './google-jobs.ts';
import { higherin } from './higherin.ts';
import { ngtu } from './ngtu.ts';
import { ni } from './ni.ts';
import { reed } from './reed.ts';
import { scot } from './scot.ts';
import { wales } from './wales.ts';
import { webSearch } from './web-search.ts';

/** Aggregator sources in run order (PLAN.md §6.2). Earlier sources win titles when merged. */
export const SOURCES: Source[] = [
  faa,
  higherin,
  reed,
  adzuna,
  scot,
  wales,
  ni,
  amazing,
  ngtu,
  googleJobs,
  webSearch,
];

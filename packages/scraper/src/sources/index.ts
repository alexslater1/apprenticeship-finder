import type { Source } from '../types.ts';
import { adzuna } from './adzuna.ts';
import { amazing } from './amazing.ts';
import { faa } from './faa.ts';
import { higherin } from './higherin.ts';
import { ngtu } from './ngtu.ts';
import { reed } from './reed.ts';

/** Aggregator sources in run order (PLAN.md §6.2). Earlier sources win titles when merged. */
export const SOURCES: Source[] = [faa, higherin, reed, adzuna, amazing, ngtu];

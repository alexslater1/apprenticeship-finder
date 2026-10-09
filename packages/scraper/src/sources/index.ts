import type { Source } from '../types.ts';
import { faa } from './faa.ts';

/** Aggregator sources in run order (PLAN.md §6.2). */
export const SOURCES: Source[] = [faa];

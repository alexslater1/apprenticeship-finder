import type { Source } from '../types.ts';
import { faa } from './faa.ts';

/** Aggregator sources in run order. */
export const SOURCES: Source[] = [faa];

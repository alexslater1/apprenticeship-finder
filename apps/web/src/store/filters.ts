import type { Nation, RoleType } from '@af/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type SortKey = 'score' | 'closing' | 'newest' | 'salary' | 'distance';

export interface Filters {
  search: string;
  roles: RoleType[];
  levels: number[];
  nations: Nation[];
  region: string;
  city: string;
  /** Miles from home; null = any distance. */
  maxDistance: number | null;
  onlyKnownLocation: boolean;
  salaryMin: number | null;
  closingWithinDays: number | null;
  postedWithinDays: number | null;
  sources: string[];
  degreeOnly: boolean;
  includeHidden: boolean;
  includeClosed: boolean;
  /** Levels outside 4–7 are hidden unless asked for (BRIEF: store other levels, hide by default). */
  includeLowLevels: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = {
  search: '',
  roles: [],
  levels: [],
  nations: [],
  region: '',
  city: '',
  maxDistance: null,
  onlyKnownLocation: false,
  salaryMin: null,
  closingWithinDays: null,
  postedWithinDays: null,
  sources: [],
  degreeOnly: false,
  includeHidden: false,
  includeClosed: false,
  includeLowLevels: false,
  sort: 'score',
};

interface FilterStore extends Filters {
  set: (patch: Partial<Filters>) => void;
  reset: () => void;
}

// Remembered per device (a convenience only; nothing breaks if storage is unavailable).
const safeStorage = createJSONStorage(() => {
  try {
    const k = '__af_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
  }
});

export const useFilters = create<FilterStore>()(
  persist(
    (set) => ({
      ...DEFAULT_FILTERS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_FILTERS }),
    }),
    { name: 'af:filters', version: 1, storage: safeStorage },
  ),
);

/** How many filters differ from the defaults (badge on the Filters button). */
export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.roles.length) n++;
  if (f.levels.length) n++;
  if (f.nations.length) n++;
  if (f.region) n++;
  if (f.city) n++;
  if (f.maxDistance !== null) n++;
  if (f.salaryMin !== null) n++;
  if (f.closingWithinDays !== null) n++;
  if (f.postedWithinDays !== null) n++;
  if (f.sources.length) n++;
  if (f.degreeOnly) n++;
  if (f.includeHidden) n++;
  if (f.includeClosed) n++;
  if (f.includeLowLevels) n++;
  if (f.onlyKnownLocation) n++;
  return n;
}

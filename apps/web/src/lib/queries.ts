import type { ListingRow, ScorePrefs, SettingsRow, TrackStatus } from '@af/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from './supabase';

export const keys = {
  listings: ['listings'] as const,
  settings: ['settings'] as const,
  detail: (id: string) => ['listing', id] as const,
  notes: (t: NoteTarget) => ['notes', t.kind, t.id] as const,
  employers: ['employers'] as const,
  suggestions: ['suggestions'] as const,
  runs: ['scrape_runs'] as const,
};

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** All listings (no descriptions), paged past PostgREST's 1000-row cap. */
async function fetchListings(): Promise<ListingRow[]> {
  const out: ListingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('v_listings')
      .select('*')
      .order('score', { ascending: false })
      .range(from, from + 999);
    fail('Loading listings', error);
    out.push(...((data ?? []) as ListingRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function useListings() {
  return useQuery({ queryKey: keys.listings, queryFn: fetchListings });
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
      fail('Loading settings', error);
      return data as SettingsRow;
    },
  });
}

export interface ListingDetail {
  id: string;
  description_html: string | null;
  description_text: string | null;
  details: Record<string, unknown> | null;
  listing_sources: Array<{
    source: string;
    url: string;
    first_seen_at: string;
    last_seen_at: string;
    link_status: 'ok' | 'dead' | 'unknown' | null;
  }>;
}

export function useListingDetail(id: string | undefined) {
  return useQuery({
    queryKey: keys.detail(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select(
          'id,description_html,description_text,details,listing_sources(source,url,first_seen_at,last_seen_at,link_status)',
        )
        .eq('id', id!)
        .single();
      fail('Loading listing', error);
      return data as ListingDetail;
    },
  });
}

export interface Note {
  id: string;
  listing_id: string | null;
  employer_id: string | null;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

/** Notes hang off a listing or an employer. */
export interface NoteTarget {
  kind: 'listing' | 'employer';
  id: string;
}

const noteColumn = (t: NoteTarget) => (t.kind === 'listing' ? 'listing_id' : 'employer_id');

export function useNotes(target: NoteTarget | undefined) {
  return useQuery({
    queryKey: keys.notes(target ?? { kind: 'listing', id: '' }),
    enabled: !!target?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq(noteColumn(target!), target!.id)
        .order('created_at', { ascending: true });
      fail('Loading notes', error);
      return (data ?? []) as Note[];
    },
  });
}

type TrackingPatch = Partial<Pick<ListingRow, 'status' | 'hidden' | 'applied_at'>>;

/** Optimistically patch one listing in the cached list. */
function patchListing(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  patch: Partial<ListingRow>,
) {
  const prev = qc.getQueryData<ListingRow[]>(keys.listings);
  qc.setQueryData<ListingRow[]>(keys.listings, (rows) =>
    rows?.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  );
  return prev;
}

export function useUpdateTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TrackingPatch }) => {
      const row: Record<string, unknown> = { listing_id: id, ...patch };
      if (patch.hidden !== undefined)
        row.hidden_at = patch.hidden ? new Date().toISOString() : null;
      const { error } = await supabase.from('tracking').upsert(row, { onConflict: 'listing_id' });
      fail('Saving', error);
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.listings });
      const extra: Partial<ListingRow> = {};
      if (patch.hidden !== undefined)
        extra.hidden_at = patch.hidden ? new Date().toISOString() : null;
      return { prev: patchListing(qc, id, { ...patch, ...extra }) };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.listings, ctx.prev);
      toast.error((err as Error).message);
    },
  });
}

/** Status change; sets applied_at the first time a listing is marked applied. */
export function useSetStatus() {
  const m = useUpdateTracking();
  return (row: Pick<ListingRow, 'id' | 'applied_at'>, status: TrackStatus) =>
    m.mutate({
      id: row.id,
      patch: {
        status,
        ...(status === 'applied' && !row.applied_at
          ? { applied_at: new Date().toLocaleDateString('en-CA') }
          : {}),
      },
    });
}

export function useSetHidden() {
  const m = useUpdateTracking();
  return (id: string, hidden: boolean, opts: { undo?: boolean } = {}) => {
    m.mutate({ id, patch: { hidden } });
    if (opts.undo && hidden) {
      toast('Hidden', {
        description: 'Tick “Show the ones you hid” on Listings to see it again.',
        action: { label: 'Undo', onClick: () => m.mutate({ id, patch: { hidden: false } }) },
      });
    }
  };
}

/** Keep the cached notes_count on listings / employers in step with the thread. */
function bumpNotes(qc: ReturnType<typeof useQueryClient>, t: NoteTarget, by: number) {
  const key = t.kind === 'listing' ? keys.listings : keys.employers;
  qc.setQueryData<Array<{ id: string; notes_count: number }>>(key, (rows) =>
    rows?.map((r) => (r.id === t.id ? { ...r, notes_count: Math.max(0, r.notes_count + by) } : r)),
  );
}

export function useAddNote(target: NoteTarget) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase
        .from('notes')
        .insert({ [noteColumn(target)]: target.id, body });
      fail('Saving note', error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.notes(target) });
      bumpNotes(qc, target, 1);
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useDeleteNote(target: NoteTarget) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await supabase.from('notes').delete().eq('id', noteId);
      fail('Deleting note', error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.notes(target) });
      bumpNotes(qc, target, -1);
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<SettingsRow>) => {
      const { error } = await supabase.from('settings').update(patch).eq('id', 1);
      fail('Saving settings', error);
    },
    onMutate: (patch) => {
      const prev = qc.getQueryData<SettingsRow>(keys.settings);
      if (prev) qc.setQueryData(keys.settings, { ...prev, ...patch });
      return { prev };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.settings, ctx.prev);
      toast.error((err as Error).message);
    },
  });
}

export interface ScrapeRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  trigger: string | null;
  stats: Record<string, Record<string, unknown>> | null;
  error: string | null;
  new_listing_ids: string[] | null;
}

export function useScrapeRuns() {
  return useQuery({
    queryKey: keys.runs,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scrape_runs')
        .select('id,started_at,finished_at,status,trigger,stats,error,new_listing_ids')
        .order('started_at', { ascending: false })
        .limit(10);
      fail('Loading runs', error);
      return (data ?? []) as ScrapeRun[];
    },
  });
}

export interface Budget {
  key: string;
  month: string | null;
  used: number;
  limit: number | null;
}

/** Monthly search budgets the scraper keeps in source_state (SerpApi, Tavily). */
export function useBudgets() {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('source_state')
        .select('key,value')
        .in('key', ['budget:serpapi', 'budget:tavily']);
      fail('Loading budgets', error);
      return (data ?? []).map((r) => {
        const v = r.value as { month?: string; used?: number; limit?: number };
        return {
          key: r.key as string,
          month: v.month ?? null,
          used: v.used ?? 0,
          limit: v.limit ?? null,
        };
      }) as Budget[];
    },
  });
}

/** Merge a change into settings.score_prefs (reads the cached row so quick taps don't clobber). */
export function useUpdateScorePrefs() {
  const qc = useQueryClient();
  const update = useUpdateSettings();
  return (patch: Partial<ScorePrefs>) => {
    const current = qc.getQueryData<SettingsRow>(keys.settings)?.score_prefs ?? {};
    update.mutate({ score_prefs: { ...current, ...patch } });
  };
}

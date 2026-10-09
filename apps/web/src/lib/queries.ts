import type { ListingRow, SettingsRow, TrackStatus } from '@af/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from './supabase';

export const keys = {
  listings: ['listings'] as const,
  settings: ['settings'] as const,
  detail: (id: string) => ['listing', id] as const,
  notes: (id: string) => ['notes', id] as const,
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
  details: Record<string, unknown> | null;
  listing_sources: Array<{
    source: string;
    url: string;
    first_seen_at: string;
    last_seen_at: string;
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
          'id,description_html,details,listing_sources(source,url,first_seen_at,last_seen_at)',
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

export function useNotes(listingId: string | undefined) {
  return useQuery({
    queryKey: keys.notes(listingId ?? ''),
    enabled: !!listingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('listing_id', listingId!)
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
        description: 'Find it again under Hidden.',
        action: { label: 'Undo', onClick: () => m.mutate({ id, patch: { hidden: false } }) },
      });
    }
  };
}

export function useAddNote(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.from('notes').insert({ listing_id: listingId, body });
      fail('Saving note', error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.notes(listingId) });
      qc.setQueryData<ListingRow[]>(keys.listings, (rows) =>
        rows?.map((r) => (r.id === listingId ? { ...r, notes_count: r.notes_count + 1 } : r)),
      );
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useDeleteNote(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await supabase.from('notes').delete().eq('id', noteId);
      fail('Deleting note', error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.notes(listingId) });
      qc.setQueryData<ListingRow[]>(keys.listings, (rows) =>
        rows?.map((r) =>
          r.id === listingId ? { ...r, notes_count: Math.max(0, r.notes_count - 1) } : r,
        ),
      );
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

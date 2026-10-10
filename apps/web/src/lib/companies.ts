import { normaliseEmployerName, type EmployerRow, type SuggestionRow } from '@af/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { keys } from './queries';
import { supabase } from './supabase';

/** Companies page data: the watchlist (`v_employers`) and the discovery queue. */

export function useEmployers() {
  return useQuery({
    queryKey: keys.employers,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_employers').select('*').order('name');
      if (error) throw new Error(`Loading companies: ${error.message}`);
      return (data ?? []) as EmployerRow[];
    },
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: keys.suggestions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employer_suggestions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw new Error(`Loading suggestions: ${error.message}`);
      return (data ?? []) as SuggestionRow[];
    },
  });
}

export function useSetWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, watch }: { id: string; watch: boolean }) => {
      const { error } = await supabase.from('employers').update({ watch }).eq('id', id);
      if (error) throw new Error(`Saving: ${error.message}`);
    },
    onMutate: ({ id, watch }) => {
      const prev = qc.getQueryData<EmployerRow[]>(keys.employers);
      qc.setQueryData<EmployerRow[]>(keys.employers, (rows) =>
        rows?.map((r) => (r.id === id ? { ...r, watch } : r)),
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.employers, ctx.prev);
      toast.error((err as Error).message);
    },
  });
}

function hostName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Add company: an approved suggestion; the next scrape detects its job platform. */
export function useAddCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { url: string; name?: string; note?: string }) => {
      const name = input.name?.trim() || hostName(input.url);
      const { error } = await supabase.from('employer_suggestions').insert({
        name,
        name_norm: normaliseEmployerName(name),
        careers_url: input.url.trim(),
        origin: 'manual',
        status: 'approved',
        evidence: [
          {
            source: 'manual',
            url: input.url.trim(),
            note: input.note?.trim() || undefined,
            seen_at: new Date().toISOString(),
          },
        ],
      });
      if (error) {
        if (error.code === '23505') throw new Error(`${name} is already on the list.`);
        throw new Error(`Adding company: ${error.message}`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.suggestions }),
    onError: (err) => toast.error((err as Error).message),
  });
}

/** Watch (approve) or dismiss a pending suggestion; undo an auto-add (dismiss + unwatch). */
export function useDecideSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      suggestion: SuggestionRow;
      decision: 'approved' | 'dismissed';
      reason?: string;
      userId?: string;
    }) => {
      const { error } = await supabase
        .from('employer_suggestions')
        .update({
          status: input.decision,
          dismiss_reason: input.decision === 'dismissed' ? (input.reason ?? null) : null,
          decided_by: input.userId ?? null,
          decided_at: new Date().toISOString(),
        })
        .eq('id', input.suggestion.id);
      if (error) throw new Error(`Saving: ${error.message}`);
      if (input.decision === 'dismissed' && input.suggestion.employer_id) {
        const { error: e2 } = await supabase
          .from('employers')
          .update({ watch: false })
          .eq('id', input.suggestion.employer_id);
        if (e2) throw new Error(`Unwatching: ${e2.message}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.suggestions });
      qc.invalidateQueries({ queryKey: keys.employers });
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export type Section = 'open' | 'soon' | 'closed' | 'manual' | 'error' | 'unwatched';

export const SECTION_TITLES: Record<Section, string> = {
  open: 'Open now',
  soon: 'Opening soon',
  closed: 'Closed / not yet',
  manual: 'Check manually',
  error: 'Couldn’t check',
  unwatched: 'Not watching',
};

export const SECTION_ORDER: Section[] = ['open', 'soon', 'closed', 'manual', 'error', 'unwatched'];

/** Months from `from` (1–12) forward to `to`, e.g. Oct → Jan = 3. */
const monthsAhead = (from: number, to: number) => (to - from + 12) % 12;

/** PLAN.md §6.4: Open now · Opening soon (usually opens within 2 months) · Closed · Check manually. */
export function sectionOf(e: EmployerRow, today = new Date()): Section {
  if (!e.watch) return 'unwatched';
  if (e.active_listings > 0 || e.status === 'open') return 'open';
  // Collecting names before applications open: as good a sign as it gets that it's coming.
  if (e.interest_listings > 0) return 'soon';
  if (e.status === 'manual' || e.status === 'blocked') return 'manual';
  if (e.opens_month && monthsAhead(today.getMonth() + 1, e.opens_month) <= 2) return 'soon';
  if (e.status === 'error') return 'error';
  return 'closed';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Usually opens Oct, closes Jan" from the parsed months (null when unknown). */
export function usualWindow(e: Pick<EmployerRow, 'opens_month' | 'closes_month'>): string | null {
  const o = e.opens_month ? MONTHS[e.opens_month - 1] : null;
  const c = e.closes_month ? MONTHS[e.closes_month - 1] : null;
  if (o && c) return `Usually opens ${o}, closes ${c}`;
  if (o) return `Usually opens ${o}`;
  if (c) return `Usually closes ${c}`;
  return null;
}

export const CONNECTOR_LABELS: Record<string, string> = {
  workday: 'Workday',
  successfactors: 'SuccessFactors',
  oracle: 'Oracle',
  avature: 'Avature',
  oleeo: 'Oleeo',
  eightfold: 'Eightfold',
  phenom: 'Phenom',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  teamtailor: 'Teamtailor',
  recruitee: 'Recruitee',
  personio: 'Personio',
  pinpoint: 'Pinpoint',
  cornerstone: 'Cornerstone',
  brassring: 'BrassRing',
  'wp-jobs': 'their jobs site',
  jsonld: 'their jobs site',
  pagehash: 'page changes',
  manual: 'by hand',
};

export function statusLabel(e: EmployerRow): string {
  const s = sectionOf(e);
  if (s === 'open')
    return e.active_listings
      ? `Open · ${e.active_listings} listing${e.active_listings === 1 ? '' : 's'}`
      : 'Open';
  if (s === 'soon') return e.interest_listings > 0 ? 'Registering interest' : 'Opening soon';
  if (s === 'manual') return e.status === 'blocked' ? 'Blocks bots' : 'Check by hand';
  if (s === 'error') return 'Couldn’t check';
  if (s === 'unwatched') return 'Not watching';
  return e.status === 'unknown' ? 'Not checked yet' : 'No apprenticeships';
}

/** Where the "Careers site" button goes. */
export const careersUrl = (e: EmployerRow) =>
  e.manual_url ?? e.early_careers_url ?? e.job_search_url ?? null;

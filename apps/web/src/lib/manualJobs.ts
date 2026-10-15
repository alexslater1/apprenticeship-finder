import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { keys } from './queries';
import { supabase } from './supabase';

/** Jobs added by hand ("Add a job"); the next scrape reads each link into a listing. */
export interface ManualJob {
  id: string;
  url: string;
  title: string | null;
  employer_name: string | null;
  created_at: string;
  checked_at: string | null;
  /** Why the page couldn't be read last run (robots.txt, bot wall, 404…). */
  error: string | null;
  /** The listing it became, once a run has read it. */
  listing_id: string | null;
}

export function useManualJobs() {
  return useQuery({
    queryKey: keys.manualJobs,
    queryFn: async () => {
      const [jobs, links] = await Promise.all([
        supabase.from('manual_jobs').select('*').order('created_at', { ascending: false }),
        supabase.from('listing_sources').select('source_id,listing_id').eq('source', 'manual'),
      ]);
      if (jobs.error) throw new Error(`Loading your jobs: ${jobs.error.message}`);
      const listingBy = new Map(
        (links.data ?? []).map((l) => [l.source_id as string, l.listing_id as string]),
      );
      return (jobs.data ?? []).map((j) => ({
        ...j,
        listing_id: listingBy.get(j.id) ?? null,
      })) as ManualJob[];
    },
  });
}

export function useAddJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { url: string; title?: string; employer?: string }) => {
      const { error } = await supabase.from('manual_jobs').insert({
        url: input.url,
        title: input.title?.trim() || null,
        employer_name: input.employer?.trim() || null,
      });
      if (error) {
        if (error.code === '23505') throw new Error('That job is already on your list.');
        throw new Error(`Adding job: ${error.message}`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.manualJobs }),
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useRemoveJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('manual_jobs').delete().eq('id', id);
      if (error) throw new Error(`Removing job: ${error.message}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.manualJobs }),
    onError: (err) => toast.error((err as Error).message),
  });
}

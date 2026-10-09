import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configError =
  !url || !key
    ? 'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set for this build.'
    : null;

// The publishable key is public by design; row-level security protects the data.
// detectSessionInUrl is off because HashRouter owns the hash; main.tsx handles auth redirects.
export const supabase = createClient(url ?? 'http://invalid.local', key ?? 'missing', {
  auth: {
    detectSessionInUrl: false,
    flowType: 'implicit',
    persistSession: true,
    autoRefreshToken: true,
  },
});

/** Where invite / reset emails should send people back to. */
export function appUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

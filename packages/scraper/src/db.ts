import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.ts';

let client: SupabaseClient | undefined;

/** Service client (secret key): bypasses RLS. Never ship this key to the browser. */
export function db(): SupabaseClient {
  if (!client) {
    const e = env();
    client = createClient(e.SUPABASE_URL, e.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Throws with a readable message when a Supabase call fails. */
export function must<T>(
  res: { data: T | null; error: { message: string } | null },
  what: string,
): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

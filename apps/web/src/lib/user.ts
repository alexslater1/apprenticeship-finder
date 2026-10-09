import type { Session } from '@supabase/supabase-js';

/** Short display name for the signed-in user. */
export function displayName(session: Session | null): string {
  const u = session?.user;
  if (!u) return '';
  return (u.user_metadata?.name as string | undefined) || (u.email ?? '').split('@')[0] || 'you';
}

import { supabase } from './supabase';

export const SET_PASSWORD_FLAG = 'af:set-password';
export const AUTH_ERROR_KEY = 'af:auth-error';

/**
 * Supabase invite / password-reset links land on `…/#access_token=…&type=invite|recovery`
 * (or `#error=…`). HashRouter would read that as a route, so consume it before the router
 * mounts, store the session, and continue at #/set-password or #/login.
 */
export async function consumeAuthRedirect(): Promise<void> {
  const { hash, search, pathname } = window.location;
  const hashParams = new URLSearchParams(hash.replace(/^#\/?/, ''));
  const query = new URLSearchParams(search);
  const clean = (route: string) => window.history.replaceState(null, '', `${pathname}#${route}`);

  try {
    if (hashParams.get('error_description') || hashParams.get('error')) {
      sessionStorage.setItem(
        AUTH_ERROR_KEY,
        hashParams.get('error_description')?.replace(/\+/g, ' ') ?? 'That link did not work.',
      );
      clean('/login');
      return;
    }

    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
      const type = hashParams.get('type');
      if (type === 'invite' || type === 'recovery') {
        sessionStorage.setItem(SET_PASSWORD_FLAG, type);
        clean('/set-password');
      } else {
        clean('/');
      }
      return;
    }

    // Newer email templates use ?token_hash=…&type=…; PKCE flows use ?code=….
    const tokenHash = query.get('token_hash');
    const otpType = query.get('type');
    if (tokenHash && (otpType === 'invite' || otpType === 'recovery' || otpType === 'email')) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
      if (error) throw error;
      if (otpType !== 'email') sessionStorage.setItem(SET_PASSWORD_FLAG, otpType);
      window.history.replaceState(
        null,
        '',
        `${pathname}#${otpType === 'email' ? '/' : '/set-password'}`,
      );
      return;
    }
    const code = query.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      sessionStorage.setItem(SET_PASSWORD_FLAG, 'recovery');
      window.history.replaceState(null, '', `${pathname}#/set-password`);
    }
  } catch (err) {
    sessionStorage.setItem(
      AUTH_ERROR_KEY,
      err instanceof Error ? err.message : 'Could not sign you in from that link.',
    );
    window.history.replaceState(null, '', `${pathname}#/login`);
  }
}

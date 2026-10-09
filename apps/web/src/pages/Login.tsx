import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, type Location } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { AUTH_ERROR_KEY } from '@/lib/authRedirect';
import { appUrl, configError, supabase } from '@/lib/supabase';

function takeRedirectError(): string | null {
  const msg = sessionStorage.getItem(AUTH_ERROR_KEY);
  if (msg) sessionStorage.removeItem(AUTH_ERROR_KEY);
  return msg;
}

export default function Login() {
  const { session, loading } = useAuth();
  // Links from the digest (#/listing/…) bounce through here when signed out; go back after.
  const from = (useLocation().state as { from?: Location } | null)?.from;
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => configError ?? takeRedirectError());
  const [info, setInfo] = useState<string | null>(null);

  if (!loading && session) {
    return <Navigate to={from ? { pathname: from.pathname, search: from.search } : '/'} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error)
        setError(
          error.message === 'Invalid login credentials'
            ? 'Wrong email or password.'
            : error.message,
        );
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: appUrl(),
      });
      if (error) setError(error.message);
      else
        setInfo(
          'If that email has an account, a reset link is on its way. Check your spam folder too.',
        );
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Apprenticeship Finder</CardTitle>
          <CardDescription>
            {mode === 'signin'
              ? 'Sign in to see the latest data apprenticeships.'
              : 'We’ll email you a link to set a new password.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {mode === 'signin' && (
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            <Button type="submit" size="lg" disabled={busy || !!configError}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
            </Button>
            <Button
              type="button"
              variant="link"
              className="justify-self-start px-0"
              onClick={() => {
                setMode(mode === 'signin' ? 'reset' : 'signin');
                setError(null);
                setInfo(null);
              }}
            >
              {mode === 'signin' ? 'Forgot your password?' : 'Back to sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

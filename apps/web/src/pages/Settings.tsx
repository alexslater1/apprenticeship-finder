import { normalisePostcode, ROLE_LABELS, ROLE_TYPES, type RoleType } from '@af/shared';
import { Activity, ChevronRight } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Page } from '@/components/Layout';
import { PasswordForm } from '@/components/PasswordForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { useSettings, useUpdateSettings } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'h-9 rounded-full border px-3 text-sm sm:h-8',
        on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function HomePostcode({ initial }: { initial: string }) {
  const update = useUpdateSettings();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!value.trim()) {
      update.mutate({ home_postcode: null, home_lat: null, home_lon: null });
      toast.success('Home postcode removed');
      return;
    }
    const pc = normalisePostcode(value);
    if (!pc) return setError('That doesn’t look like a UK postcode.');
    setBusy(true);
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      const body = (await res.json()) as {
        result?: { latitude: number; longitude: number; admin_district?: string };
      };
      if (!res.ok || !body.result) throw new Error('Postcode not found.');
      update.mutate(
        { home_postcode: pc, home_lat: body.result.latitude, home_lon: body.result.longitude },
        {
          onSuccess: () =>
            toast.success(
              `Home set to ${pc}${body.result?.admin_district ? ` (${body.result.admin_district})` : ''}`,
            ),
        },
      );
    } catch (err) {
      setError(
        (err as Error).message === 'Failed to fetch'
          ? 'Couldn’t reach the postcode service. Try again.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-2">
      <Label htmlFor="postcode">Home postcode</Label>
      <div className="flex gap-2">
        <Input
          id="postcode"
          autoComplete="postal-code"
          placeholder="e.g. LS1 4BN"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          className="max-w-40"
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Save'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Used for distances and the distance filter. Stored in your private database, never in the
        code.
      </p>
    </form>
  );
}

export default function Settings() {
  const { session } = useAuth();
  const { data: s, isLoading } = useSettings();
  const update = useUpdateSettings();

  return (
    <Page title="Settings">
      <div className="grid max-w-2xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-16" />
            ) : (
              <HomePostcode key={s?.home_postcode ?? ''} initial={s?.home_postcode ?? ''} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What you’re looking for</CardTitle>
            <CardDescription>These boost the match score. Shared by both accounts.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {!s ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">Preferred levels</legend>
                  <div className="flex flex-wrap gap-2">
                    {[7, 6, 5, 4, 3].map((l) => (
                      <Chip
                        key={l}
                        on={s.preferred_levels.includes(l)}
                        onClick={() =>
                          update.mutate({
                            preferred_levels: toggle(s.preferred_levels, l).sort((a, b) => b - a),
                          })
                        }
                      >
                        Level {l}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">Preferred roles</legend>
                  <div className="flex flex-wrap gap-2">
                    {ROLE_TYPES.filter((r) => r !== 'other').map((r) => (
                      <Chip
                        key={r}
                        on={s.preferred_roles.includes(r)}
                        onClick={() =>
                          update.mutate({ preferred_roles: toggle<RoleType>(s.preferred_roles, r) })
                        }
                      >
                        {ROLE_LABELS[r]}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-1.5">
                  <Label htmlFor="distance">Happy to travel up to</Label>
                  <select
                    id="distance"
                    value={s.default_distance_miles}
                    onChange={(e) =>
                      update.mutate({ default_distance_miles: Number(e.target.value) })
                    }
                    className="h-10 max-w-48 rounded-lg border border-input bg-background px-2.5 text-sm sm:h-8 dark:bg-input/30"
                  >
                    {[10, 25, 50, 75, 100, 150, 250].map((m) => (
                      <option key={m} value={m}>
                        {m} miles
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily email</CardTitle>
            <CardDescription>
              New matches, closing-soon reminders and companies that just opened.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!s ? (
              <Skeleton className="h-16" />
            ) : (
              <>
                <div className="flex min-h-9 items-center gap-2.5">
                  <Checkbox
                    id="digest"
                    checked={s.digest_enabled}
                    onCheckedChange={(v) => update.mutate({ digest_enabled: v === true })}
                  />
                  <Label htmlFor="digest" className="font-normal">
                    Send the daily email
                  </Label>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="digest-min">Only include new listings scoring at least</Label>
                  <select
                    id="digest-min"
                    value={s.digest_min_score}
                    onChange={(e) => update.mutate({ digest_min_score: Number(e.target.value) })}
                    className="h-10 max-w-48 rounded-lg border border-input bg-background px-2.5 text-sm sm:h-8 dark:bg-input/30"
                  >
                    {[30, 40, 45, 50, 60, 70].map((m) => (
                      <option key={m} value={m}>
                        {m} {m >= 70 ? '(High only)' : m >= 45 ? '(Medium+)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Link
          to="/health"
          className="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm hover:bg-accent/40"
        >
          <Activity className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1">
            <span className="font-medium">Scrape health</span>
            <span className="block text-muted-foreground">Last runs, sources and errors</span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Signed in as {session?.user.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <PasswordForm
              submitLabel="Change password"
              onDone={() => toast.success('Password changed')}
            />
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

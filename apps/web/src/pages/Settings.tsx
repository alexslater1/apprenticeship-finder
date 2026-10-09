import {
  DEFAULT_LEVEL_PREFS,
  DEFAULT_ROLE_PREFS,
  LEVELS,
  normalisePostcode,
  PREF_LABELS,
  PREFS,
  ROLE_LABELS,
  ROLE_TYPES,
  type LevelPrefs,
  type Pref,
} from '@af/shared';
import { Activity, ChevronRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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

const PREF_STYLE: Record<Pref, string> = {
  high: 'bg-match-high text-white',
  maybe: 'bg-match-medium text-black',
  no: 'bg-muted-foreground text-background',
};

/** One row of High / Maybe / No buttons (a radio group). */
function PrefRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Pref;
  onChange: (v: Pref) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <span className="text-sm leading-tight">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-lg border p-0.5">
        {PREFS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value === p}
            onClick={() => onChange(p)}
            className={cn(
              'h-9 min-w-14 rounded-md px-2 text-sm transition-colors sm:h-8 sm:min-w-16',
              value === p ? PREF_STYLE[p] : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {PREF_LABELS[p]}
          </button>
        ))}
      </div>
    </div>
  );
}

const PREF_ROLES = ROLE_TYPES.filter((r) => r !== 'other');

const LEVEL_NAMES: Record<number, string> = {
  7: 'Level 7 (master’s)',
  6: 'Level 6 (degree)',
  5: 'Level 5 (foundation degree)',
  4: 'Level 4 (higher)',
};

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
            <CardDescription>
              High comes first, Maybe after, No is hidden everywhere (including the email). Shared
              by both accounts.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {!s ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <fieldset className="grid gap-2.5">
                  <legend className="mb-1 text-sm font-medium">Roles</legend>
                  {PREF_ROLES.map((r) => (
                    <PrefRow
                      key={r}
                      label={ROLE_LABELS[r]}
                      value={s.role_prefs[r] ?? DEFAULT_ROLE_PREFS[r]}
                      onChange={(v) => update.mutate({ role_prefs: { ...s.role_prefs, [r]: v } })}
                    />
                  ))}
                </fieldset>
                <fieldset className="grid gap-2.5">
                  <legend className="mb-1 text-sm font-medium">Levels</legend>
                  {[...LEVELS].reverse().map((l) => {
                    const key = String(l) as keyof LevelPrefs;
                    return (
                      <PrefRow
                        key={l}
                        label={LEVEL_NAMES[l] ?? `Level ${l}`}
                        value={s.level_prefs[key] ?? DEFAULT_LEVEL_PREFS[key]}
                        onChange={(v) =>
                          update.mutate({ level_prefs: { ...s.level_prefs, [key]: v } })
                        }
                      />
                    );
                  })}
                  <p className="text-xs text-muted-foreground">
                    Levels 2–3 aren’t collected. Listings with no stated level always show.
                  </p>
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

import { gradesToUcas, splitGrades, type ScorePrefs, type SettingsRow } from '@af/shared';
import { Star } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateScorePrefs } from '@/lib/queries';
import { cn } from '@/lib/utils';

const SUBJECTS = [
  'Maths',
  'Further Maths',
  'Computer Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Economics',
  'Business',
  'Geography',
  'History',
  'English',
  'Psychology',
  'Other',
];

const STARTS: Array<[string, string]> = [
  ['', 'Any time'],
  ['2027-07-01', 'July 2027 (after A levels)'],
  ['2027-09-01', 'September 2027'],
  ['2028-01-01', 'January 2028'],
];

const SALARIES = [null, 18000, 20000, 22000, 24000, 26000, 28000, 30000];
const gbp = (n: number) => `£${(n / 1000).toFixed(0)}k`;

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

const selectClass =
  'h-10 w-full max-w-xs rounded-lg border border-input bg-background px-2.5 text-sm sm:h-8 dark:bg-input/30';

function PredictedGrades({ initial }: { initial: string }) {
  const save = useUpdateScorePrefs();
  const [value, setValue] = useState(initial);
  const grades = splitGrades(value);
  const valid =
    !value.trim() ||
    (grades.length >= 2 && grades.join('') === value.toUpperCase().replace(/\s+/g, ''));
  const points = valid && value.trim() ? gradesToUcas(value) : null;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    save({ predictedGrades: value.trim() ? grades.join('') : undefined });
  }
  return (
    <form onSubmit={submit} className="grid gap-1.5">
      <Label htmlFor="grades">Predicted A-level grades</Label>
      <div className="flex gap-2">
        <Input
          id="grades"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. A*AB"
          autoCapitalize="characters"
          className="max-w-40 uppercase"
          aria-invalid={!valid}
        />
        <Button type="submit" variant="outline" disabled={!valid}>
          Save
        </Button>
      </div>
      <p className={cn('text-xs', valid ? 'text-muted-foreground' : 'text-destructive')}>
        {!valid
          ? 'Use grades A*, A, B, C, D or E, e.g. A*AB.'
          : points
            ? `${points} UCAS points (best three). Listings asking for more rank lower.`
            : 'Compared with each advert’s entry requirements where it states grades or UCAS points.'}
      </p>
    </form>
  );
}

/** Settings → "Your grades and start". */
export function GradesCard({ s }: { s: SettingsRow }) {
  const save = useUpdateScorePrefs();
  const sp = s.score_prefs ?? {};
  const subjects = sp.subjects ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your grades and start date</CardTitle>
        <CardDescription>Used to rank listings he can actually apply for higher.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <PredictedGrades key={sp.predictedGrades ?? ''} initial={sp.predictedGrades ?? ''} />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">A-level subjects</legend>
          <div className="flex flex-wrap gap-2">
            {SUBJECTS.map((x) => (
              <Chip
                key={x}
                on={subjects.includes(x)}
                onClick={() =>
                  save({
                    subjects: subjects.includes(x)
                      ? subjects.filter((y) => y !== x)
                      : [...subjects, x],
                  })
                }
              >
                {x}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Adverts that need A-level Maths rank lower if Maths isn’t here.
          </p>
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="start">Earliest start</Label>
          <select
            id="start"
            value={sp.earliestStart ?? ''}
            onChange={(e) => save({ earliestStart: e.target.value || null })}
            className={selectClass}
          >
            {STARTS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Listings that start earlier drop down the list.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

const WEIGHTS: Array<[NonNullable<ScorePrefs['universityWeight']>, string]> = [
  ['off', 'Off'],
  ['some', 'Some'],
  ['lots', 'Lots'],
];

/** Settings → "What else counts". */
export function ExtrasCard({ s }: { s: SettingsRow }) {
  const save = useUpdateScorePrefs();
  const sp = s.score_prefs ?? {};
  const weight = sp.universityWeight ?? 'some';
  return (
    <Card>
      <CardHeader>
        <CardTitle>What else counts</CardTitle>
        <CardDescription>
          Each of these adds to or takes from the match score. See “Why this match” on a listing.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="text-sm leading-tight">
            University ranking
            <span className="block text-xs text-muted-foreground">
              Complete University Guide, computer science or maths table
            </span>
          </span>
          <div
            role="radiogroup"
            aria-label="University ranking"
            className="flex rounded-lg border p-0.5"
          >
            {WEIGHTS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={weight === v}
                onClick={() => save({ universityWeight: v })}
                className={cn(
                  'h-9 min-w-14 rounded-md px-2 text-sm sm:h-8',
                  weight === v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="prefer-degree"
            checked={!!sp.preferDegree}
            onCheckedChange={(v) => save({ preferDegree: v === true })}
          />
          <Label htmlFor="prefer-degree" className="font-normal">
            Prefer degree apprenticeships (a free degree)
          </Label>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="min-salary">Minimum salary</Label>
          <select
            id="min-salary"
            value={sp.minSalary ?? ''}
            onChange={(e) => save({ minSalary: e.target.value ? Number(e.target.value) : null })}
            className={selectClass}
          >
            {SALARIES.map((n) => (
              <option key={n ?? 'none'} value={n ?? ''}>
                {n ? `${gbp(n)} a year` : 'No minimum'}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm">
          <Star className="mr-1.5 inline size-4 align-[-3px] text-match-medium" aria-hidden />
          {sp.favourites?.length
            ? `${sp.favourites.length} favourite ${sp.favourites.length === 1 ? 'company' : 'companies'}.`
            : 'No favourite companies yet.'}{' '}
          <Link to="/companies" className="text-primary hover:underline">
            Star them on Companies
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

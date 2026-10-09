import {
  NATIONS,
  ROLE_LABELS,
  ROLE_TYPES,
  type ListingRow,
  type Nation,
  type RoleType,
} from '@af/shared';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { SOURCE_LABELS, sourceKey } from '@/lib/derive';
import { cn } from '@/lib/utils';
import { activeFilterCount, useFilters, type SortKey } from '@/store/filters';

const SORTS: Array<[SortKey, string]> = [
  ['score', 'Best match'],
  ['closing', 'Closing soonest'],
  ['newest', 'Newest'],
  ['salary', 'Highest salary'],
  ['distance', 'Nearest'],
];

const LEVELS = [7, 6, 5, 4, 3, 2];
const QUICK_ROLES: RoleType[] = ['data_science', 'ml_ai', 'data_analyst', 'data_engineering'];

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
        'h-9 shrink-0 rounded-full border px-3 text-sm whitespace-nowrap transition-colors sm:h-8',
        on
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-background text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

function Check({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex min-h-9 items-center gap-2.5">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

function NumberSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  options: Array<[number | null, string]>;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="h-10 rounded-lg border border-input bg-background px-2.5 text-sm sm:h-8 dark:bg-input/30"
      >
        {options.map(([v, l]) => (
          <option key={l} value={v ?? ''}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FilterBar({
  rows,
  shown,
  total,
  hasHome,
}: {
  rows: ListingRow[];
  shown: number;
  total: number;
  hasHome: boolean;
}) {
  const f = useFilters();
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(f);

  const { regions, cities, sources } = useMemo(() => {
    const regions = new Set<string>();
    const cities = new Set<string>();
    const sources = new Set<string>();
    for (const r of rows) {
      for (const l of r.locations ?? []) {
        if (l.region) regions.add(l.region);
        if (l.city) cities.add(l.city);
      }
      for (const s of r.sources) sources.add(sourceKey(s.source));
    }
    const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { regions: sort(regions), cities: sort(cities), sources: sort(sources) };
  }, [rows]);

  return (
    <div className="sticky top-14 z-20 -mx-4 mb-4 border-b bg-background/95 px-4 pt-1 pb-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search title, employer or place"
            placeholder="Search"
            value={f.search}
            onChange={(e) => f.set({ search: e.target.value })}
            className="pl-8"
          />
        </div>
        <label className="sr-only" htmlFor="sort">
          Sort by
        </label>
        <select
          id="sort"
          value={f.sort}
          onChange={(e) => f.set({ sort: e.target.value as SortKey })}
          className="h-10 w-[7.5rem] shrink-0 rounded-lg border border-input bg-background px-2 text-sm sm:h-8 sm:w-auto dark:bg-input/30"
        >
          {SORTS.map(([k, l]) => (
            <option key={k} value={k} disabled={k === 'distance' && !hasHome}>
              {l}
            </option>
          ))}
        </select>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="shrink-0">
              <SlidersHorizontal />
              <span className="hidden sm:inline">Filters</span>
              {active > 0 && (
                <Badge className="h-5 min-w-5 rounded-full px-1 tabular-nums">{active}</Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
          >
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>
                {shown} of {total} listings shown
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-6 px-4">
              <Section title="Role">
                <div className="flex flex-wrap gap-2">
                  {ROLE_TYPES.map((r) => (
                    <Chip
                      key={r}
                      on={f.roles.includes(r)}
                      onClick={() => f.set({ roles: toggle(f.roles, r) })}
                    >
                      {ROLE_LABELS[r]}
                    </Chip>
                  ))}
                </div>
              </Section>

              <Section title="Level">
                <div className="flex flex-wrap gap-2">
                  {LEVELS.map((l) => (
                    <Chip
                      key={l}
                      on={f.levels.includes(l)}
                      onClick={() => f.set({ levels: toggle(f.levels, l) })}
                    >
                      L{l}
                    </Chip>
                  ))}
                </div>
                <Check
                  id="f-degree"
                  label="Degree apprenticeships only"
                  checked={f.degreeOnly}
                  onChange={(v) => f.set({ degreeOnly: v })}
                />
                {f.levels.length === 0 && (
                  <Check
                    id="f-low"
                    label="Include levels 2–3"
                    checked={f.includeLowLevels}
                    onChange={(v) => f.set({ includeLowLevels: v })}
                  />
                )}
              </Section>

              <Section title="Where">
                <div className="flex flex-wrap gap-2">
                  {NATIONS.filter((n) => n !== 'Unknown').map((n) => (
                    <Chip
                      key={n}
                      on={f.nations.includes(n)}
                      onClick={() => f.set({ nations: toggle(f.nations, n as Nation) })}
                    >
                      {n}
                    </Chip>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="f-region">Region</Label>
                    <select
                      id="f-region"
                      value={f.region}
                      onChange={(e) => f.set({ region: e.target.value })}
                      className="h-10 rounded-lg border border-input bg-background px-2.5 text-sm sm:h-8 dark:bg-input/30"
                    >
                      <option value="">Any</option>
                      {regions.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="f-city">Town or city</Label>
                    <Input
                      id="f-city"
                      list="f-cities"
                      value={f.city}
                      placeholder="Any"
                      onChange={(e) => f.set({ city: e.target.value })}
                    />
                    <datalist id="f-cities">
                      {cities.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <div className="grid gap-2 pt-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="f-distance">Distance from home</Label>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {f.maxDistance === null ? 'Any' : `${f.maxDistance} mi`}
                    </span>
                  </div>
                  {hasHome ? (
                    <>
                      <Slider
                        id="f-distance"
                        min={5}
                        max={200}
                        step={5}
                        value={[f.maxDistance ?? 200]}
                        onValueChange={([v]) =>
                          f.set({ maxDistance: v === undefined || v >= 200 ? null : v })
                        }
                        aria-label="Maximum distance in miles"
                      />
                      <Check
                        id="f-known"
                        label="Hide listings with no known location"
                        checked={f.onlyKnownLocation}
                        onChange={(v) => f.set({ onlyKnownLocation: v })}
                      />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Add a home postcode in{' '}
                      <Link
                        to="/settings"
                        className="text-primary underline"
                        onClick={() => setOpen(false)}
                      >
                        Settings
                      </Link>{' '}
                      to filter by distance.
                    </p>
                  )}
                </div>
              </Section>

              <Section title="Dates and pay">
                <div className="grid grid-cols-2 gap-3">
                  <NumberSelect
                    id="f-closing"
                    label="Closing within"
                    value={f.closingWithinDays}
                    onChange={(v) => f.set({ closingWithinDays: v })}
                    options={[
                      [null, 'Any time'],
                      [7, '7 days'],
                      [14, '14 days'],
                      [30, '30 days'],
                      [60, '60 days'],
                    ]}
                  />
                  <NumberSelect
                    id="f-posted"
                    label="Posted in last"
                    value={f.postedWithinDays}
                    onChange={(v) => f.set({ postedWithinDays: v })}
                    options={[
                      [null, 'Any time'],
                      [1, '24 hours'],
                      [3, '3 days'],
                      [7, '7 days'],
                      [30, '30 days'],
                    ]}
                  />
                  <NumberSelect
                    id="f-salary"
                    label="Salary at least"
                    value={f.salaryMin}
                    onChange={(v) => f.set({ salaryMin: v })}
                    options={[
                      [null, 'Any'],
                      [15000, '£15,000'],
                      [18000, '£18,000'],
                      [21000, '£21,000'],
                      [24000, '£24,000'],
                      [28000, '£28,000'],
                    ]}
                  />
                </div>
              </Section>

              {sources.length > 1 && (
                <Section title="Source">
                  <div className="flex flex-wrap gap-2">
                    {sources.map((s) => (
                      <Chip
                        key={s}
                        on={f.sources.includes(s)}
                        onClick={() => f.set({ sources: toggle(f.sources, s) })}
                      >
                        {SOURCE_LABELS[s] ?? s}
                      </Chip>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="Also show">
                <Check
                  id="f-hidden"
                  label="Hidden listings"
                  checked={f.includeHidden}
                  onChange={(v) => f.set({ includeHidden: v })}
                />
                <Check
                  id="f-closed"
                  label="Closed listings"
                  checked={f.includeClosed}
                  onChange={(v) => f.set({ includeClosed: v })}
                />
              </Section>
            </div>
            <SheetFooter className="sticky bottom-0 flex-row border-t bg-popover">
              <Button variant="outline" className="flex-1" onClick={() => f.reset()}>
                Reset
              </Button>
              <Button className="flex-1" onClick={() => setOpen(false)}>
                Show {shown}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {QUICK_ROLES.map((r) => (
          <Chip
            key={r}
            on={f.roles.includes(r)}
            onClick={() => f.set({ roles: toggle(f.roles, r) })}
          >
            {ROLE_LABELS[r]}
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
        {[6, 5, 4].map((l) => (
          <Chip
            key={l}
            on={f.levels.includes(l)}
            onClick={() => f.set({ levels: toggle(f.levels, l) })}
          >
            L{l}
          </Chip>
        ))}
        {active > 0 && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => f.reset()}>
            <X /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}

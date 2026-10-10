import type { EmployerRow } from '@af/shared';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { AddCompany } from '@/components/AddCompany';
import { CompanyCard } from '@/components/CompanyCard';
import { CompanyDetail } from '@/components/CompanyDetail';
import { Page } from '@/components/Layout';
import { Suggestions } from '@/components/Suggestions';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SECTION_ORDER,
  SECTION_TITLES,
  sectionOf,
  useEmployers,
  useSuggestions,
  type Section,
} from '@/lib/companies';

const SECTION_HINTS: Partial<Record<Section, string>> = {
  soon: 'Usually open within the next two months.',
  manual: 'Their sites block automated checks: open the link now and then.',
  error: 'The last check failed; see Health for details.',
};

export default function Companies() {
  const employers = useEmployers();
  const suggestions = useSuggestions();
  const [q, setQ] = useState('');
  const routeId = useMatch('/companies/:id')?.params.id;
  const navigate = useNavigate();

  const grouped = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = new Map<Section, EmployerRow[]>();
    for (const e of employers.data ?? []) {
      const hay =
        `${e.name} ${e.aliases.join(' ')} ${e.sector ?? ''} ${(e.data_schemes ?? []).join(' ')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      const s = sectionOf(e);
      out.set(s, [...(out.get(s) ?? []), e]);
    }
    // Open first by closing date, then by name.
    for (const list of out.values())
      list.sort(
        (a, b) =>
          (a.next_closing ?? '9999').localeCompare(b.next_closing ?? '9999') ||
          a.name.localeCompare(b.name),
      );
    return out;
  }, [employers.data, q]);

  const pending = (suggestions.data ?? []).filter((s) => s.status === 'pending').length;
  const selected = routeId ? employers.data?.find((e) => e.id === routeId) : undefined;

  return (
    <Page title="Companies" actions={<AddCompany />}>
      <Tabs defaultValue="watchlist">
        <TabsList className="mb-4">
          <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          <TabsTrigger value="suggested">
            Suggested
            {pending > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                {pending}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="watchlist">
          <div className="relative mb-4 max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search companies"
              aria-label="Search companies"
              className="pl-8"
            />
          </div>
          {employers.error ? (
            <p
              role="alert"
              className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive"
            >
              {(employers.error as Error).message}
            </p>
          ) : employers.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-8">
              {SECTION_ORDER.filter((s) => grouped.get(s)?.length).map((s) => (
                <section key={s} aria-labelledby={`sec-${s}`} className="grid gap-3">
                  <div>
                    <h2 id={`sec-${s}`} className="font-semibold">
                      {SECTION_TITLES[s]}{' '}
                      <span className="font-normal text-muted-foreground">
                        ({grouped.get(s)!.length})
                      </span>
                    </h2>
                    {SECTION_HINTS[s] && (
                      <p className="text-sm text-muted-foreground">{SECTION_HINTS[s]}</p>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {grouped.get(s)!.map((e) => (
                      <CompanyCard key={e.id} e={e} onOpen={() => navigate(`/companies/${e.id}`)} />
                    ))}
                  </div>
                </section>
              ))}
              {grouped.size === 0 && (
                <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  {employers.data?.length
                    ? 'No companies match that search.'
                    : 'No companies yet. The daily run fills this page.'}
                </p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="suggested">
          {suggestions.isLoading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : (
            <Suggestions rows={suggestions.data ?? []} />
          )}
        </TabsContent>
      </Tabs>
      <CompanyDetail e={selected} onClose={() => navigate('/companies')} />
    </Page>
  );
}

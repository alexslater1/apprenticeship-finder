import { RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { FilterBar } from '@/components/FilterBar';
import { Page } from '@/components/Layout';
import { ListingCard } from '@/components/ListingCard';
import { ListingTable } from '@/components/ListingTable';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { matches, sortDerived } from '@/lib/derive';
import { useListingData } from '@/lib/useListingData';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useFilters } from '@/store/filters';

export default function Listings() {
  const { derived, rows, home, isLoading, error, refetch, isFetching } = useListingData();
  const filters = useFilters();
  const wide = useMediaQuery('(min-width: 1024px)');

  const visible = useMemo(
    () =>
      sortDerived(
        derived.filter((d) => matches(d, filters)),
        filters.sort,
      ),
    [derived, filters],
  );
  const lowLevelHidden = useMemo(
    () =>
      filters.includeLowLevels || filters.levels.length
        ? 0
        : derived.filter((d) => matches(d, { ...filters, includeLowLevels: true })).length -
          visible.length,
    [derived, filters, visible.length],
  );
  const activeCount = useMemo(() => derived.filter((d) => d.row.is_active).length, [derived]);

  return (
    <Page
      title="Listings"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh"
        >
          <RefreshCw className={isFetching ? 'animate-spin' : undefined} /> Refresh
        </Button>
      }
    >
      <FilterBar rows={rows} shown={visible.length} total={activeCount} hasHome={!!home} />

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive"
        >
          {(error as Error).message}
        </p>
      ) : isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {visible.length} {visible.length === 1 ? 'apprenticeship' : 'apprenticeships'}
            {lowLevelHidden > 0 && (
              <>
                {' · '}
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => filters.set({ includeLowLevels: true })}
                >
                  show {lowLevelHidden} more at level 2–3
                </button>
              </>
            )}
          </p>
          {visible.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              {rows.length === 0
                ? 'No listings yet. The daily scrape fills this page.'
                : 'Nothing matches these filters.'}
              {rows.length > 0 && (
                <div className="mt-3">
                  <Button variant="outline" onClick={() => filters.reset()}>
                    Clear filters
                  </Button>
                </div>
              )}
            </div>
          ) : wide ? (
            <ListingTable data={visible} />
          ) : (
            <div className="grid gap-3">
              {visible.map((d) => (
                <ListingCard key={d.row.id} d={d} />
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
}

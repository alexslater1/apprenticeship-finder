import { Download, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { FilterBar } from '@/components/FilterBar';
import { Page } from '@/components/Layout';
import { ListingCard } from '@/components/ListingCard';
import { ListingTable } from '@/components/ListingTable';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { downloadCsv } from '@/lib/csv';
import { matches, prefsFrom, sortDerived, type Derived } from '@/lib/derive';
import { formatSalary, locationLabel } from '@/lib/format';
import { useListingData } from '@/lib/useListingData';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useFilters } from '@/store/filters';

/** The listings on screen (current filters and sort) as a spreadsheet. */
function exportListings(rows: Derived[]) {
  downloadCsv(
    `apprenticeships-${new Date().toLocaleDateString('en-CA')}.csv`,
    [
      'Match',
      'Title',
      'Employer',
      'Location',
      'Level',
      'Degree',
      'University',
      'Salary',
      'Closing date',
      'Status',
      'Link',
    ],
    rows.map((d) => [
      d.score,
      d.row.title,
      d.row.employer_name,
      locationLabel(d.row),
      d.row.level ?? '',
      d.row.is_degree ? 'yes' : '',
      d.row.university ?? '',
      formatSalary(d.row) ?? '',
      d.row.closing_date ?? '',
      d.row.status === 'none' ? '' : d.row.status,
      d.row.apply_url || d.row.url,
    ]),
  );
}

export default function Listings() {
  const { derived, rows, home, settings, isLoading, error, refetch, isFetching } = useListingData();
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
  const prefsHidden = useMemo(
    () => derived.filter((d) => d.excluded && matches({ ...d, excluded: null }, filters)).length,
    [derived, filters],
  );
  const activeCount = useMemo(() => derived.filter((d) => d.row.is_active).length, [derived]);

  return (
    <Page
      title="Listings"
      actions={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportListings(visible)}
            disabled={!visible.length}
            aria-label="Export these listings as CSV"
          >
            <Download /> <span className="hidden sm:inline">Export</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh"
          >
            <RefreshCw className={isFetching ? 'animate-spin' : undefined} /> Refresh
          </Button>
        </div>
      }
    >
      <FilterBar
        rows={rows}
        shown={visible.length}
        total={activeCount}
        hasHome={!!home}
        prefs={prefsFrom(settings)}
      />

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
            {prefsHidden > 0 && (
              <>
                {' · '}
                <Link to="/settings" className="text-primary underline-offset-2 hover:underline">
                  {prefsHidden} hidden by your “No” preferences
                </Link>
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

import { useMemo } from 'react';
import { useOpenListing } from '@/lib/useOpenListing';
import { Page } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, locationLabel } from '@/lib/format';
import { useSetHidden } from '@/lib/queries';
import { useListingData } from '@/lib/useListingData';

export default function Hidden() {
  const { derived, isLoading } = useListingData();
  const setHidden = useSetHidden();
  const open = useOpenListing();
  const hidden = useMemo(
    () =>
      derived
        .filter((d) => d.row.hidden)
        .sort((a, b) => (b.row.hidden_at ?? '').localeCompare(a.row.hidden_at ?? '')),
    [derived],
  );

  return (
    <Page title="Hidden">
      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : hidden.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          Nothing hidden. Listings you hide end up here so you can bring them back.
        </div>
      ) : (
        <ul className="grid gap-2">
          {hidden.map(({ row: r }) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3"
            >
              <div className="min-w-0 flex-1 basis-56">
                <a
                  href={`#/listing/${r.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    open(r.id);
                  }}
                  className="font-medium hover:underline"
                >
                  {r.title}
                </a>
                <p className="text-sm text-muted-foreground">
                  {r.employer_name} · {locationLabel(r)}
                  {r.hidden_at && ` · hidden ${formatDate(r.hidden_at)}`}
                  {!r.is_active && ' · closed'}
                </p>
              </div>
              <Button variant="outline" onClick={() => setHidden(r.id, false)}>
                Unhide
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

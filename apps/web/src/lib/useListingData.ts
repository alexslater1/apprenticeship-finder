import { londonToday } from '@af/shared';
import { useMemo } from 'react';
import { derive, homeFrom } from './derive';
import { useListings, useSettings } from './queries';

/** Listings + settings, with personal score / distance / closing days worked out once. */
export function useListingData() {
  const listings = useListings();
  const settings = useSettings();
  const today = londonToday();
  const derived = useMemo(
    () => derive(listings.data ?? [], settings.data, today),
    [listings.data, settings.data, today],
  );
  return {
    derived,
    rows: listings.data ?? [],
    settings: settings.data,
    home: homeFrom(settings.data),
    isLoading: listings.isLoading || settings.isLoading,
    error: listings.error ?? settings.error,
    refetch: listings.refetch,
    isFetching: listings.isFetching,
  };
}

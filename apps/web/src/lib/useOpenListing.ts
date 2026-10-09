import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

/** Opens a listing over the current page: `?open=<id>`, or the `/listing/:id` route. */
export function useOpenListing() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (id: string) =>
      navigate({
        pathname: pathname.startsWith('/listing/') ? '/' : pathname,
        search: `?open=${id}`,
      }),
    [navigate, pathname],
  );
}

-- Search results (Adzuna, Google Jobs, web search) stop showing an advert long before it closes.
-- An incremental source still counts for a listing that hasn't reached its closing date when
-- the link check last found its page live, so "not seen this week" no longer closes it early.
create or replace function public.mark_missing(
  p_source text,
  p_run_started timestamptz,
  p_grace int default 3,
  p_incremental text[] default '{}'
)
returns table (deactivated int)
language plpgsql set search_path = '' as $$
declare n int := 0; m int := 0;
begin
  update public.listing_sources
     set missed_runs = missed_runs + 1
   where source = p_source and last_seen_at < p_run_started;

  update public.listings l
     set is_active = false, closed_reason = 'gone'
   where l.is_active
     and not exists (
       select 1 from public.listing_sources ls
        where ls.listing_id = l.id
          and case when ls.source = any (p_incremental)
                   then ls.last_seen_at >= now() - interval '7 days'
                     or (l.closing_date >= (now() at time zone 'Europe/London')::date
                         and ls.link_status = 'ok')
                   else ls.missed_runs < p_grace end);
  get diagnostics n = row_count;

  update public.listings
     set is_active = false, closed_reason = 'closing_date_passed'
   where is_active and closing_date < (now() at time zone 'Europe/London')::date;
  get diagnostics m = row_count;

  return query select n + m;
end $$;

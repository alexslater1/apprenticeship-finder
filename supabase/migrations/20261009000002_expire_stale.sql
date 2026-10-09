-- Incremental sources (Adzuna's "posted in the last N days" feed) never tell us a job closed.
-- Retire listings with no closing date when none of their sources has seen them for p_days.
create function public.expire_stale(p_days int default 30)
returns table (deactivated int)
language plpgsql set search_path = '' as $$
declare n int := 0;
begin
  update public.listings l
     set is_active = false, closed_reason = 'stale'
   where l.is_active
     and l.closing_date is null
     and not exists (
       select 1 from public.listing_sources ls
        where ls.listing_id = l.id
          and ls.last_seen_at >= now() - make_interval(days => p_days));
  get diagnostics n = row_count;
  return query select n;
end $$;

revoke execute on function public.expire_stale(int) from public, anon, authenticated;
grant execute on function public.expire_stale(int) to service_role;

-- Incremental sources only show a job for a few days after it's posted, so "not seen today"
-- means nothing for them. A listing is gone when every complete source has missed it
-- p_grace times and no incremental source has seen it in the last week.
drop function public.mark_missing(text, timestamptz, int);
create function public.mark_missing(
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
                   else ls.missed_runs < p_grace end);
  get diagnostics n = row_count;

  update public.listings
     set is_active = false, closed_reason = 'closing_date_passed'
   where is_active and closing_date < (now() at time zone 'Europe/London')::date;
  get diagnostics m = row_count;

  return query select n + m;
end $$;

revoke execute on function public.mark_missing(text, timestamptz, int, text[]) from public, anon, authenticated;
grant execute on function public.mark_missing(text, timestamptz, int, text[]) to service_role;

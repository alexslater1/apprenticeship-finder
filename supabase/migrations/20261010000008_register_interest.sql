-- Register-interest pages ('Register your interest – Data Science 2027') aren't open adverts:
-- an employer with only those is "opening soon", not "open".
create or replace view public.v_employers with (security_invoker = true) as
select
  e.id, e.name, e.aliases, e.origin, e.sector, e.relevance, e.confidence,
  e.early_careers_url, e.job_search_url, e.ats_family, e.connector,
  e.connector_config ->> 'url' as manual_url,
  e.connector_config ->> 'reason' as manual_reason,
  e.data_schemes, e.typical_window, e.opens_month, e.closes_month, e.locations, e.training_provider,
  e.watch, e.status, e.last_checked_at, e.last_ok_at, e.last_error,
  e.last_total_jobs, e.last_apprentice_jobs, e.last_relevant_jobs, e.opened_at, e.notes_md,
  coalesce(c.active_listings, 0) as active_listings,
  c.next_closing,
  c.last_season_first_seen, c.last_season_closed,
  coalesce(n.notes_count, 0) as notes_count,
  coalesce(c.interest_listings, 0) as interest_listings
from public.employers e
left join lateral (
  select
    count(*) filter (where l.is_active and not coalesce((l.details ->> 'preRegister')::boolean, false))::int as active_listings,
    count(*) filter (where l.is_active and coalesce((l.details ->> 'preRegister')::boolean, false))::int as interest_listings,
    min(l.closing_date) filter (where l.is_active and l.closing_date >= current_date) as next_closing,
    min(l.first_seen_at) filter (where not l.is_active) as last_season_first_seen,
    max(coalesce(l.closing_date, l.last_seen_at::date)) filter (where not l.is_active) as last_season_closed
  from public.listings l where l.employer_id = e.id
) c on true
left join lateral (
  select count(*)::int as notes_count from public.notes nt where nt.employer_id = e.id
) n on true;

revoke all on public.v_employers from anon;
grant select on public.v_employers to authenticated;

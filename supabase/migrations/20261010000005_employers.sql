-- Phase 3: employer watchlist.

-- Bot-walled / login-only boards: the Companies page shows a "check manually" link.
alter type public.employer_status add value if not exists 'manual';

-- Page-hash leads ("applications open in November" lines on a careers page) get a badge.
create or replace view public.v_listings with (security_invoker = true) as
select
  l.id, l.dedupe_key, l.title, l.employer_id, l.employer_name, l.url, l.apply_url,
  l.level, l.level_source, l.is_degree, l.lars_code, l.standard_title, l.provider_name,
  l.role_type, l.score, l.score_breakdown,
  l.salary_min, l.salary_max, l.salary_text,
  l.posted_date, l.closing_date, l.start_date,
  l.locations, l.primary_city, l.region, l.nation, l.is_national,
  l.first_seen_at, l.last_seen_at, l.is_active, l.closed_reason,
  coalesce(t.status, 'none'::public.track_status) as status,
  coalesce(t.hidden, false) as hidden,
  t.hidden_at, t.applied_at, t.updated_at as tracking_updated_at,
  coalesce(s.sources, '[]'::jsonb) as sources,
  coalesce(n.notes_count, 0) as notes_count,
  coalesce((l.details ->> 'preRegister')::boolean, false) as pre_register,
  l.university,
  coalesce((l.details ->> 'lead')::boolean, false) as is_lead
from public.listings l
left join public.tracking t on t.listing_id = l.id
left join lateral (
  select jsonb_agg(jsonb_build_object('source', ls.source, 'url', ls.url) order by ls.first_seen_at) as sources
  from public.listing_sources ls where ls.listing_id = l.id
) s on true
left join lateral (
  select count(*)::int as notes_count from public.notes nt where nt.listing_id = l.id
) n on true;

revoke all on public.v_listings from anon;

-- Companies page: each employer with its live listings (from any source) and last season's dates.
create view public.v_employers with (security_invoker = true) as
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
  coalesce(n.notes_count, 0) as notes_count
from public.employers e
left join lateral (
  select
    count(*) filter (where l.is_active)::int as active_listings,
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

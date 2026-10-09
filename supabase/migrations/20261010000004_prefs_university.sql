-- Settings: High / Maybe / No per role type and level (replaces the preferred_* arrays).
alter table public.settings
  add column role_prefs jsonb not null default
    '{"data_science":"high","data_analyst":"high","ml_ai":"maybe","data_engineering":"maybe","software_tech":"maybe","business_analyst":"maybe","other":"maybe"}',
  add column level_prefs jsonb not null default '{"4":"maybe","5":"high","6":"high","7":"maybe"}';

alter table public.settings drop column preferred_levels, drop column preferred_roles;

-- The degree partner of an apprenticeship ("University of Exeter"), from the provider or advert.
alter table public.listings add column university text;

-- Levels 2–3 are out of scope: close what's stored (the scraper no longer collects them).
update public.listings set is_active = false, closed_reason = 'below_min_level'
where is_active and level < 4;

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
  l.university
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

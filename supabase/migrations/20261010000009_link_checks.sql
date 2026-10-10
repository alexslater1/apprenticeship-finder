-- Dead-link checks: each source link's last check ('ok' | 'dead' | 'unknown'), so the dashboard
-- never sends him to a "job not found" page and a listing whose links have all died is closed.
alter table public.listing_sources
  add column link_status text check (link_status in ('ok', 'dead', 'unknown')),
  add column link_checked_at timestamptz;

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
  coalesce((l.details ->> 'lead')::boolean, false) as is_lead,
  l.entry
from public.listings l
left join public.tracking t on t.listing_id = l.id
left join lateral (
  select jsonb_agg(jsonb_build_object('source', ls.source, 'url', ls.url, 'dead', ls.link_status = 'dead') order by ls.first_seen_at) as sources
  from public.listing_sources ls where ls.listing_id = l.id
) s on true
left join lateral (
  select count(*)::int as notes_count from public.notes nt where nt.listing_id = l.id
) n on true;

revoke all on public.v_listings from anon;

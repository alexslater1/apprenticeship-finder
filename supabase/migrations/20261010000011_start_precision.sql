-- How exact listings.start_date is (packages/shared/src/start.ts): 'day', or 'month' when only
-- the month is known (the 1st stands in for it). Dates so far came from sources: exact, except
-- the Amazing Apprenticeships PDF, which only gives months.
alter table public.listings
  add column if not exists start_precision text check (start_precision in ('day', 'month'));

update public.listings l
set start_precision = case
  when extract(day from l.start_date) = 1
    and exists (select 1 from public.listing_sources s where s.listing_id = l.id and s.source = 'amazing')
    and not exists (select 1 from public.listing_sources s where s.listing_id = l.id and s.source <> 'amazing')
  then 'month' else 'day' end
where l.start_date is not null and l.start_precision is null;

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
  l.entry,
  case when l.skills is null then null else coalesce(
    (select jsonb_agg(jsonb_build_object('id', e ->> 'id', 'ctx', e ->> 'ctx'))
     from jsonb_array_elements(l.skills) e), '[]'::jsonb) end as skills,
  l.start_precision
from public.listings l
left join public.tracking t on t.listing_id = l.id
left join lateral (
  select jsonb_agg(jsonb_build_object('source', ls.source, 'url', ls.url, 'dead', ls.link_status = 'dead') order by ls.first_seen_at) as sources
  from public.listing_sources ls where ls.listing_id = l.id
) s on true
left join lateral (
  select count(*)::int as notes_count from public.notes nt where nt.listing_id = l.id
) n on true;

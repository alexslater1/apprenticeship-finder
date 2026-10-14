-- Details corrected by hand on the dashboard: salary, closing date, start date. The scraper keeps
-- them (pipeline/persist.ts); a key that's present wins, even when it's null (left blank).
alter table public.listings add column if not exists edits jsonb;

create or replace function public.edit_listing(p_id uuid, p_edits jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  today date := (now() at time zone 'Europe/London')::date;
begin
  if auth.uid() is null then
    raise exception 'sign in to edit listings';
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into e
    from jsonb_each(p_edits)
   where key in ('salary_min', 'salary_max', 'salary_text', 'closing_date', 'start_date');
  update public.listings l set
    edits = coalesce(l.edits, '{}'::jsonb) || e,
    salary_min = case when e ? 'salary_min' then (e ->> 'salary_min')::numeric else l.salary_min end,
    salary_max = case when e ? 'salary_max' then (e ->> 'salary_max')::numeric else l.salary_max end,
    salary_text = case when e ? 'salary_text' then e ->> 'salary_text' else l.salary_text end,
    closing_date = case when e ? 'closing_date' then (e ->> 'closing_date')::date else l.closing_date end,
    start_date = case when e ? 'start_date' then (e ->> 'start_date')::date else l.start_date end,
    start_precision = case
      when not e ? 'start_date' then l.start_precision
      when e ->> 'start_date' is null then null
      else 'day' end
  where l.id = p_id;
  -- The new closing date decides whether it's still open.
  if e ? 'closing_date' then
    update public.listings l set
      is_active = case
        when l.closing_date < today then false
        when l.closed_reason = 'closing_date_passed' then true
        else l.is_active end,
      closed_reason = case
        when l.closing_date < today then 'closing_date_passed'
        when l.closed_reason = 'closing_date_passed' then null
        else l.closed_reason end
    where l.id = p_id;
  end if;
end $$;

revoke execute on function public.edit_listing(uuid, jsonb) from public, anon;
grant execute on function public.edit_listing(uuid, jsonb) to authenticated;

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
  l.start_precision,
  l.edits
from public.listings l
left join public.tracking t on t.listing_id = l.id
left join lateral (
  select jsonb_agg(jsonb_build_object('source', ls.source, 'url', ls.url, 'dead', ls.link_status = 'dead') order by ls.first_seen_at) as sources
  from public.listing_sources ls where ls.listing_id = l.id
) s on true
left join lateral (
  select count(*)::int as notes_count from public.notes nt where nt.listing_id = l.id
) n on true;

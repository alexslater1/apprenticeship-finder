-- Jobs added by hand on the Listings page ("Add a job"). The scraper's `manual` source reads each
-- link every run (sources/manual.ts); taking one off the list closes its listing.
create table if not exists public.manual_jobs (
  id uuid primary key default gen_random_uuid(),
  url text not null unique check (url ~ '^https?://'),
  title text check (length(title) <= 300),
  employer_name text check (length(employer_name) <= 200),
  added_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  error text
);

alter table public.manual_jobs enable row level security;
create policy "read" on public.manual_jobs for select to authenticated using (true);
create policy "insert" on public.manual_jobs for insert to authenticated with check (true);
create policy "delete" on public.manual_jobs for delete to authenticated using (true);
grant select, insert, delete on public.manual_jobs to authenticated;

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
  l.edits,
  coalesce((l.details ->> 'manual')::boolean, false) as is_manual
from public.listings l
left join public.tracking t on t.listing_id = l.id
left join lateral (
  select jsonb_agg(jsonb_build_object('source', ls.source, 'url', ls.url, 'dead', ls.link_status = 'dead') order by ls.first_seen_at) as sources
  from public.listing_sources ls where ls.listing_id = l.id
) s on true
left join lateral (
  select count(*)::int as notes_count from public.notes nt where nt.listing_id = l.id
) n on true;

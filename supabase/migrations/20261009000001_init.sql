-- Apprenticeship Finder: initial schema (PLAN.md §4).
-- Writes from the scraper use the secret (service_role) key, which bypasses RLS.
-- The web app uses the publishable key + a user JWT; RLS below is the only gate.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.role_type as enum ('data_science','data_analyst','ml_ai','data_engineering','software_tech','business_analyst','other');
create type public.nation as enum ('England','Scotland','Wales','Northern Ireland','UK-wide','Remote','Unknown');
create type public.track_status as enum ('none','saved','applied','interview','offer','rejected');
create type public.employer_status as enum ('unknown','open','closed','blocked','error');
create type public.suggestion_status as enum ('pending','approved','dismissed','added');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.employers (
  id text primary key,                  -- slug, e.g. 'barclays'
  name text not null,
  aliases text[] not null default '{}',
  origin text not null default 'seed',  -- 'seed' | 'discovered' | 'manual'
  sector text,
  relevance text check (relevance in ('core','adjacent')),
  confidence text,
  early_careers_url text,
  job_search_url text,
  ats_family text,
  connector text,
  connector_config jsonb not null default '{}',
  data_schemes text[],
  typical_window text,
  opens_month int check (opens_month between 1 and 12),
  closes_month int check (closes_month between 1 and 12),
  locations text[],
  training_provider text,
  watch boolean not null default true,
  status public.employer_status not null default 'unknown',
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_total_jobs int,
  last_apprentice_jobs int,
  last_relevant_jobs int,
  opened_at timestamptz,
  page_hash text,
  notes_md text
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique not null,
  title text not null,
  employer_id text references public.employers(id) on delete set null,
  employer_name text not null,
  employer_name_norm text not null,
  url text not null,
  apply_url text,
  description_html text,
  description_text text,
  level int check (level between 1 and 8),
  level_source text,
  is_degree boolean,
  lars_code int,
  standard_title text,
  provider_name text,
  role_type public.role_type not null default 'other',
  score int not null default 0,
  score_breakdown jsonb,
  salary_min numeric,
  salary_max numeric,
  salary_text text,
  posted_date date,
  closing_date date,
  start_date date,
  locations jsonb not null default '[]',
  primary_city text,
  region text,
  nation public.nation not null default 'Unknown',
  is_national boolean not null default false,
  details jsonb,                         -- source extras: duration, hours, qualifications, skills…
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  closed_reason text,
  ai jsonb,
  search tsvector generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(employer_name,'') || ' ' || coalesce(description_text,''))
  ) stored
);
create index listings_active_score_idx on public.listings (is_active, score desc);
create index listings_closing_idx on public.listings (closing_date);
create index listings_search_idx on public.listings using gin (search);
create index listings_employer_idx on public.listings (employer_id);

create table public.listing_sources (
  listing_id uuid not null references public.listings(id) on delete cascade,
  source text not null,                  -- 'faa', 'higherin', 'employer:barclays', ...
  source_id text not null,
  url text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missed_runs int not null default 0,    -- consecutive complete runs of this source that didn't see it
  raw jsonb,
  primary key (source, source_id)
);
create index listing_sources_listing_idx on public.listing_sources (listing_id);

create table public.tracking (           -- shared household view: one row per listing
  listing_id uuid primary key references public.listings(id) on delete cascade,
  status public.track_status not null default 'none',
  hidden boolean not null default false,
  hidden_at timestamptz,
  applied_at date,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete cascade,
  employer_id text references public.employers(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  author_name text,
  body text not null check (length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  check (listing_id is not null or employer_id is not null)
);
create index notes_listing_idx on public.notes (listing_id);
create index notes_employer_idx on public.notes (employer_id);

create table public.settings (           -- single row, id = 1
  id int primary key check (id = 1),
  home_postcode text,
  home_lat double precision,
  home_lon double precision,
  preferred_levels int[] not null default '{6,5,4}',
  preferred_roles public.role_type[] not null default '{data_science,data_analyst,ml_ai}',
  default_distance_miles int not null default 50,
  digest_min_score int not null default 40,
  digest_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

create table public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text,                           -- 'running' | 'ok' | 'partial' | 'failed'
  trigger text,                          -- 'schedule' | 'manual' | 'local'
  stats jsonb,
  new_listing_ids uuid[],
  error text
);
create index scrape_runs_started_idx on public.scrape_runs (started_at desc);

create table public.source_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.digest_log (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  kind text,
  recipients text[],
  listing_ids uuid[],
  employer_ids text[]
);

create table public.employer_suggestions (
  id uuid primary key default gen_random_uuid(),
  name text,
  name_norm text unique,
  careers_url text,
  origin text not null default 'manual',
  evidence jsonb not null default '[]',
  detected_connector text,
  detected_config jsonb,
  status public.suggestion_status not null default 'pending',
  auto boolean not null default false,
  dismiss_reason text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  employer_id text references public.employers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers: who/when on user-edited rows
-- ---------------------------------------------------------------------------
create function public.touch_updated() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_table_name = 'tracking' and auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

create trigger tracking_touch before insert or update on public.tracking
  for each row execute function public.touch_updated();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated();
create trigger suggestions_touch before update on public.employer_suggestions
  for each row execute function public.touch_updated();

-- Fill notes.author_name from the author's profile (needs to read auth.users).
create function public.notes_set_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.author_id is not null then
    select coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1))
      into new.author_name
      from auth.users u where u.id = new.author_id;
  end if;
  return new;
end $$;

create trigger notes_author before insert on public.notes
  for each row execute function public.notes_set_author();

-- ---------------------------------------------------------------------------
-- View for the UI (security_invoker so the caller's RLS applies)
-- ---------------------------------------------------------------------------
create view public.v_listings with (security_invoker = true) as
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
  coalesce(n.notes_count, 0) as notes_count
from public.listings l
left join public.tracking t on t.listing_id = l.id
left join lateral (
  select jsonb_agg(jsonb_build_object('source', ls.source, 'url', ls.url) order by ls.first_seen_at) as sources
  from public.listing_sources ls where ls.listing_id = l.id
) s on true
left join lateral (
  select count(*)::int as notes_count from public.notes nt where nt.listing_id = l.id
) n on true;

-- ---------------------------------------------------------------------------
-- Scraper-only functions
-- ---------------------------------------------------------------------------
-- After a complete run of `p_source`, bump missed_runs for rows it didn't see, then
-- deactivate listings whose every source has missed >= p_grace runs, or whose closing date passed.
create function public.mark_missing(p_source text, p_run_started timestamptz, p_grace int default 3)
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
        where ls.listing_id = l.id and ls.missed_runs < p_grace);
  get diagnostics n = row_count;

  update public.listings
     set is_active = false, closed_reason = 'closing_date_passed'
   where is_active and closing_date < (now() at time zone 'Europe/London')::date;
  get diagnostics m = row_count;

  return query select n + m;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges + RLS
-- ---------------------------------------------------------------------------
-- Nothing for anon. Not even table-level grants.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

revoke execute on function public.mark_missing(text, timestamptz, int) from public, authenticated;
grant execute on function public.mark_missing(text, timestamptz, int) to service_role;

alter table public.employers enable row level security;
alter table public.listings enable row level security;
alter table public.listing_sources enable row level security;
alter table public.tracking enable row level security;
alter table public.notes enable row level security;
alter table public.settings enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.source_state enable row level security;
alter table public.digest_log enable row level security;
alter table public.employer_suggestions enable row level security;

-- Read everything when signed in.
create policy "read" on public.employers for select to authenticated using (true);
create policy "read" on public.listings for select to authenticated using (true);
create policy "read" on public.listing_sources for select to authenticated using (true);
create policy "read" on public.tracking for select to authenticated using (true);
create policy "read" on public.notes for select to authenticated using (true);
create policy "read" on public.settings for select to authenticated using (true);
create policy "read" on public.scrape_runs for select to authenticated using (true);
create policy "read" on public.source_state for select to authenticated using (true);
create policy "read" on public.digest_log for select to authenticated using (true);
create policy "read" on public.employer_suggestions for select to authenticated using (true);

-- Shared tracker.
create policy "write" on public.tracking for insert to authenticated with check (true);
create policy "update" on public.tracking for update to authenticated using (true) with check (true);
create policy "delete" on public.tracking for delete to authenticated using (true);

-- Notes: anyone signed in can add as themselves; edit/delete your own.
create policy "insert own" on public.notes for insert to authenticated
  with check ((select auth.uid()) = author_id);
create policy "update own" on public.notes for update to authenticated
  using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "delete own" on public.notes for delete to authenticated
  using ((select auth.uid()) = author_id);

-- Settings: the single shared row.
create policy "update" on public.settings for update to authenticated using (true) with check (id = 1);

-- Employers: only the watch flag.
revoke insert, update, delete on public.employers from authenticated;
grant update (watch) on public.employers to authenticated;
create policy "watch" on public.employers for update to authenticated using (true) with check (true);

-- Suggestions: add company / approve / dismiss.
revoke update on public.employer_suggestions from authenticated;
grant update (status, dismiss_reason, decided_by, decided_at) on public.employer_suggestions to authenticated;
create policy "insert" on public.employer_suggestions for insert to authenticated with check (true);
create policy "decide" on public.employer_suggestions for update to authenticated using (true) with check (true);

-- Scraper-owned tables: no writes for users.
revoke insert, update, delete on public.listings, public.listing_sources, public.scrape_runs,
  public.source_state, public.digest_log from authenticated;
revoke insert, delete on public.settings from authenticated;

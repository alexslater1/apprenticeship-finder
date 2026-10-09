# Apprenticeship Finder: product + codebase plan

Written 2026-10-09. This is the hand-off document for the chat that builds it. Read `BRIEF.md` first (decisions), then this file. The research behind every source lives in `research/`; this plan cites the file to open when you implement each piece.

All research is complete; nothing in this plan is pending. Research files: `gov-api.md`, `job-sites.md`, `ats-platforms.md`, `employers.md` (+ `employers.seed.json`, `employers.excluded.json`), `devolved-nations.md`, `infra.md`.

---

## 1. Product specification (final)

### 1.1 One-paragraph summary
A private, login-only web dashboard that shows every UK apprenticeship relevant to a data-science career (data scientist, data analyst, ML/AI, data engineering; levels 6/5 first, then 4), collected daily from the gov.uk API, employer careers sites and a few job boards. He can filter by place and distance, level, role, salary and closing date; save/track applications with statuses and notes; hide things he's not interested in; see a map; and get one email a day when there's news. A company watchlist shows the big employers whose schemes haven't opened yet and when they usually do.

### 1.2 Users
- **Him** (Year 13, applying for Sept 2027 starts). Primary user, mostly on phone.
- **You** (sibling). Admin: owns the accounts and keys, helps track, adds notes.
- Two accounts, shared view. No public access.

### 1.3 Features by priority
**P0 (must ship first, within days):**
1. Login (email + password). No sign-up page. The login page also handles Supabase **invite and password-reset links** (`#access_token…&type=invite|recovery` in the URL; note it conflicts with HashRouter, so parse it in `main.tsx` before the router mounts) and shows a "Set your password" form (`supabase.auth.updateUser({ password })`). Settings page has "Change password".
2. Listings page: card list (mobile) / table (desktop). Columns: title, employer, location(s), level, role type, salary, closing date, posted/first-seen, score, source badges.
3. Filters: text search; role type; level (multi); nation/region/city; distance from home postcode (slider, needs postcode in settings); salary min; closing within N days; posted in last N days; source; degree-only; hide hidden/closed. Sort: score, closing date, newest, salary, distance.
4. Listing detail: full description (sanitised), all source links, apply link, employer card, standard/LARS info, status control, notes.
5. Tracker: status per listing (`none | saved | applied | interview | offer | rejected`), notes with author + timestamp, hide/unhide, Hidden list page, "Closing soon" panel (saved/applied closing ≤ 7 days).
6. Daily scrape on GitHub Actions writing to Supabase.
7. Daily email digest.

**P1 (same sprint, after P0 works end to end):**
8. Company watchlist page (all seed employers; status open/closed/unknown/blocked; typical window; last checked; link; notes).
9. Map view (Leaflet, UK pins, clustered, click → listing).
10. Settings page: home postcode, preferred levels/roles, default distance, digest preferences (per-listing minimum score).
11. Health page: last scrape run, per-source counts, errors, employers failing/blocked.
12. **Add company**: paste a careers/job URL (+ optional name, note); the next run detects its job platform and starts watching it.
13. **Discovery** (§6.5): web-wide job search (Google for Jobs via SerpApi), open web search (Tavily), and auto-learning employers from every relevant listing. New companies land in a **Suggested** tab on the Companies page; strong ones are auto-watched, others need one tap (Watch / Dismiss).

**P2 (later, optional):**
14. Claude API relevance scoring + field extraction (`ANTHROPIC_API_KEY` present → on).
15. Annual employer lists + monthly AI discovery (§6.5 D4, D5).
16. Playwright for bot-walled employers.
17. PWA install + push notifications.
18. Fuzzy cross-source dedupe.

### 1.4 Non-goals
- No applying from the tool. Always link out.
- No scraping LinkedIn, Indeed, Totaljobs, UCAS, Gradcracker, Bright Network, CV-Library, Prospects, Civil Service Jobs HTML (see `research/job-sites.md` §C "Avoid").
- No multi-tenant / other users.

---

## 2. Architecture

```
┌──────────────────────────────┐        ┌────────────────────────────┐
│ GitHub Actions (cron, daily) │        │ GitHub Pages (static SPA)  │
│  packages/scraper (Node 24)  │        │  apps/web (Vite+React+TS)  │
│   sources/*   connectors/*   │        │  supabase-js + RLS         │
│   classify → score → dedupe  │        │  login required            │
│   upsert → diff → digest     │        └─────────────┬──────────────┘
└──────────────┬───────────────┘                      │ anon key + user JWT
               │ service-role key                     │
               ▼                                      ▼
        ┌──────────────────────────────────────────────────┐
        │ Supabase (free): Postgres + Auth                 │
        │  listings, listing_sources, employers, tracking, │
        │  notes, settings, scrape_runs, source_state      │
        └──────────────────────────────────────────────────┘
```

- Scraper never runs in the browser (gov API has no CORS; keys must stay secret).
- Dashboard talks only to Supabase. No custom backend. All reads/writes go through RLS policies.
- Both repos-in-one: npm workspaces monorepo at `alexslater1/apprenticeship-finder` (public).

### 2.1 Tech choices
| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere, Node 24 (installed), npm workspaces | one language, shared types between scraper and UI |
| Scraper runtime | `tsx` for dev, `tsc` build for CI; native `fetch`; `cheerio` for HTML; `fast-xml-parser` for XML/RSS; `zod` for config and response validation; `p-queue`/`p-limit` for per-host throttling; `robots-parser` | all mature, no browser needed for any verified source |
| DB | Supabase Postgres, migrations in `supabase/migrations/*.sql`, Supabase CLI for local dev (optional) | free tier, auth built in |
| Frontend | Vite + React 19 + TS, React Router (HashRouter), TanStack Query, TanStack Table, Tailwind + shadcn/ui, react-leaflet + OSM tiles, `dompurify` for descriptions, `zustand` for filter state | fast to build, works on GH Pages, no server |
| Email | nodemailer over Gmail SMTP with an App Password (see §9.3) | free, no domain needed |
| Tests | vitest; recorded JSON/HTML fixtures per connector | connectors are the fragile part |
| Lint/format | eslint (typescript-eslint) + prettier | |

Use latest stable versions at build time; don't pin from this doc.

---

## 3. Repository layout

```
apprenticeship-finder/
├── README.md                     # what it is, how to run, setup checklist (§12)
├── BRIEF.md, PLAN.md             # these docs
├── research/                     # research notes (keep; cited by connectors)
├── package.json                  # workspaces: apps/*, packages/*
├── tsconfig.base.json
├── .github/workflows/
│   ├── scrape.yml                # daily cron + manual
│   ├── deploy-web.yml            # build + GitHub Pages
│   └── ci.yml                    # lint, typecheck, test on PR/push
├── config/
│   ├── employers.json            # the seed list, enriched with connector config (§6.3)
│   ├── employers.excluded.json   # checked-and-excluded, with reasons (from research/)
│   ├── standards.json            # LARS codes → {ref, title, level, degree, roleType}
│   ├── uk-places.json            # gazetteer: ~400 UK towns/cities → lat/lon/region/nation
│   └── keywords.json             # role/level/noise regex lists (hot-editable without code)
├── supabase/
│   ├── config.toml
│   ├── migrations/0001_init.sql …
│   └── seed.sql                  # settings row, employers from config (or via scraper `sync-employers`)
├── packages/
│   ├── shared/                   # types, zod schemas, classify/score logic, utils (used by both)
│   │   └── src/{types.ts, schemas.ts, classify.ts, score.ts, normalise.ts, geo.ts, dates.ts}
│   └── scraper/
│       └── src/
│           ├── cli.ts            # commands: scrape, digest, sync-employers, export-employers, detect-ats, discover-lists, backfill
│           ├── run.ts            # orchestrates one scrape run
│           ├── http.ts           # fetch wrapper: UA, timeouts, retries, per-host rate limit, robots check, caching
│           ├── sources/          # aggregators (one file each) implementing Source
│           │   ├── faa.ts, higherin.ts, reed.ts, adzuna.ts, amazing-apprenticeships.ts,
│           │   ├── notgoingtouni.ts, nhs.ts, scot.ts, wales.ts, ni.ts,
│           │   ├── google-jobs.ts (SerpApi), web-search.ts (Tavily, behind SearchProvider)
│           ├── discovery/        # suggestions queue: learn-from-listings, process approved, annual lists, AI discovery
│           │   ├── learn.ts, process.ts, lists.ts, ai.ts
│           ├── connectors/       # ATS adapters implementing Connector
│           │   ├── workday.ts, successfactors.ts, oracle.ts, avature.ts, oleeo.ts, eightfold.ts,
│           │   ├── phenom.ts, greenhouse.ts, smartrecruiters.ts, taleo.ts, lever.ts, ashby.ts,
│           │   ├── workable.ts, teamtailor.ts, recruitee.ts, personio.ts, icims.ts, cornerstone.ts,
│           │   ├── jsonld.ts (generic JobPosting), sitemap.ts (generic), pagehash.ts, manual.ts
│           ├── pipeline/{normalise.ts, geocode.ts, dedupe.ts, persist.ts, diff.ts}
│           ├── notify/{digest.ts, email.ts, templates/}
│           └── db.ts             # supabase service client
│       └── test/{fixtures/, *.test.ts}
└── apps/web/
    ├── index.html, vite.config.ts, tailwind.config.ts
    └── src/
        ├── main.tsx, App.tsx, router.tsx
        ├── lib/{supabase.ts, auth.tsx, queries.ts, geo.ts, scoring.ts, format.ts}
        ├── store/filters.ts
        ├── pages/{Login, Listings, ListingDetail, Tracker, Hidden, Companies, MapPage, Settings, Health}.tsx
        └── components/{ListingCard, ListingTable, FilterBar, StatusSelect, Notes, SourceBadges, ScoreChip, UKMap, ...}
```

---

## 4. Data model (Supabase / Postgres)

All timestamps `timestamptz`. `id` columns `uuid default gen_random_uuid()` unless noted. Enums as Postgres enums.

```sql
create type role_type as enum ('data_science','data_analyst','ml_ai','data_engineering','software_tech','business_analyst','other');
create type nation as enum ('England','Scotland','Wales','Northern Ireland','UK-wide','Remote','Unknown');
create type track_status as enum ('none','saved','applied','interview','offer','rejected');
create type employer_status as enum ('unknown','open','closed','blocked','error');

create table employers (
  id text primary key,                 -- slug, e.g. 'barclays'
  name text not null,
  sector text,
  relevance text check (relevance in ('core','adjacent')),
  confidence text,
  early_careers_url text,
  job_search_url text,
  ats_family text,                      -- 'Workday', 'SuccessFactors', ...
  connector text,                       -- which connectors/*.ts to use, or 'manual'
  connector_config jsonb default '{}',  -- tenant/site/domain/siteNumber etc (§6.3)
  data_schemes text[],
  typical_window text,                  -- "opens Oct, closes Jan"
  opens_month int, closes_month int,    -- parsed, nullable
  locations text[],
  training_provider text,
  watch boolean default true,
  status employer_status default 'unknown',
  last_checked_at timestamptz, last_ok_at timestamptz,
  last_error text,
  last_total_jobs int, last_apprentice_jobs int, last_relevant_jobs int,
  opened_at timestamptz,                -- when status last flipped to open
  page_hash text,                       -- for pagehash connector
  notes_md text                         -- admin notes from seed 'evidence'
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique not null,
  title text not null,
  employer_id text references employers(id),
  employer_name text not null,
  employer_name_norm text not null,
  url text not null,                    -- best "view" link
  apply_url text,
  description_html text,                -- sanitised server-side too
  description_text text,
  level int,                            -- 2..7 or null
  level_source text,                    -- 'source' | 'lars' | 'title' | 'text'
  is_degree boolean,
  lars_code int, standard_title text,
  role_type role_type not null default 'other',
  score int not null default 0,         -- base relevance 0..100 (§7)
  score_breakdown jsonb,
  salary_min numeric, salary_max numeric, salary_text text,
  posted_date date, closing_date date, start_date date,
  locations jsonb not null default '[]', -- [{text, city, region, nation, postcode, lat, lon}]
  primary_city text, nation nation default 'Unknown',
  is_national boolean default false,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  is_active boolean default true,       -- false when gone from all sources or closing_date passed
  closed_reason text,
  ai jsonb,                             -- optional Claude extraction (P2)
  search tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(employer_name,'') || ' ' || coalesce(description_text,''))) stored
);
create index on listings (is_active, score desc);
create index on listings (closing_date);
create index on listings using gin (search);

create table listing_sources (
  listing_id uuid references listings(id) on delete cascade,
  source text not null,                 -- 'faa','higherin','reed','adzuna','employer:barclays', ...
  source_id text not null,              -- VAC ref, job id, URL hash
  url text not null,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  raw jsonb,
  primary key (source, source_id)
);
create index on listing_sources (listing_id);

create table tracking (                 -- shared household view
  listing_id uuid primary key references listings(id) on delete cascade,
  status track_status not null default 'none',
  hidden boolean not null default false,
  hidden_at timestamptz,
  applied_at date,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  employer_id text references employers(id) on delete cascade,
  author_id uuid references auth.users(id),
  author_name text,
  body text not null,
  created_at timestamptz default now(),
  check (listing_id is not null or employer_id is not null)
);

create table settings (                 -- single row, id = 1
  id int primary key check (id = 1),
  home_postcode text, home_lat double precision, home_lon double precision,
  preferred_levels int[] default '{6,5,4}',
  preferred_roles role_type[] default '{data_science,data_analyst,ml_ai}',
  default_distance_miles int default 50,
  digest_min_score int default 40,
  digest_enabled boolean default true,
  updated_at timestamptz default now()
);

create table scrape_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(), finished_at timestamptz,
  status text,                          -- 'ok' | 'partial' | 'failed'
  stats jsonb,                          -- per source/employer: fetched, matched, new, updated, errors
  new_listing_ids uuid[],
  error text
);

create table source_state (             -- cursors, seen-sets, hashes
  key text primary key,                 -- 'higherin:sitemap', 'amazing:last_pdf', 'employer:bae:portal'
  value jsonb not null,
  updated_at timestamptz default now()
);

create table digest_log (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz default now(),
  kind text, recipients text[], listing_ids uuid[], employer_ids text[]
);

create type suggestion_status as enum ('pending','approved','dismissed','added');

create table employer_suggestions (     -- discovery queue (§6.5)
  id uuid primary key default gen_random_uuid(),
  name text,
  name_norm text unique,
  careers_url text,
  origin text not null,                 -- 'listing' | 'google_jobs' | 'web_search' | 'lists' | 'ai' | 'manual'
  evidence jsonb not null default '[]', -- [{source, url, listing_id?, title?, seen_at}]
  detected_connector text, detected_config jsonb,
  status suggestion_status not null default 'pending',
  auto boolean default false,           -- auto-approved by the rules
  dismiss_reason text,
  decided_by uuid references auth.users(id), decided_at timestamptz,
  employer_id text references employers(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);
-- employers also gets: aliases text[] default '{}', origin text default 'seed'  -- 'seed' | 'discovered' | 'manual'
```

**RLS** (enable on every table):
- `authenticated` role: `select` on all tables; `insert/update/delete` on `tracking`, `notes`, `settings` only; `insert` + `update` (status, dismiss_reason, decided_*) on `employer_suggestions` (Add company / approve / dismiss); `update` of `watch` on `employers` (stop/start watching).
- Everything else written only via service-role key from the scraper (bypasses RLS).
- `notes.author_id` must equal `auth.uid()` on insert (policy `with check`).
- Nothing for `anon` role. The publishable/anon key alone can read nothing.

**Views / RPC** for the UI:
- `v_listings` = listings ⟕ tracking (status, hidden) ⟕ aggregated sources (`jsonb_agg` of {source,url}) + `notes_count`. UI loads active rows without `description_*` (fetched on detail open).
- RPC `set_status(listing_id, status)`, `set_hidden(listing_id, bool)` as `security definer`-less plain upserts (RLS suffices).

---

## 5. Scraper: pipeline

One run = `scrape` command. Steps:

1. **Load config**: `config/*.json` (zod-validated), settings row from DB (home lat/lon for FAA distance sort — optional), employers table (synced from `config/employers.json` by `sync-employers`; DB is source of truth for runtime status, JSON for identity/config).
2. **Run sources** (aggregators) and **connectors** (per employer) concurrently with limits: global 8 in flight, **1 per host**, host-specific min gap (default 1.5 s; 10 s for `*.tal.net` and `*.csod.com`; FAA 2 s). Each returns `RawListing[]` and per-source stats; errors are caught per source/employer and recorded, never abort the run.
3. **Normalise** each `RawListing` → `NormalisedListing` (`packages/shared/normalise.ts`): trim, decode entities, html→text, parse dates (ISO / RFC-822 / `"Fri Oct 09 02:01:00 UTC 2026"` / `M/D/YYYY` / `"Posted 2 Days Ago"` → relative), parse salary (`£24,000`, `24k`, ranges, "per annum"), normalise employer name (strip `Ltd|PLC|Limited|UK|Group|(UK)`, lowercase, collapse spaces), locations → gazetteer lookup (§5.2).
4. **Classify** (`classify.ts`): is-apprenticeship, level, degree flag, role type, noise flags, LARS mapping. Drop anything that fails `isApprenticeship` or is noise (coach/assessor/tutor/…). Employer connectors fetch *all* UK jobs; this is where 99% get dropped.
5. **Score** (§7) → `score`, `score_breakdown`.
6. **Dedupe** (§5.3) → `dedupe_key`; merge multi-source into one listing with many `listing_sources`.
7. **Persist**: upsert `listings` by `dedupe_key` (keep `first_seen_at`, update `last_seen_at`, prefer richer fields: longest description, earliest posted, any closing date over none); upsert `listing_sources`; update `employers` status/counts.
8. **Diff**: mark `is_active=false` where not seen in this run for 3 consecutive runs (grace for flaky sources) OR `closing_date < today`. Record `new_listing_ids` (first seen this run) on `scrape_runs`.
9. **Watchlist flip**: `employers.status` = `open` if `last_relevant_jobs > 0`; `closed` if the connector ran OK and found 0; `blocked` on 403/captcha page; `error` otherwise. Set `opened_at` on closed→open.
9b. **Discovery** (§6.5): `process.ts` runs *before* step 2 (so approved/added companies are scraped the same day); `learn.ts` runs after step 7 to queue suggestions from this run's listings.
10. **Digest** (separate command, run after scrape in the same workflow): §9.

Exit code non-zero only if the run itself failed (DB unreachable, >50% sources errored) so GitHub surfaces it.

### 5.1 `http.ts` contract
- `get/post(url, opts)` with: honest UA `apprenticeship-finder/0.1 (+https://github.com/alexslater1/apprenticeship-finder; personal non-commercial)`, 20 s timeout, 2 retries with backoff on 5xx/network, **no retry on 403/429**, per-host serial queue with min gap, optional `robots` check (fetch & cache `/robots.txt` per host; skip request and mark `blocked_by_robots` if disallowed for `*`), response cache in `source_state` for ETag/Last-Modified where useful (Higherin sitemap).
- Detects bot-wall bodies (`Quick check needed`, `Just a moment`, `cf-mitigated: challenge`, ALTCHA) → throws `BlockedError` so the pipeline marks `blocked`, never "0 jobs".
- `--record` flag writes responses to `test/fixtures/` for tests.

### 5.2 Geocoding
- `config/uk-places.json`: ~400 entries `{name, aliases[], lat, lon, region, nation}` covering UK cities/towns + counties + "Remote", "Nationwide". Generate once from a public gazetteer (e.g. ONS/OS Open Names or a simple curated list) during Phase 1; commit it.
- Postcodes in text → `https://api.postcodes.io/postcodes/{pc}` (free, no key; bulk endpoint 100/req). Cache results in `source_state` (`geo:postcode:XX`).
- Location strings like `"London, Barclays Campus"`, `"2 Locations"`, `"Glasgow (Hybrid)"`: tokenise, match aliases, else leave `lat/lon` null (listing shows in list but not map; distance filter treats as unknown and keeps it unless user ticks "only known locations").
- FAA gives lat/lon per address directly. Higherin JSON-LD gives `jobLocation.address`.
- Nation from gazetteer; FAA listings default England; Scotland/Wales/NI sources default their nation.

### 5.3 Dedupe
- `dedupe_key = sha1(employer_name_norm + '|' + title_norm + '|' + primary_city_norm)` where `title_norm` strips year tokens (`2027`), level tokens, punctuation, and words in `{apprenticeship, apprentice, programme, program, scheme}` at the ends only (keep them in title itself). Different cities = different listings (intended: Barclays Glasgow ≠ Barclays Northampton).
- Hard links: if a source exposes a FAA `VAC…` reference (Get My First Job style, or `applicationUrl` containing it), attach to the FAA listing.
- P2: fuzzy merge (same employer, same city, title token Jaccard ≥ 0.7) with manual override table.

### 5.4 Keeping closed/expired data
- Never delete listings; `is_active=false` + `closed_reason`. UI hides inactive by default. Lets the watchlist show "last year's scheme: opened 22 Dec, closed 31 Jan" next year.

---

## 6. Sources and connectors

### 6.1 Interfaces (`packages/shared/types.ts`)
```ts
export interface RawListing {
  source: string;            // 'faa' | 'higherin' | ... | `employer:${id}`
  sourceId: string;          // stable id within source
  url: string; applyUrl?: string;
  title: string; employerName: string; employerId?: string;
  descriptionHtml?: string; descriptionText?: string;
  level?: number; larsCode?: number; standardTitle?: string;
  salaryText?: string; salaryMin?: number; salaryMax?: number;
  postedDate?: string; closingDate?: string; startDate?: string; // ISO date
  locations: Array<{ text: string; postcode?: string; lat?: number; lon?: number; city?: string; nation?: Nation }>;
  isNational?: boolean;
  raw?: unknown;             // kept in listing_sources.raw (trimmed to ≤ 20 KB)
}
export interface Source { id: string; enabled(env): boolean; run(ctx: Ctx): Promise<RawListing[]>; }
export interface Connector {
  id: ConnectorId;
  detect(url: string, html?: string): Partial<ConnectorConfig> | null; // for detect-ats CLI
  fetchJobs(employer: EmployerConfig, ctx: Ctx): Promise<RawListing[]>; // ALL UK jobs, unfiltered
}
```
Employer connectors return everything; `classify` filters. Exception: Workday supports an "Apprentice" facet; use it *in addition* only when configured (`connector_config.apprenticeFacet`), never as the only query (facet IDs are tenant-specific and brittle).

### 6.2 Aggregator sources (implement in this order)
| # | Source | Phase | Notes (see research file for exact requests) |
|---|---|---|---|
| 1 | **FAA Display Advert API v2** (England + NHS Jobs + Civil Service Jobs) | 1 | `research/gov-api.md` §4 (**verified with the real key**). Daily **full sync of every vacancy**: `GET /vacancy?PageSize=100&PageNumber=N&Sort=AgeDesc` with headers `X-Version: 2`, `Ocp-Apim-Subscription-Key`, `AdditionalDataSources: Nhs,Csj`, no LARS filter, no `IncludeDetails` (~38 calls, 2 s apart). Classify locally: relevant if `course.larsCode` is in `config/standards.json` **or** the title passes the keyword classifier (LARS-only misses mis-filed roles like Howden's "Data Analyst Apprenticeship Programme" under Insurance practitioner, and NHS/CSJ extras, which have `larsCode 0`). Then `GET /vacancy/{ref}` (same headers) only for **new relevant** refs to get `fullDescription` etc. Drop `course.type = "Foundation"`. Level from `course.level` (fallback: title / `apprenticeshipLevel` Advanced=3, Higher=4, Degree=6). Salary: `wageAmount` is never filled, so parse `wage.wageAdditionalInformation` text (e.g. "£20,400 a year"). Link: `vacancyUrl`, except NHS/CSJ extras where it is a bare base URL, so use `applicationUrl`. Refs are plain numbers (`2000041656`); NHS refs look like `C9824-26-0895`. Addresses have lat/lon. A full sync each day also makes closure detection exact (absent from the sync = gone). |
| 2 | **Higherin** | 2 | `research/job-sites.md` §B2. Daily: fetch `https://cdn-production.higherin.com/sitemaps/job-sitemap-1.xml` (follow `sitemap-index.xml` → `job-sitemap-index.xml` in case numbering changes), diff against `source_state['higherin:seen']`, fetch new `/jobs/...` pages whose slug matches `/apprentic/`, parse JSON-LD `JobPosting`. Also fetch 4 allowed category pages (`/search-jobs/{degree-apprenticeship,higher-level-apprenticeship,level-3-apprenticeship}/data-analysis`, `/search-jobs/degree-apprenticeship/artificial-intelligence`) and parse `window.__RMP_SEARCH_RESULTS_INITIAL_STATE__` for `deadline`/`salary`/`jobTypeName` (level hint) and to re-confirm still-live. Never use `search-term=`/`sort-by=`/`company=` params (robots). |
| 3 | **Reed API** | 2 | `job-sites.md` §A2. Basic auth (key as user). Queries: `keywords="data apprentice"`, `"data analyst apprenticeship"`, `"data science apprenticeship"`, `"AI apprentice"`, `"degree apprenticeship data"`, `resultsToTake=100`. Detail call for new ids only. Noise filter essential. |
| 4 | **Adzuna API** | 2 | §A1. `title_only=apprentice` + `what_or=...`, `max_days_old=3`, `results_per_page=50`, 3–5 pages. Show "Adzuna" label linked to adzuna.co.uk on any listing whose only source is Adzuna (T&C). 250/day budget: use ≤ 20. |
| 5 | **Amazing Apprenticeships PDF** | 5 | §B4. Weekly: fetch resource page, find newest `wp-content/uploads/*.pdf`, if URL ≠ `source_state['amazing:last_pdf']`, download, `pdf-parse`/`pdftotext -layout` (poppler is on ubuntu runners), parse blocks, keep Digital section + keyword hits. Low volume; treat as "leads" with `url` = short link resolved. |
| 6 | **Not Going To Uni** | 5 | §B3. Optional; `query/data` page, JSON-LD on new detail pages. |
| 7 | **NHS Jobs XML** | 5 | §B12. Only if FAA `Nhs` source proves empty. |
| 8 | **Scotland: apprenticeships.scot** (SDS) | 5 | `research/devolved-nations.md`. The site is an SPA whose browser JS calls an Azure APIM gateway with a key embedded in the public bundle. Use it sparingly and honestly: 1 `POST …/vacancy/vacancies/search?api-version=1.0` per day per type (`apprenticeshipTypeFacet: "GA"`, then `"MA"` with keywords `data|analyst|AI|software`), `take` large, then `GET …/vacancy/vacancy/ref/{RefCode}` for new refs only (gives framework name + apply URL). Read the key from the live JS at run time rather than hard-coding it (it may rotate); treat 401 as "blocked". Fields: `RefCode, JobTitle, EmployerName, TrainingProviderName, ClosingDate, VacancyType, JobFamily, ModernApprenticeshipLevel`. GA = level 6 (degree); frameworks include Data Science (GCU, Heriot-Watt, Stirling, Napier, RGU), Software Development, Business Analysis, Cyber. Volume is tiny (4 GAs live today; the only data one is Thales AI Engineer). T&Cs say personal/non-commercial use, which this is; robots disallows `/vacancy-details/` HTML, which we don't fetch. Nation = Scotland. |
| 9 | **Wales: Careers Wales API** | 5 | Open, unauthenticated: `GET https://api.careerswales.gov.wales/apprenticeships-api/api/v1/apprenticeships/q?keywords=&apprenticeshipLevel=&apprenticeshipSector=10` with paging/sort as request **headers** (`page`, `groupSize`, `order`, `Accept-Language: en`); `204` = no results; detail by slug. Only ~42 vacancies in all Wales today; degree apprenticeships are advertised by employers, not the portal, so this is mostly for completeness. One call a day for sector 10 (digital) + keyword `data`. Nation = Wales. |
| 10 | **NI: JobApplyNI + nidirect HLA table** | 5 | No API. `GET https://www.jobapplyni.com/?sector=Apprenticeships&DoSearch=true&CurrentPage=N` is server-rendered (cards link to `/Vacancy/VacancyDetail?Id=`); ~8 apprenticeships today, none data. Data HLAs (Belfast Met L5/L6 "Software and Cloud Development with Data Analysis/Science", Ulster L7 AI) recruit via college portals: add **Belfast Met** and **Ulster University HLA** as `manual`/`pagehash` watchlist employers (Belfast Met applications opened 24 Jan 2026 last cycle). Nation = Northern Ireland. |
| 11 | **Scotland secondary** | optional | `api.myworldofwork.co.uk/job-vacancies/Search` (Adzuna-sourced, so mostly duplicates of our Adzuna source) and myjobscotland (council MAs only). Skip unless Scotland matters to him specifically. |

### 6.3 Employer connectors
Source of truth: `config/employers.json` (converted from `research/employers.seed.json`; keep all fields, add `connector` + `connector_config`). Platform distribution in the seed: Workday 33, SuccessFactors 22, Civil Service Jobs 12, own site 11, Oracle HCM 10, Avature 6, Oleeo 4, Eightfold 3, SmartRecruiters 3, Phenom 3, Greenhouse 2, Cornerstone 2, Taleo (BAE) etc. All request recipes, verified live, are in `research/ats-platforms.md` (§1–18) with a summary table in §20. **Implement in this order** (coverage per effort):

| Phase | Connector | `connector_config` keys | Gotchas (from research) |
|---|---|---|---|
| 3a | `workday` | `tenant, wd (e.g. "wd3"), site, locale?, apprenticeFacet?` | limit max 20; detail call for exact dates and multi-locations; key on `_JR-…` id in `externalPath` |
| 3a | `successfactors` | `host, brandPath?` | SSR `/search/?q=&locationsearch=United%20Kingdom&startrow=N` (25/page) + `/sitemap.xml` lastmod; **don't** use `/services/rss` (robots); some hosts Akamai-403 → mark blocked |
| 3a | `oracle` | `host, siteNumber, ukLocationId?` | must pass `expand=requisitionList…`; look up UK `locationId` once via `facetsList=LOCATIONS` and cache in `source_state`; go slow (WAF) |
| 3a | `avature` | `host, locale ("en_GB")` | sitemap_index for discovery, JSON-LD on detail; HTML list 10/page |
| 3a | `oleeo` | `tenant, boardIds[]` | 10 s gap; strip `xf-…` from URLs; key on `data-oppid`; detect "Quick check needed" → blocked |
| 3a | `eightfold` | `host, domain` | v2 `num` capped 10; on 403 "PCSX" switch to `/api/pcsx/search` |
| 3b | `phenom` | `host, cc, lang, pageId?` | POST `/widgets` size 100; follow `applyUrl` to underlying ATS if needed |
| 3b | `greenhouse`, `smartrecruiters` (use SSR careers pages, API host robots disallows), `taleo` (portalNo bootstrap; tenant-specific `initialHistory` layout → extract by labels or hash), `lever`, `ashby`, `workable`, `teamtailor`, `recruitee`, `personio`, `icims`, `cornerstone` (anon token bootstrap) | per research §20 | |
| 3b | `jsonld` (generic) | `urls[]` or `sitemapUrl + urlPattern` | for own-site employers with JobPosting markup |
| 3b | `pagehash` | `url, selector?, stripPatterns[]` | normalise + hash; on change, diff added lines matching apprentice+data regex → create a *lead* listing (`role_type` from text, `score` capped at 60, title = matched line) and flag employer `changed` |
| 3c | `manual` | `url` | for bot-walled (Civil Service Jobs, MI5/MI6, Home Office, NatWest, Aviva, Fujitsu, Bloomberg, ScottishPower, Royal Mail, BNP/Aon tal.net): watchlist shows "check manually" + link + typical window; FAA `Csj` may cover civil service |

CLI `detect-ats <careers-url>` runs every connector's `detect()` (URL regexes from research §20 `DETECTORS`, plus HTML sniff for `phApp.ddo`, `eightfold`, `teamtailor`), probes the list endpoint, prints the config to paste into `employers.json`. Use it in Phase 3 to fill the 9 "Unknown" employers and validate the rest. Every employer must be validated once by hand (SmartRecruiters/Eightfold return 200 + 0 jobs for wrong ids): store `last_total_jobs` and alert on health page if an employer drops from >0 to 0.

### 6.4 Watchlist semantics
- Status per employer from the last run (§5 step 9). Additionally derive `expected_open` from `opens_month` (from seed `application_window`, parsed by a small script; keep text too).
- Companies page sections: **Open now** (relevant listings active) · **Opening soon** (closed, `opens_month` within next 2 months) · **Closed / not yet** · **Check manually** (blocked/manual) · **Unknown**.
- Digest includes "newly opened" employers (closed→open since last digest).

### 6.5 Discovery: finding listings and employers we don't know about
Goal: catch apprenticeships at companies that aren't on the watchlist and don't post on FAA/Higherin/Reed/Adzuna. Nobody can crawl the whole web, so we use search engines' indexes. Five channels feed one **suggestion queue** (`employer_suggestions`, §4); strong suggestions are auto-watched, weak ones wait for a tap in the UI.

**D1. Google for Jobs via SerpApi (web-wide job search, daily) — Phase 3.**
Google already indexes `JobPosting` markup from almost every careers site and ATS (Workday, SuccessFactors, Avature, iCIMS, Teamtailor etc. all emit it), so Google Jobs is the closest thing to "every job on the web". There's no official Google API for it; SerpApi's `google_jobs` engine returns it as JSON. (Google's Custom Search JSON API is closed to new customers and shuts down 1 Jan 2027, so don't use that.)
- Free plan: 250 searches/month (official pricing page, checked 2026-10-09). Budget: **6 queries/day ≈ 186/month**, leaving headroom for manual runs.
- Queries (UK, newest first): `"data science apprenticeship"`, `"data analyst apprenticeship"`, `"degree apprenticeship" data`, `"machine learning" OR "AI" apprenticeship`, `"data engineer" apprenticeship`, `"graduate apprenticeship" data` (Scotland). Rotate an extra weekly query set (`"level 6" apprenticeship data`, `"digital and technology solutions" apprenticeship`) if budget allows.
- Use `location=United Kingdom`, `gl=uk`, `hl=en`, and the "posted in last 3 days" filter. **Verify the exact SerpApi params at build time** (date filter syntax, pagination token, whether each page counts as a search) and record them in `research/discovery.md`.
- Each result (title, company, location, `via`, posted-at, description, apply links) becomes a `RawListing` with `source='google_jobs'`, going through the normal classify/score/dedupe pipeline. **Apply links usually point at the employer's ATS**, so the employer is auto-detected (D3).
- `sources/google-jobs.ts`. Secret: `SERPAPI_KEY`. If the key is absent, skip.

**D2. Open web search via Tavily (daily) — Phase 3.**
Catches pages that aren't job ads yet: "applications open in November" news posts, early-careers pages, university partner pages, Scottish GA employer lists.
- Free plan: 1,000 credits/month, no card (official docs, checked 2026-10-09). A basic search = 1 credit. Budget: **10 queries/day ≈ 300/month**.
- Queries with `time_range=week`, `country=united kingdom` (verify param names): e.g. `data science degree apprenticeship 2027 applications open`, `data analyst apprenticeship September 2027`, `level 6 data scientist apprenticeship employer`, plus **ATS-scoped** searches using `include_domains`: `myworkdayjobs.com`, `tal.net`, `avature.net`, `successfactors.eu`, `eightfold.ai`, `teamtailor.com`, `greenhouse.io`, `lever.co` with `apprenticeship data UK`. ATS-domain hits are gold: the URL alone gives us the tenant for a connector.
- For each new result URL: fetch the page (`http.ts`, robots respected), try JSON-LD/microdata `JobPosting` → listing (`source='web_search'`); otherwise run the classifier over the page text. If it mentions an apprenticeship + data words, create an employer suggestion with the URL as evidence (no listing).
- `sources/web-search.ts`. Secret: `TAVILY_API_KEY`. If the key is absent, skip.
- Brave Search is an alternative provider (no free tier any more; $5 monthly credit ≈ 1,000 queries, card required). Keep the provider behind a small `SearchProvider` interface so it can be swapped.

**D3. Learn employers from every listing (automatic, no cost) — Phase 3.**
After each run, for every listing with score ≥ 45 whose `employer_name_norm` doesn't match a watched employer (or alias): upsert an `employer_suggestions` row with evidence (listing id, source, URL). Run `detect()` over `apply_url`, FAA `employerWebsiteUrl`, Google Jobs apply links and Higherin company links. **Auto-approve** when the source listing scored ≥ 45 and detection found a known connector; otherwise status `pending`. This also means a company that posted on FAA this year gets watched on its own site from then on.

**D4. Annual lists (once a year, cheap) — Phase 5.**
`discover-lists` command parses employer names from: the RateMyApprenticeship/Higherin Top 100, the gov.uk Top 100 Apprenticeship Employers, Amazing Apprenticeships PDF employers (already fetched by source 5), and university "our employer partners" pages for the Data Scientist and DTS degree apprenticeships. Unknown names → pending suggestions (careers URL found via one D2 search each).

**D5. Optional monthly AI discovery — Phase 5, only if `ANTHROPIC_API_KEY` is set.**
A monthly job asks Claude (with its web-search tool) to find UK employers recruiting for data/AI/DTS degree or higher apprenticeships for the next September intake, excluding the current watchlist, and return structured `{name, careersUrl, evidenceUrl, scheme, window}`. Results → pending suggestions. Load the `claude-api` skill before implementing; cap the spend per run.

**Add company (manual) — Phase 3.** Button on the Companies page: name (optional) + careers or job URL + note. Inserts an `employer_suggestions` row with `origin='manual'`, `status='approved'`. The next scrape runs detection and creates the employer.

**Processing suggestions (`discovery/process.ts`, runs inside `scrape` before connectors):**
1. For each `approved` suggestion without an employer: fetch the careers URL (follow redirects), run every connector's `detect()` on the final URL + HTML, and look for links to known ATS hosts on the page.
2. Found → create `employers` row (`connector`, `connector_config`, `origin='discovered'|'manual'`), run it immediately so the user sees jobs the same day.
3. Not found → create it with `pagehash` on the URL (lead detection), and mark `needs_review` on the Health page.
4. Set suggestion `status='added'`, `employer_id`.
- Name matching: `employer_name_norm` + an `aliases text[]` column on `employers` (e.g. "Lloyds Banking Group" / "Lloyds Bank" / "LBG"). Dismissed suggestions are remembered so they never come back.
- `sync-employers` upserts config employers and **never deletes DB-only employers** (discovered/manual ones live only in the DB). A `export-employers` command writes them back to `config/employers.json` if you want them version-controlled.

---

## 7. Classification and scoring (`packages/shared`)

Pure functions, table-driven from `config/keywords.json`, fully unit-tested with real titles from research (e.g. "2027 Technology Analyst AI and Data Science Graduate Apprenticeship Programme Glasgow", "Level 6 Data Science Degree Apprenticeship", "Data Apprenticeship Coach" → noise, "AI Engineer Apprentice" (ML engineer L6), "Data Centre Technician L4" → other).

**isApprenticeship**: title or standard matches `/apprentic|degree apprenticeship|graduate apprenticeship(?!s? scheme)|higher apprenticeship|level [3-7] /i`, or source is FAA/Higherin-apprentice/Scot GA. Scotland "Graduate Apprenticeship" = degree-level apprenticeship, NOT a graduate scheme.

**Noise** (drop): `/\b(coach|assessor|tutor|trainer|lecturer|IQA|internal quality|recruiter|mentor|skills coach|programme manager)\b/i` in title; `/apprenticeship (levy|funding|sales|advisor)/i`; `graduate scheme|graduates only|for graduates` without apprenticeship.

**Level**: source level > LARS code level > title regex (`level\s*(\d)`, `\bL(\d)\b`, `degree` → 6, `master'?s|level 7` → 7, `higher` → 4, `advanced` → 3, `intermediate` → 2, Scottish `graduate apprenticeship` → 6, Higherin `jobTypeName` "Degree Apprenticeship" → 6, "Higher Level" → 4) > description regex > null.

**Role type** (first match in title, then standard title, then description with lower weight):
- `data_science`: `data scien`, LARS 337, 327
- `ml_ai`: `machine learning|\bML\b|\bAI\b|artificial intelligence|deep learning`, LARS 795, 561, 828
- `data_engineering`: `data engineer`, LARS 746
- `data_analyst`: `data analy|analytics|insight analyst|business intelligence|\bBI\b|data technician|statistic`, LARS 80, 576
- `business_analyst`: LARS 165
- `software_tech`: `software|developer|digital (and|&) technology|DTS|technology solutions|computer science|cyber|devops`, LARS 25, 2, 154, 548
- else `other`

**Base score (0–100)** = clamp( role + level + degree + specificity + freshness − penalties ):
- role: data_science 45 · ml_ai 40 · data_analyst 38 · data_engineering 32 · software_tech with data words in description 22 · software_tech 12 · business_analyst 12 · other 0
- level: 6 → 25 · 5 → 22 · 4 → 18 · 7 → 10 · 3 → 6 · null → 10
- degree flag +8
- specificity: title (not just description) carried the role match +10; LARS code known +5
- freshness: posted/first seen ≤ 7 days +4
- penalties: `data entry|data administrator|data centre` −40; "existing employees/internal only" −60; closing date passed −100; `pagehash` lead cap 60
Store the breakdown. The UI adds **personal boosts** client-side from `settings` (preferred level +10, preferred role +10, within default distance +8), so changing preferences never needs a re-scrape. Default list sort = personal score desc; "Match" chip shows High ≥ 70 / Medium 45–69 / Low < 45.

**Salary parse**: `£?(\d{2,3}),?(\d{3})`, `(\d{2})k`, ranges; `competitive` → null with text kept. FAA `wageType` map.

---

## 8. Frontend specification (`apps/web`)

### 8.1 Routing (HashRouter, so GH Pages needs no 404 trick)
`#/login` · `#/` listings · `#/listing/:id` (route-driven side panel/modal over list) · `#/tracker` · `#/hidden` · `#/companies` · `#/companies/:id` · `#/map` · `#/settings` · `#/health`.

Unauthenticated → `#/login`. Session persisted by supabase-js; `onAuthStateChange` guards routes.

### 8.2 Data loading
- On app load (authenticated): `settings` (1 row), `employers` (≤ 200 rows), `v_listings` active rows without description (expected ≤ 3,000; select ~25 columns). Cache with TanStack Query, `staleTime` 10 min, manual refresh button; realtime not needed.
- All filtering/sorting/distance in the browser (`lib/geo.ts` haversine from `settings.home_lat/lon`). Fast enough for this size; simple.
- Detail: fetch `description_html` + `listing_sources` + `notes` on open. Render description via `dompurify` with links forced `target=_blank rel=noopener`.
- Mutations: upsert `tracking`, insert `notes`, update `settings`; optimistic updates.

### 8.3 Pages
- **Listings**: sticky FilterBar (search, role chips, level chips, nation/region select, city combobox, distance slider (disabled until postcode set), salary min, closing-within, posted-within, source, degree-only, "include hidden", "include closed"). Result count + sort select. Mobile: cards; desktop: TanStack Table with column toggles. Row: Match chip, title, employer, level badge (L6 · Degree), locations (+ "x mi"), salary, closes in N days (red ≤ 7), status select, source badges (FAA/Higherin/Reed/Adzuna/Employer; Adzuna badge linked per T&C), new dot (first_seen ≤ 3 days). Quick actions: save, hide (undo toast).
- **Listing detail**: header + apply button (apply_url || url) + all source links; facts grid (level/standard/LARS link to Skills England page, degree/provider, salary, dates, locations, employer typical window); description; status + applied date; notes thread (author, time); hide; "report wrong classification" (just a note tag `#wrong`).
- **Tracker**: columns or grouped list by status (saved → applied → interview → offer → rejected); "Closing soon" top panel (status ∈ {saved, applied} and closing ≤ 7 days). Export CSV.
- **Hidden**: list with Unhide.
- **Companies**: sections as §6.4; card = name, sector, schemes, status pill, typical window, last checked, relevant listings count → link filters listings by employer; notes; Watch/Unwatch toggle; "discovered"/"added by you" badge.
  - **Add company** button → sheet with URL (required), name, note → inserts approved suggestion; toast "Will be checked in the next daily run" (+ link to run the workflow manually for the admin).
  - **Suggested** tab (badge with pending count): each suggestion shows name, where it was seen (evidence links, e.g. "Data Analyst Apprentice on Google Jobs, 2 Oct"), detected platform or "unknown", and **Watch** / **Dismiss** (optional reason). An "Auto-added this week" list shows what the rules approved, with Undo (unwatch + dismiss).
- **Map**: react-leaflet, OSM tiles (attribution kept; light use is within OSM policy — or use a free MapTiler key if traffic grows), marker cluster, popup → listing; respects current filters (shared zustand filter store); home marker + radius circle.
- **Settings**: postcode (validate + geocode via postcodes.io from the browser; store lat/lon), preferred levels/roles, default distance, digest min score, digest on/off. Also shows who's logged in, sign out.
- **Health**: last 10 `scrape_runs` with stats; employers by status with last error; sources table.

### 8.4 Design
- Load the `artifact-design`-style basics: Tailwind + shadcn/ui, system font stack, light/dark via `prefers-color-scheme`, 16 px gutters, mobile-first, 44 px touch targets, status colours consistent (saved blue, applied amber, interview purple, offer green, rejected grey). Match chip colours: green/amber/grey.
- Accessible: keyboard filter bar, labels, focus rings; table rows link to detail.

---

## 9. Scheduling, email, secrets

### 9.1 GitHub Actions
- `scrape.yml`: `on: schedule: cron '23 6 * * *'` (avoid top-of-hour congestion; runs only on the default branch) + `workflow_dispatch` (inputs: `sources`, `employers`, `dry_run`). `concurrency: scrape` cancel-in-progress false. `timeout-minutes: 45`. Steps: `actions/checkout@v6` → `actions/setup-node` with Node 24 (cache npm) → `npm ci` → `npm run build -w packages/shared` → `npm run scrape -w packages/scraper` → `npm run digest -w packages/scraper` → upload `logs/` artifact (14 days) → on failure: email via same transport ("scrape failed: <error>").
- **Keepalive** (verified: GitHub auto-disables scheduled workflows in public repos after 60 days without repo activity): the scrape job's final step commits `data/last-run.json` (date + counts, no private data) with `[skip ci]` using the built-in `GITHUB_TOKEN` (`contents: write` permission). A commit a day is harmless in a bot repo and guarantees activity. Do **not** use `gautamkrishnar/keepalive-workflow` (TOS-blocked since 2025-04). If it ever gets disabled anyway: `gh workflow enable scrape.yml`.
- `deploy-web.yml`: on push to `main` touching `apps/web/**|packages/shared/**` and manual. Build with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` from **repo variables**, `base: '/apprenticeship-finder/'`. `actions/deploy-pages`. HashRouter means no `404.html` redirect trick is needed. Pages is free on public repos (100 GB/month soft limit, irrelevant here).
- `ci.yml`: lint, `tsc --noEmit`, `vitest run` on PRs and pushes.

### 9.2 Secrets (GitHub → Settings → Secrets and variables → Actions)
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FAA_API_KEY`, `REED_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `SERPAPI_KEY`, `TAVILY_API_KEY`, `SMTP_USER`, `SMTP_PASS` (Gmail app password), `DIGEST_TO` (comma list), optional `ANTHROPIC_API_KEY`, optional `SUPABASE_PAT` (for auto-restore). Repo **variables** (public by design): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Secrets are not exposed to PRs from forks. Local: `.env` at repo root (gitignored), `.env.example` committed.

### 9.3 Email digest (`notify/digest.ts`)
Provider (verified in `research/infra.md`): **Gmail SMTP + App Password via nodemailer** (free, 500/day, needs 2-step verification on the sending Google account; use a dedicated Gmail account, not your main one, so the password sits in a GitHub secret safely). Resend's free tier can only send to the account owner's own address without a verified domain, so it's out. Brevo (300/day, needs account approval) is the fallback. `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`. Content, sent only when non-empty:
1. **New matches since last digest** (personal score ≥ `settings.digest_min_score`, not hidden), grouped by Match tier, each: title · employer · location · level · closes · link to dashboard `#/listing/:id` + direct apply link.
2. **Closing soon**: tracked (saved/applied) closing ≤ 7 days, sorted by date.
3. **Newly opened employers** (watchlist flips).
4. **New companies discovered**: auto-watched ones (FYI) and pending suggestions (link to the Suggested tab).
5. **Health line** if any source/employer errored or was blocked, or the SerpApi/Tavily monthly budget is ≥ 80% used.
HTML + plain text. Log to `digest_log`. Idempotent: "since last digest" uses `digest_log.max(sent_at)`.

### 9.4 Supabase
- Free tier (verified 2026-10-09): 2 projects, 500 MB DB, 50k MAU, 5 GB egress, unlimited API requests. Plenty: a few thousand listings with descriptions is tens of MB.
- **URL configuration** (Authentication → URL Configuration): Site URL = `https://alexslater1.github.io/apprenticeship-finder/`; Redirect URLs = that URL with `**` appended, plus `http://localhost:5173/**` for dev. Default is `http://localhost:3000`, which sends invite/reset links nowhere.
- State on 2026-10-09: the admin (sibling) user is invited and **confirmed (no password set yet)**; sign-ups are disabled. Invite emails land in spam; the built-in mailer only reaches Supabase org members.
- Project in region London. Auth: email/password; **turn off "Allow new users to sign up"** (then only existing users can sign in); create both users via Dashboard → Users → "Send invitation" (or add directly). Set Site URL to the Pages URL so password-reset links work. The built-in mailer sends max 2 emails/hour **and only to members of the Supabase org**, so add both of you as org team members (or configure custom SMTP with the same Gmail creds). That's fine for a 2-user app.
- **Keys**: projects created after 1 Nov 2025 get the new `sb_publishable_…` (frontend; explicitly safe to ship in source when RLS is on) and `sb_secret_…` (scraper only) keys, not legacy `anon`/`service_role` JWTs. supabase-js accepts both. Name the env vars `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
- **Pausing**: free projects pause after "low activity over a 7-day period", measured as user database activity; docs say a few DB requests a day suffice. The daily scraper writes (and his usage) keep it alive; it's inferred rather than stated that service-key traffic counts, so the Health page should show "last successful DB write" and the failure email fires if the DB is unreachable. Un-pause: Dashboard button, or `POST https://api.supabase.com/v1/projects/{ref}/restore` with a personal access token (could be a step in the workflow as belt-and-braces; optional).
- RLS policy pattern: `create policy … on tracking for all to authenticated using (true) with check (true)`; for notes `with check ((select auth.uid()) = author_id)`. PostGIS/earthdistance are available but not needed (distance is client-side).
- Migrations applied via Supabase CLI (`supabase db push`) or pasted into the SQL editor for v1; keep files in repo either way.

---

## 10. Local development
```
cp .env.example .env            # fill keys
npm install
npm run dev -w apps/web         # http://localhost:5173 (uses hosted Supabase; no local DB needed)
npm run scrape -w packages/scraper -- --source faa --dry-run      # prints normalised listings, no writes
npm run scrape -w packages/scraper -- --employer barclays
npm run detect-ats -w packages/scraper -- https://careers.example.com/jobs
npm run digest -w packages/scraper -- --dry-run                   # renders email to logs/digest.html
npm test
```
Optional: `supabase start` for a fully local stack (Docker). Not required.

---

## 11. Implementation phases (each ends in something usable)

**Phase 0 — Skeleton (½ day)**
- Monorepo, tooling, CI. Supabase project + migration 0001 + RLS + 2 users. Web app with login + empty listings page deployed to GitHub Pages. Scraper CLI that connects to DB and writes a `scrape_runs` row. Secrets configured. `scrape.yml` runs green on manual dispatch.
- Done when: he can log in on his phone at the Pages URL.

**Phase 1 — FAA end to end (1 day)**
- `sources/faa.ts`, normalise/classify/score with tests, gazetteer, persist/diff, listings page with filters/sort/detail, tracking (status/hide/notes), Hidden page, Closing-soon panel. Settings page with postcode + distance filter.
- Done when: daily run populates England listings; he can save and note jobs; cron runs unattended.

**Phase 2 — Boards + dedupe + digest (1 day)**
- Higherin, Reed, Adzuna sources; dedupe + `listing_sources` + source badges; email digest; failure email.
- Done when: Thales/FCA/Airbus-style Higherin listings appear merged with FAA duplicates; first real digest received.

**Phase 3 — Employers (2–3 days)**
- 3a: `employers.json` from seed, `sync-employers`, `detect-ats`, connectors workday/successfactors/oracle/avature/oleeo/eightfold, watchlist statuses, Companies page.
- 3b: remaining connectors, `jsonld`, `pagehash`, `manual`.
- 3c: validate all 145 employers once by hand (record fixtures); health page.
- 3d: discovery (§6.5 D1–D3): `employer_suggestions`, learn-from-listings, `process.ts`, Google Jobs (SerpApi) and Tavily sources with monthly budget counters in `source_state`, Add company + Suggested tab.
- Done when: ≥ 80% of employers report `open/closed` (not error/unknown) and Barclays Glasgow L6 shows up from Workday.

**Phase 4 — Map + polish (½–1 day)**
- Map page, CSV export, PWA manifest, empty states, mobile QA.

**Phase 5 — Coverage extras (as time allows)**
- Scotland/Wales/NI sources, Amazing Apprenticeships PDF, NGTU, NHS XML fallback, Claude scoring (load the `claude-api` skill before implementing; use the cheapest current model with structured output; only for new listings with base score ≥ 30; cache in `listings.ai`), Playwright for blocked employers (separate workflow job with `npx playwright install --with-deps chromium`; honest evaluation of whether datacenter IPs even pass).

---

## 12. Setup checklist (accounts/keys; do before Phase 0)
1. Supabase account → new project (London) → copy URL, `sb_publishable_…` key, `sb_secret_…` key. Add your brother as an org team member (so the built-in auth mailer can reach him).
2. FAA Display Advert API key: ✅ done; it's in `.env` as `FAA_API_KEY` and verified working. Still add it as a GitHub Actions secret.
3. Reed API key: https://www.reed.co.uk/developers/jobseeker (free account).
4. Adzuna: https://developer.adzuna.com/signup (app_id + app_key).
5. Email: create a dedicated Gmail account for the bot, turn on 2-Step Verification, generate an App Password (Google Account → Security → App passwords). That's `SMTP_USER`/`SMTP_PASS`.
6. GitHub repo: enable Pages (source: GitHub Actions); add secrets/variables (§9.2).
7. SerpApi key (Google Jobs search): https://serpapi.com → free plan, 250 searches/month → `SERPAPI_KEY`.
8. Tavily key (web search): https://tavily.com → free plan, 1,000 credits/month, no card → `TAVILY_API_KEY`.
9. Optional: Anthropic API key.
10. His details to enter in Settings after first login: home postcode, levels (6,5,4), roles.

---

## 13. Testing strategy
- `packages/shared`: table tests for `classify` (≥ 60 real titles), `score`, date/salary parsers, `normaliseEmployer`, gazetteer matching, dedupe keys.
- `packages/scraper`: each connector/source has a fixture-driven test (`--record` to capture; sanitise). Contract test: every connector's output validates against the `RawListing` zod schema. `http.ts` bot-wall detection test.
- Smoke in CI: `scrape --dry-run --source faa` with key (skipped if secret absent).
- Web: vitest + testing-library for filter logic and status flows; manual mobile QA checklist in README.

---

## 14. Risks and mitigations
| Risk | Mitigation |
|---|---|
| ATS endpoint changes silently (Workday CXS undocumented) | fixtures + health page + "0 jobs after >0" alert; connectors isolated per file |
| Bot walls from Azure runner IPs | `BlockedError` → status `blocked` (never "no jobs"); `manual` connector; Phase 5 Playwright trial |
| GitHub disables cron after 60 days inactivity | daily `[skip ci]` commit of `data/last-run.json` from the scrape job (verified rule; see §9.1) |
| Supabase free project pauses after 7 quiet days | daily writes keep it active; failure email if DB unreachable; optional auto-restore via management API (§9.4) |
| Bot walls vs headless browser | Cloudflare-protected sites usually block headless Chromium from runner IPs too; Playwright is a Phase 5 experiment, not a dependency |
| Duplicates across sources | dedupe key + manual merge later; show all source links |
| False positives/negatives in classification | rules in `config/keywords.json`, tests, "wrong" note tag, optional Claude pass |
| Email deliverability | both recipients whitelist sender; plain-text alternative |
| Adzuna/Reed T&Cs | attribution badge; personal non-commercial; login-only app |
| Geocoding gaps | gazetteer + postcodes.io; unknown-location listings still listed |

---

## 15. Remaining judgement calls for the implementer
- Scotland API key is read from public JS; if SDS objects or it starts failing, drop the source (volume is tiny anyway).
- Whether to auto-restore a paused Supabase project from the workflow (needs a PAT secret). Default: no; rely on daily activity + failure email.
- Claude scoring (Phase 5) only if keyword classification proves noisy after a week of real data.

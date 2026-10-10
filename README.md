# Apprenticeship Finder

A private, login-only dashboard of UK data-science apprenticeships (data scientist, data analyst, ML/AI, data engineering; levels 4–7, ranked by the High/Maybe/No preferences in Settings). A daily GitHub Actions job collects listings into Supabase from job boards, the gov.uk, Scottish, Welsh and NI services, 145+ employers' own careers sites and web-wide discovery; the React app on GitHub Pages reads them.

- Live site: https://alexslater1.github.io/apprenticeship-finder/ (sign-in required)
- Decisions: [`BRIEF.md`](BRIEF.md) · Build plan: [`PLAN.md`](PLAN.md) · Source research: [`research/`](research/)

## Layout

```
apps/web            Vite + React dashboard (GitHub Pages)
packages/shared     types, classification + scoring rules, parsers (used by both)
packages/scraper    CLI: scrape, digest, migrate, sync-employers, detect-ats, rederive, skill-candidates
                    (runs in GitHub Actions)
  src/sources/      aggregators: faa, higherin, reed, adzuna, scot, wales, ni, amazing, ngtu,
                    google-jobs (SerpApi), web-search (Tavily)
  src/connectors/   employer job systems (Workday, SuccessFactors, Oracle, Avature, Oleeo, Eightfold,
                    Phenom, Greenhouse, …) plus generic jsonld / pagehash / manual
  src/discovery/    suggestions: learn employers from listings, turn approved ones into employers
config/             keywords.json (classification rules), standards.json (LARS codes), uk-places.json (gazetteer),
                    universities.json (names the degree partner), employers.json (watchlist + connectors),
                    employers.excluded.json (checked and left out), discovery.json (search queries, budgets),
                    university-rankings.json (Complete University Guide positions; rebuild yearly with
                    scripts/build-university-rankings.ts), skills.json (the Skills page's dictionary)
supabase/migrations SQL schema + row-level security
.github/workflows   ci.yml, deploy-web.yml, scrape.yml (daily 06:23 UTC)
data/last-run.json  public run summary committed daily (keeps the cron alive)
```

## Local development

Needs Node 24.

```sh
cp .env.example .env               # fill in keys (see below)
npm install
npm run dev                        # http://localhost:5173, uses the hosted Supabase
npm run scrape -- --dry-run        # fetch + classify, print, write nothing
npm run scrape -- --source faa     # one source, writes to Supabase
npm run scrape -- --employer barclays,thales --dry-run   # just these employers' careers sites
npm run scrape -- --source employers --dry-run           # every watched employer
npm run cli -w packages/scraper -- detect-ats https://careers.example.com/jobs   # which job system?
npm run migrate                    # apply supabase/migrations/*.sql (needs SUPABASE_DB_PASSWORD)
npm test                           # vitest
npm run lint && npm run typecheck
```

Classification is table-driven: edit `config/keywords.json` and run `npm test` to see what changes.

The match score is the base score (role, level, degree, clear title, freshness, penalties) with the role and level points taken from Settings → High/Maybe, plus Settings extras: university league-table position, predicted grades against the advert's entry requirements, earliest start, minimum salary, degree preference and favourite companies. Weights are in `config/keywords.json` → `personal`; each listing's "Why this match" shows the parts.

### Skills

The Skills page ranks what the adverts mention, each advert weighted by its match score. `config/skills.json` lists the skills and the wordings that count as each one; every scrape tags the adverts it sees, and `packages/shared/src/skills.ts` decides from the surrounding wording whether an advert asks for a skill, teaches it, or lists it as a duty. To grow the list:

```sh
npm run cli -w packages/scraper -- skill-candidates   # frequent requirement phrases no skill covers, by employer count
# add a skill or a wording to config/skills.json, then
npm run cli -w packages/scraper -- rederive           # re-tag every stored listing (and fill start dates)
```

### Employers

`config/employers.json` is the watchlist: identity, the job system (`connector`) and its settings (`connector_config`, shapes in `research/ats-platforms.md` §20 and `src/connectors/*.ts`). Every scrape syncs it into the `employers` table; status, counts and the Watch toggle live in the database. To add one by hand, run `detect-ats` on its careers page and paste the result. Companies added from the dashboard ("Add company") or found by discovery live only in the database. `connector_note` records what the 2026-10-09 checks found; `manual` is for sites that block bots or forbid crawling in robots.txt, which we respect rather than work around.

### Discovery

Google Jobs (6 searches a day, SerpApi free plan) and Tavily (10 a day) look for adverts and pages at companies we don't watch; every strong listing at an unwatched company becomes a suggestion. Suggestions whose apply link reveals a known job system are watched automatically; the rest wait in Companies → Suggested. Monthly search counts are on the Health page and in the email when they pass 80%.

## Configuration

| Where | Name | Notes |
|---|---|---|
| Actions secret | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | scraper writes with the secret key (bypasses RLS) |
| Actions secret | `FAA_API_KEY` | Find an Apprenticeship Display Advert API v2 |
| Actions secret | `SMTP_USER`, `SMTP_PASS`, `DIGEST_TO` | Gmail app password; comma-separated recipients |
| Actions secret | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `REED_API_KEY`, `SERPAPI_KEY`, `TAVILY_API_KEY` | optional; a source is skipped when its key is missing |
| Actions variable | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | baked into the web build; public by design |
| Actions variable | `SMTP_HOST`, `SMTP_PORT` | `smtp.gmail.com`, `465` |

Supabase dashboard settings (not in code):
- Authentication → Sign In / Providers: "Allow new users to sign up" **off**.
- Authentication → URL Configuration: Site URL `https://alexslater1.github.io/apprenticeship-finder/`; Redirect URLs `https://alexslater1.github.io/apprenticeship-finder/**` and `http://localhost:5173/**`. Without this, invite and reset links go to localhost.
- Users are added with Authentication → Users → "Send invitation". The invite link opens the app's "Set your password" screen.

## Operations

- Run the scrape now: Actions → scrape → Run workflow (or `gh workflow run scrape.yml`). Inputs: `sources` (e.g. `faa`, or `employers`), `employers` (e.g. `barclays`), `dry_run`.
- If GitHub ever disables the schedule: `gh workflow enable scrape.yml`.
- If Supabase pauses the project after a quiet week: Dashboard → Restore.
- Logs from each run are uploaded as a workflow artifact for 14 days.

## Data sources and terms

Contains public sector information licensed under the Open Government Licence v3.0 (Find an Apprenticeship). Every listing links back to its source. Personal, non-commercial use; see `research/` for each source's terms and what we deliberately don't scrape.

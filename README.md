# Apprenticeship Finder

A private, login-only dashboard of UK data-science apprenticeships (data scientist, data analyst, ML/AI, data engineering; levels 6/5 first, then 4). A daily GitHub Actions job collects listings into Supabase; the React app on GitHub Pages reads them.

- Live site: https://alexslater1.github.io/apprenticeship-finder/ (sign-in required)
- Decisions: [`BRIEF.md`](BRIEF.md) · Build plan: [`PLAN.md`](PLAN.md) · Source research: [`research/`](research/)

## Layout

```
apps/web            Vite + React dashboard (GitHub Pages)
packages/shared     types, classification + scoring rules, parsers (used by both)
packages/scraper    CLI: scrape, digest, migrate (runs in GitHub Actions)
config/             keywords.json (classification rules), standards.json (LARS codes), uk-places.json (gazetteer)
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
npm run migrate                    # apply supabase/migrations/*.sql (needs SUPABASE_DB_PASSWORD)
npm test                           # vitest
npm run lint && npm run typecheck
```

Classification is table-driven: edit `config/keywords.json` and run `npm test` to see what changes.

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

- Run the scrape now: Actions → scrape → Run workflow (or `gh workflow run scrape.yml`). Inputs: `sources` (e.g. `faa`), `dry_run`.
- If GitHub ever disables the schedule: `gh workflow enable scrape.yml`.
- If Supabase pauses the project after a quiet week: Dashboard → Restore.
- Logs from each run are uploaded as a workflow artifact for 14 days.

## Data sources and terms

Contains public sector information licensed under the Open Government Licence v3.0 (Find an Apprenticeship). Every listing links back to its source. Personal, non-commercial use; see `research/` for each source's terms and what we deliberately don't scrape.

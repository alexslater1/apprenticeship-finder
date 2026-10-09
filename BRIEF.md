# Apprenticeship Finder: requirements brief

Status: requirements gathered (2026-10-09). Code plan not written yet; that is the next step.

## Who and why
- User: a Year 13 student in the UK, starting an apprenticeship around September 2027. Built for him by his sibling.
- Goal: find every UK data-science-related apprenticeship, including the many that never appear on gov.uk. Show them in a personal dashboard with tracking.
- Timing: degree-apprenticeship applications for Sept 2027 open between now and about March 2027, so v1 should ship quickly.

## Decisions made
| Topic | Decision |
|---|---|
| Hosting | **Free cloud, auto-updating.** A GitHub Actions cron scrapes daily and the React dashboard is a static site (GitHub Pages). The main repo is **public**. |
| Database | **Supabase (free Postgres + Auth)** is recommended over a private GitHub repo used as a data store. Browser storage is rejected. It holds both the listings and his tracking data. |
| Access control | The dashboard **requires login** (Supabase Auth, sign-ups disabled, accounts for him and his sibling only). Row-level security on every table. Login-only also keeps it personal use, which suits the terms of the sources. |
| Secrets | API keys, the Supabase service key and email credentials go in GitHub Actions secrets, with a local `.env` that is gitignored. Only the Supabase publishable/anon key goes in the frontend; it is meant to be public and RLS protects the data. |
| Roles | Data science, data analyst, and maybe ML/AI. |
| Levels | Prioritise **L6 and L5**, then L4. Store other levels but hide them by default. |
| Relevance | **v1: free keyword/rules score** (role match × level match × keyword strength). Preferences set in the dashboard (levels, role types, locations) re-rank results. **Later:** an optional Claude API step for scoring and field extraction, switched on only if an `ANTHROPIC_API_KEY` secret exists. |
| Coverage | **Whole UK.** That means the Scottish, Welsh and NI systems too (Scotland's degree apprenticeships are called "Graduate Apprenticeships"). |
| Tracker | **Shared household view.** One set of statuses, notes and hidden jobs for both logins; each note records its author. |
| Email | **New matches + closing-soon reminders** for saved/applied jobs (7 days) + watchlist companies that just opened. Sent to both; recipient list is a secret. |

## Required features
- Listings view with filters: city/region, **distance from his postcode** (his postcode is stored in his settings, not in the repo), level, role type, salary, closing date, company and source. Sort by score or closing date. "New" badges.
- **Notes on every job**, and on companies too.
- **Application tracker** with statuses: saved, applied, interview, offer, rejected. Plus a "closing soon" view of saved jobs.
- **Discard/hide** a job, and a **Hidden list** to restore anything hidden by mistake.
- **Daily email digest** of new matches.
- **Company watchlist**: big employers whose schemes aren't open yet, when they usually open, and a flag that flips when a listing appears.
- **Map view** with UK pins, alongside the table/card view.
- **Add company** button (paste a careers URL; it gets watched from the next run).
- **Discovery of unknown employers**: Google for Jobs (SerpApi) + open web search (Tavily) daily, and auto-learning employers from every relevant listing, feeding a Suggested tab (strong matches auto-watched).
- Must work well on a phone.

## Sources (details in `research/`)
1. **Find an Apprenticeship API v2 (England)**, the primary source. Notes in `research/gov-api.md`.
   - Free key; headers `Ocp-Apim-Subscription-Key` and `X-Version: 2`; 150 requests per 5 minutes; no CORS.
   - Filter with `StandardLarsCode[]`. There's no keyword or level filter, so do those ourselves.
   - LARS codes:
     - L3: Data technician 576
     - L4: Data analyst 80, AI & automation practitioner 828, Business analyst 165
     - L5: Data engineer 746
     - L6: Data scientist 337 (degree), DTS professional 25 (degree, data specialism), ML engineer 795
     - L7: AI data specialist 561
2. **Employer careers sites.** `research/employers.seed.json` lists 145 employers with their ATS (applicant tracking system). Main platforms: Workday, SuccessFactors, Oracle HCM, Avature, Oleeo, Eightfold, Phenom.
   - Connector recipes are in `research/ats-platforms.md`, all tested live with no headless browser needed. ATS keyword search is unreliable, so fetch all UK jobs per employer and filter ourselves.
   - Use a page-hash change check as the fallback for unknown or own-site employers.
3. **Higherin (formerly RateMyApprenticeship)**, the best secondary source. Diff its sitemap, then read the structured data on new job pages. Notes in `research/job-sites.md`.
4. **Secondary sources:** Reed API, Adzuna API (must show "Adzuna" on its ads), the Amazing Apprenticeships PDF (three times a year; next edition due about 13 Oct 2026) and Not Going To Uni.
5. **Do not scrape:** LinkedIn, Indeed, Totaljobs, UCAS, Gradcracker, Bright Network, CV-Library, Prospects. Their terms ban it or they block bots.
6. **Not researched yet (needed for whole-UK coverage):** apprenticeships.scot (Graduate Apprenticeships), Careers Wales apprenticeship vacancies, NI apprenticeships (nidirect).

## Known gotchas
- **Bot checks:** Civil Service Jobs, some tal.net employers, NatWest, Aviva and the Home Office show bot checks. Use the gov API's `AdditionalDataSources` header (`Csj`/`Nhs`, untested) or a headless browser, or mark them as manual-check.
- **Robots/crawl rules:** tal.net and Cornerstone set a 10-second crawl delay. SmartRecruiters' API host disallows bots, so use its careers pages instead. Respect robots.txt and use a descriptive User-Agent.
- **Scheduled workflow shutdown:** GitHub disables scheduled workflows in public repos after 60 days with no repo activity. The scraper writes to Supabase rather than committing, so a keepalive is needed.
- **Supabase free tier:** projects pause after a period of inactivity. Check that daily scraper writes keep it awake.
- **Untrusted HTML:** job descriptions are scraped HTML. Sanitise them before rendering.
- **Deduplication:** the same vacancy appears on FAA, Higherin and the employer site. Dedupe across sources by normalised employer + title + location, and keep every source link.

## Resolved during planning (see PLAN.md)
- Repo: https://github.com/alexslater1/apprenticeship-finder (public). Digest goes to both of you.
- Email sender: Gmail App Password via nodemailer (Resend can't email others without a domain).
- Bot-walled employers: "check manually" links on the watchlist in v1; Playwright is a later experiment.
- Supabase free tier is ample; projects pause after 7 quiet days, which the daily scraper prevents.
- Scotland/Wales/NI: sources found and documented in `research/devolved-nations.md`; tiny volume, Phase 5.

## Time-sensitive (as of 2026-10-09; tell him now)
- **Open now:** WTW closes 19 Oct, Airbus 26 Oct, Barclays (Glasgow) 31 Oct, Thales 17 Feb 2027.
- **Opening soon:** GCHQ/MI5/MI6 16 Oct, Lloyds 3 Nov, BP 4 Nov, Unilever 9 Nov.

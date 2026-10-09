# Infrastructure research — verified 2026-10-09

Scope: GitHub Actions daily cron (Node 24 / TypeScript) -> Supabase Free -> Vite+React on GitHub Pages with Supabase Auth; public repo; 2 users.
Everything below was checked against the live page on 2026-10-09 unless marked **[UNVERIFIED]** or **[secondary source]**.

---

## 1. Supabase Free plan (today)

Source: https://supabase.com/pricing and https://supabase.com/docs/guides/platform/compute-and-disk

| Item | Free plan |
|---|---|
| Active projects | **2** |
| Database size | **500 MB** per project (Nano compute: shared CPU, 0.5 GB RAM, 60 direct DB connections, 200 pooler clients) |
| Monthly active users | **50,000** |
| Egress | **5 GB** + 5 GB cached egress |
| File storage | 1 GB (50 MB max upload) |
| Edge Functions | **500,000 invocations** included (https://supabase.com/docs/guides/functions/pricing) |
| API requests | unlimited |
| Custom SMTP | included |
| Log retention | 1 day; auth audit logs 1 hour |
| Compute credits | none (Pro = $25/mo + $10 compute credit) |
| Not on Free | backups/PITR, branching, custom domains, leaked-password protection, log drains, email support |

Pricing page says only "Pricing may change in the future". No official 2026 Free-plan change was found; third-party trackers (costbench, jetadmin) mention a Feb-2026 plan addition but nothing affecting Free **[secondary source]**. Treat the table above as current.

### Pausing
Source: https://supabase.com/docs/guides/platform/free-project-pausing
- "Supabase pauses Free Plan projects that show low activity over a **7-day** period."
- "A Free plan project is considered inactive if it does not receive sufficient **user database activity** over the past week." "Typically a few user requests to the database each day over the previous week is enough to keep the project from being paused."
- Warning email ~1 week before pause. Dashboard visits and API calls both listed as ways to generate activity.
- Restore window: body text says **1 year** (heading still says "90-day" — docs are inconsistent; https://supabase.com/docs/guides/platform/upgrading also says 1 year). After that only a backup download.
- Paid plans are never paused.
- **Does a daily service-role write count?** The docs do not mention key type; they measure "database activity". A daily `INSERT`/`UPSERT` through the REST API or a direct Postgres connection with the secret key is database activity and, per the "a few requests a day" guidance, should keep the project alive. **[UNVERIFIED by official text — only inferred; a GitHub discussion reply (not clearly staff) says writes count: https://github.com/orgs/supabase/discussions/13121]**. Mitigation: have the cron also do a cheap read (e.g. `select count(*)`) and a heartbeat upsert, and keep the 2 users logging in.
- **Un-pause programmatically: yes.** Management API `POST /v1/projects/{ref}/restore` (https://supabase.com/docs/reference/api/v1-restore-a-project), needs PAT with `project_admin_write` / OAuth scope `projects:write`; `POST /v1/projects/{ref}/pause` also exists. Management API limit: 120 req/min (https://supabase.com/docs/reference/api/introduction). Pattern: cron step calls `GET /v1/projects/{ref}` (status), if `INACTIVE` call restore, wait, then scrape. Restore takes a few minutes **[UNVERIFIED timing]**.

### Extensions on Free
- Docs say "over 50 extensions", Dashboard > Database > Extensions; **no plan gating is documented anywhere** for pg_cron, PostGIS, pg_net (https://supabase.com/docs/guides/database/extensions, https://supabase.com/docs/guides/database/extensions/postgis, https://supabase.com/docs/guides/cron).
- supabase/postgres image build list (https://raw.githubusercontent.com/supabase/postgres/develop/nix/ext/versions.json) includes **pg_cron 1.6.x, postgis 3.3.x, pg_net, pg_graphql, vector**.
- `cube` and `earthdistance` are Postgres contrib modules shipped with the image (not listed in that JSON because they aren't third-party) **[UNVERIFIED on the dashboard list; `create extension earthdistance cascade;` is the way to check]**.
- PostGIS: install into a non-public schema (`gis` / `extensions`) so `spatial_ref_sys` isn't exposed via the Data API.
- Supabase Cron (pg_cron) granularity: "every second to once a year".
- Edge Functions: included on Free (500k invocations). Not needed for this design.

---

## 2. Supabase Auth

### Disable public sign-ups / invite-only
- Dashboard > Authentication > Sign In / Providers (general config): **"Allow new users to sign up"** — "Users will be able to sign up. If this config is disabled, only existing users can sign in." (https://supabase.com/docs/guides/auth/general-configuration)
- Invite flow (https://supabase.com/docs/guides/auth/users): Dashboard > Authentication > Users > **Add user > Send invitation**, or server-side `supabase.auth.admin.inviteUserByEmail(email, { redirectTo })` with the secret key. Invite link confirms the email and lands the user on your `redirectTo` (must be in allowed Redirect URLs, else silently falls back to Site URL); from there call `supabase.auth.updateUser({ password })`. Invite links expire per "Email OTP Expiration" (default 1 h). Inviting an already-confirmed email errors.
- Recommended for 2 users: invite both from the dashboard, then turn **off** "Allow new users to sign up". Magic-link sign-in still works for existing users; for belt-and-braces pass `shouldCreateUser: false` to `signInWithOtp`.

### Magic link vs email+password
- https://supabase.com/docs/guides/auth/auth-email-passwordless: `signInWithOtp({ email })` sends a magic link by default (template decides link vs 6-digit code); link/code expire after 1 hour; one request per 60 s per user. `shouldCreateUser: false` prevents auto-signup.
- Email+password: "Confirm email" is on by default for hosted projects (https://supabase.com/docs/guides/auth/auth-email). Password login sends **zero emails** after setup -> best choice if you stay on the built-in sender.

### Built-in email sender limits (matter a lot even for 2 users)
- https://supabase.com/docs/guides/auth/auth-smtp and https://supabase.com/docs/guides/auth/rate-limits: built-in SMTP is **2 emails/hour** per project, best-effort, and **only delivers to addresses that are members of the Supabase organization team** ("Email address not authorized" otherwise). So: either add both users as org team members (fine for 2), or set custom SMTP (then default becomes 30/h, raisable). Custom SMTP is included on Free.
- Verdict: 2 users + password login = 2/h is fine (invites + occasional reset). Magic-link-only for 2 people who log in daily is also within 2/h, but can collide; password or a custom SMTP (Brevo/Resend) removes the worry.

### RLS "own rows only"
Source: https://supabase.com/docs/guides/database/postgres/row-level-security
```sql
alter table public.saved_jobs enable row level security;

create policy "own rows select" on public.saved_jobs
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "own rows insert" on public.saved_jobs
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "own rows update" on public.saved_jobs
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "own rows delete" on public.saved_jobs
  for delete to authenticated
  using ( (select auth.uid()) = user_id );
```
- Wrap `auth.uid()` in `(select ...)` so it's an initPlan (evaluated once per statement). Always use `to authenticated`.
- Shared `jobs` table (written by the cron with the secret key): RLS on, `for select to authenticated using (true)`, no anon policy.
- Any table in an exposed schema without RLS is readable/writable by anyone with the publishable key — enable RLS on every `public` table.

### Keys
Source: https://supabase.com/docs/guides/api/api-keys and https://github.com/orgs/supabase/discussions/29260
- New keys: `sb_publishable_...` (client-safe, "Safe to expose online: web page, mobile or desktop app, GitHub actions, CLIs, source code", limited by RLS) and `sb_secret_...` (server only, bypasses RLS via `service_role`). Not JWTs; legacy keys start with `eyJ`.
- Timeline: early access June 2025, full launch July 2025; projects created/restored after **1 Nov 2025 don't get legacy anon/service_role keys**; legacy keys to be deleted "late 2026 (TBC)" / "by the end of 2026". A new project today will only have the new keys -> use `sb_publishable_` in the Vite build (as `VITE_SUPABASE_PUBLISHABLE_KEY`, public by design) and `sb_secret_` as a GitHub Actions secret.
- Publishable key in a public repo's built JS is fine **only because RLS is on**; it is not a secret.

---

## 3. GitHub Actions + Pages

### Minutes / cost
- "GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners." (https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions). Larger runners are always billed. Not literally "unlimited" wording, but no minute cap for public repos on standard runners.

### Schedule semantics
Source: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows
- POSIX 5-field cron, UTC by default (IANA timezone optional), minimum interval 5 min, runs only from the **default branch** workflow file.
- Jitter: "The `schedule` event can be delayed during periods of high loads... High load times include the start of every hour." -> use e.g. `23 6 * * *`, not `0 6 * * *`. Delays of minutes to >1 h are common **[experience, not documented numerically]**.
- **60-day rule**: "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days." Forks have schedules disabled by default. (https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow). "Repository activity" is not defined in the docs; commits are the safe interpretation. There is no email when it happens.
- Re-enable: UI "Enable workflow", `gh workflow enable <file.yml>`, or `PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable` (https://docs.github.com/en/rest/actions/workflows#enable-a-workflow).
- Workarounds:
  1. **Commit from the cron** — e.g. write `data/last-run.json` or a scraped snapshot and push (needs `permissions: contents: write`). Real commits = activity. Simplest and also gives you a free audit trail.
  2. `efrecon/gh-action-keepalive` (https://github.com/efrecon/gh-action-keepalive, pushed 2026-09) — makes a marker commit if no authorship activity for 41 days. Its README notes that merely toggling workflow state via API did **not** bypass the deadline.
  3. **`gautamkrishnar/keepalive-workflow` is gone** — GitHub API returns "Repository access blocked, reason: tos" (blocked 2025-04-21). Do not reference it; many blog posts still do.
  4. `workflow_dispatch` manual run also resets the clock (and is required anyway for debugging).
- `workflow_dispatch`: `on: workflow_dispatch:` with optional `inputs` (max 25); `gh workflow run scrape.yml -f dryRun=true`. Only dispatchable once the file is on the default branch.
- Concurrency (https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs): one running + one pending per group; `cancel-in-progress` default false. For a scraper use:
  ```yaml
  concurrency:
    group: scrape
    cancel-in-progress: false   # let the running scrape finish; queue the manual one
  ```
- Secrets (https://docs.github.com/en/actions/reference/security/secrets): 100 repo secrets, 48 KB each, redacted in logs, not passed to fork-triggered runs (public repo = PRs from forks can't read `SUPABASE_SECRET_KEY`). Scheduled runs on the default branch get full secrets (implied; not separately stated). Pass via `env:` not inline CLI args. Set top-level `permissions: {}` and grant per job.
- Variables (`${{ vars.X }}`): 500 per repo, 48 KB each, plain text, visible to anyone with repo settings access — fine for `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (https://docs.github.com/en/actions/reference/workflows-and-actions/variables).

### Node 24 on runners
- `actions/setup-node` supports `node-version: 24` (https://github.com/actions/setup-node). Runner JS actions default to Node 24 since 16 Jun 2026; Node 20 removed 23 Sep 2026 (https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) -> use `actions/checkout@v6`, `setup-node@v5+`, `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5` (versions as in Vite's current guide).
- Node 24 runs `.ts` directly (type stripping stable since 24.12.0; https://nodejs.org/api/typescript.html) — but no enums/namespaces-with-code/parameter properties, no `tsconfig` paths, and import specifiers must include `.ts`. Either write erasable-only TS and run `node src/scrape.ts`, or keep `tsx`/`tsc` for a normal workflow.

### GitHub Pages for an SPA
- Limits (https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits): 1 GB site, **100 GB/month soft bandwidth**, 10 builds/hour (exempt when deploying via custom Actions workflow), 10-min deploy timeout, no commercial/e-commerce use. A personal dashboard is fine.
- Client-side routing: Pages serves a root `404.html` for unknown paths (https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site). Standard trick = rafgraph/spa-github-pages (https://github.com/rafgraph/spa-github-pages): `404.html` redirects to `/?/path`, `index.html` restores it with `history.replaceState`; set `pathSegmentsToKeep = 1` for a project site and `<BrowserRouter basename="/<repo>">`. Simpler alternative: **use hash routing** (`createHashRouter`) and skip the trick entirely — recommended for a private 2-user tool.
- Vite (https://vite.dev/guide/static-deploy): project site needs `base: '/<repo>/'`; Pages source = "GitHub Actions"; workflow permissions `contents: read, pages: write, id-token: write`, environment `github-pages`.
- Env at build time (https://vite.dev/guide/env-and-mode): only `VITE_*` vars reach `import.meta.env`, statically inlined at build; docs warn they must not hold secrets — the publishable key is explicitly not a secret, so `env: VITE_SUPABASE_URL: ${{ vars.SUPABASE_URL }}` in the build step is the right pattern.

---

## 4. Email digest (free, from Actions, no custom domain)

| Provider | Free limit | Without verified domain? | Notes |
|---|---|---|---|
| **Resend** (https://resend.com/pricing, https://resend.com/docs/api-reference/errors) | 3,000/mo, **100/day**, 3 domains | **No.** `onboarding@resend.dev` only sends to your own account email; otherwise 403 `validation_error` "You can only send testing emails to your own email address". Docs: "You must add and verify at least one domain to send emails with Resend." | Nicest API, but needs a domain you own. |
| **Brevo** (https://www.brevo.com/features/email-api/, https://www.brevo.com/pricing/) | **300/day**, "no time limit and no credit card", REST API + SMTP relay (port 587) included; 1,000 req/s | Sender verification required; a verified **sender address** (e.g. your Gmail) is enough, domain auth optional **[sender-vs-domain detail: secondary/experience, not quoted on the pages fetched]**. Pricing FAQ: "Once we approve your account for sending" — new accounts go through a manual approval step. | Brevo logo in free emails **[secondary source]**. |
| **Gmail SMTP + App Password + nodemailer** (https://support.google.com/mail/answer/22839, https://support.google.com/accounts/answer/185833) | **500 messages/day**, 500 recipients/message (personal Gmail) | N/A — sends as you | Requires 2-Step Verification; app passwords unavailable if 2SV is security-key-only, Advanced Protection, or managed Workspace account. Google "doesn't recommend" app passwords but they work. Deliverability to the 2 recipients is excellent (it's your real Gmail). |
| **Mailjet** (https://www.mailjet.com/pricing/) | 6,000/mo, **200/day**, API+SMTP, Mailjet logo on free | Sender/domain validation required **[not quoted on the page fetched]** | No advantage over Brevo. |
| **Supabase built-in SMTP** | 2/hour, team members only, "toy projects" | — | It's Auth-only (templates for confirm/magic link/invite); there is no "send arbitrary email" API. Not an option for digests. |

**Recommendation: Gmail SMTP via nodemailer with an App Password** for "daily digest to 2 recipients": zero domain setup, 500/day, lands in inbox (same provider as recipient if they're Gmail), one secret (`GMAIL_APP_PASSWORD`) + one var (`GMAIL_USER`). Fallback / second choice: **Brevo** (300/day, real API, verified sender address) if you'd rather not keep an app password in CI or the recipients are on different providers and you want tracking. Resend only once you own a domain.

nodemailer config: `host: smtp.gmail.com, port: 465, secure: true, auth: { user, pass: appPassword }` **[standard config; not re-verified against a Google page today]**.

---

## 5. Postcodes & distance

### postcodes.io
- "Postcodes.io is a free postcode lookup API and geocoder for the UK." MIT licensed, no API key (https://postcodes.io/docs/api, https://github.com/ideal-postcodes/postcodes.io).
- Bulk lookup: `POST https://api.postcodes.io/postcodes` body `{"postcodes": [...]}` — "Accepts up to 100 postcodes" (https://postcodes.io/docs/api/bulk-postcode-lookup). Bulk reverse geocode: up to 100 geolocations. Returns `latitude`, `longitude`, `eastings/northings`, `admin_district`, `region`, `lsoa`, etc. (probed live today: works, no key).
- Nearest: `GET /postcodes?lon=&lat=&radius=&limit=` — live probe with `limit=999` returned exactly **100** results, so limit caps at 100; radius cap (historically 2,000 m) **[UNVERIFIED today — the docs pages no longer print parameter maxima]**.
- Rate limiting: none documented. Be polite (bulk endpoint, cache results in a `postcodes` table keyed by normalised postcode so each postcode is geocoded once). No SLA — it's a community service; self-hostable via Docker if it ever matters.
- Outward-code-only data (e.g. "SW1A"): `GET /outcodes/:outcode` gives a centroid — handy when listings only give partial postcodes.

### Distance filtering in Postgres without PostGIS
Source: https://www.postgresql.org/docs/current/earthdistance.html
- `create extension if not exists earthdistance cascade;` (pulls in `cube`). Assumes a spherical Earth (fine for "within 25 miles" filtering).
- `earth_distance(ll_to_earth(lat1, lon1), ll_to_earth(lat2, lon2))` -> metres. `earth_box(ll_to_earth(lat, lon), radius_m) @> ll_to_earth(j.lat, j.lon)` is indexable with a GiST index on `ll_to_earth(lat, lon)`; add the `earth_distance(...) <= radius_m` second check because the box over-includes.
- Pure-SQL haversine (no extension) also works for < 100k rows:
  ```sql
  2 * 6371000 * asin(sqrt(
    sin(radians(lat2-lat1)/2)^2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2-lon1)/2)^2))
  ```
  Expose as a Postgres function / RPC (`create function jobs_within(lat, lon, radius_m)`) so RLS still applies.
- Client-side: with a few thousand rows a 10-line haversine in TS after fetching `lat, lon` is simplest and avoids any extension; prefer server-side (earthdistance + RPC) only if the table grows or you want radius in the PostgREST query to cut egress (5 GB/mo is generous either way).
- PostGIS is available if you want `geography` + `ST_DWithin`, but it's heavier than needed here.

---

## 6. Playwright on ubuntu-latest

- Official CI guide (https://playwright.dev/docs/ci) uses `npx playwright install --with-deps`; for one browser: `npx playwright install --with-deps chromium`; headless-only CI can use `--only-shell` to skip the full Chromium download (https://playwright.dev/docs/browsers). Docs explicitly say "Caching browser binaries is not recommended" (restore ~ as slow as download; OS deps can't be cached anyway). Alternative: run the job in `container: mcr.microsoft.com/playwright:v<version>-noble` (version must match the npm package).
- Cost: free on a public repo. Time: roughly 30–90 s for `--with-deps chromium` on ubuntu-latest **[UNVERIFIED — from experience, not documented]**; it's the dominant cost of a daily job that otherwise takes seconds.
- **Cloudflare-protected sites:** honest answer — yes, headless Chromium from a GitHub-hosted (Azure) IP is frequently challenged or blocked. Cloudflare's docs (https://developers.cloudflare.com/bots/concepts/bot-score/) describe heuristics, an ML model on headers/session/browser signals, and JavaScript Detections that "identifies headless browsers and other malicious fingerprints"; Bot Fight Mode "Identifies traffic matching patterns of known bots" and issues CPU-expensive challenges (https://developers.cloudflare.com/bots/get-started/bot-fight-mode/). Cloudflare does not publicly say "datacenter IPs are scored low", but ASN reputation is a known input and GitHub runner IPs are a well-known shared cloud range **[the ASN point is experience/secondary, not quoted]**. Expectation: sites with Bot Fight Mode / managed challenge on will fail from Actions regardless of stealth plugins; sites with plain Cloudflare CDN (no bot mode) usually work. Plan for it: prefer official APIs / JSON endpoints / RSS / ATS APIs (see ats-platforms.md), treat Playwright as a last resort per site, detect the challenge page and mark the source "blocked" rather than retrying.

---

## Recommended minimal architecture (from the above)

- One Supabase project (keeps the second Free slot spare), RLS on everything, `sb_secret_` in Actions secrets, `sb_publishable_` + URL in repo variables.
- `scrape.yml`: `on: schedule: '23 6 * * *'` + `workflow_dispatch`; `concurrency: scrape`; `permissions: contents: write`; steps: checkout@v6 -> setup-node@v5 (24) -> `npm ci` -> `npx playwright install --with-deps chromium` (only if a Playwright source is enabled) -> scrape -> upsert into Supabase -> write `data/last-run.json` and commit (keeps the 60-day clock alive and doubles as activity for Supabase via the write) -> send digest via Gmail SMTP.
- Optional guard step: Management API `GET /v1/projects/{ref}` -> if paused, `POST .../restore`, sleep, continue.
- `deploy.yml`: on push to main (paths `web/**`) -> Vite build with `VITE_*` from `vars` -> `upload-pages-artifact@v5` -> `deploy-pages@v5`; hash router to dodge the 404 trick.
- Auth: email+password, both users invited from dashboard, "Allow new users to sign up" off, both users added to the Supabase org so the 2/h built-in mailer can reach them for resets.

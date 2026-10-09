# Job boards and early-careers sites: research notes

Researched on **2026-10-09** for a once-a-day, low-volume scraper (GitHub Actions or a laptop) that collects UK data science, data analyst, AI and degree apprenticeships for a Year 13 student.

Each fact carries a tag showing how it was checked:

- **[V]**: fetched live today with curl or WebFetch (robots.txt, pages, API probes).
- **[D]**: from vendor docs fetched today.
- **[U]**: unverified. The fetch was blocked, the claim comes from a third party, or it needs an API key we don't have.

The government source (Find an apprenticeship Display Advert API, Skills England standards and LARS codes) is covered in depth in the sibling file `research/gov-api.md`. It is summarised here only so the ranking is complete.

---

## 0. TL;DR table

| Source | Access route | Key? | Rendering | robots.txt for jobs/search | ToS on scraping | Value for data/AI apprenticeships |
|---|---|---|---|---|---|---|
| **Find an apprenticeship (GOV.UK)** | Official REST API | Free account | n/a (API) | Site has no robots.txt (soft 404) | API is meant for reuse (OGL) | **Best.** Every England apprenticeship, filterable by LARS standard |
| **Higherin** (was RateMyApprenticeship) | Job sitemap + JSON-LD JobPosting; search JSON embedded in HTML | No | Server HTML with embedded JSON | Allowed except `search-term=`/`sort-by=`/`company=` params | No scraping clause found | **Very high.** Big-employer degree apprenticeships, some not on FAA |
| Adzuna | Official REST API | Free key | n/a | api host: `Disallow: /` (crawler rule only) | Attribution required. Personal research allowed | Medium. Untested without a key |
| Reed | Official REST API | Free key | n/a | `/api/` disallowed for crawlers (key-based API is separate) | Clause not found | Medium. Many results but noisy |
| NHS Jobs | Undocumented public XML endpoint | **None** | n/a | No robots.txt | Personal, non-commercial use only | Low volume. Also reachable through the FAA API `Nhs` source |
| Not Going To Uni | Opportunity pages have JobPosting JSON-LD. Listing is in the Next.js RSC payload | No | Next.js (data in HTML) | All allowed | Copyright only, no scraping clause | Low to medium. Mostly QA Ltd ads, which are also on FAA |
| Get My First Job | Server-rendered search and sitemap | No | Server HTML | Allowed | Personal use only | Low. Mostly an FAA mirror |
| Amazing Apprenticeships | PDF "Higher & Degree Vacancy Listing" (3 a year) | No | PDF | Allowed | n/a | Supplementary. New edition due **13 Oct 2026** |
| Jooble | REST API (POST) | Key via form | n/a | Site behind Cloudflare | [U] | Low. Aggregator duplicates |
| Careerjet | REST API v4 | Publisher key | n/a | `/job/`, `/search/rss.html` disallowed | Needs end-user IP/UA and Referer | Poor fit for batch use |
| Springpod | `__NEXT_DATA__` on opportunity pages | No | Next.js | Allowed | No clause found, but content sits behind a login | Very small (50 opportunities). Gated |
| UCAS | Algolia search behind Cloudflare challenge | n/a | Client JS + challenge | `/search/` disallowed | "must not … extract" | **Avoid** |
| Gradcracker | Cloudflare challenge on every page | n/a | Blocked | Allowed (robots only) | [U] | **Avoid** (blocked) |
| Bright Network | Cloudflare challenge, even on robots.txt | n/a | Blocked | [U] | [U] | **Avoid** |
| TARGETjobs | Graduate-only. Apprenticeship sites redirect to an advice article | n/a | Gatsby, jobs load client-side | Allowed | [U] | **Avoid** (no apprenticeship vacancies) |
| Prospects | AngularJS client-side search | n/a | Client JS | Allowed | "using the content in any other product without consent … breach" | **Avoid** |
| Civil Service Jobs | ALTCHA "Quick check needed" CAPTCHA | n/a | Blocked by CAPTCHA | Allowed (except JoobleBot) | [U] | Use the FAA API `Csj` source instead |
| Indeed | No public API. Cloudflare challenge | n/a | Blocked | Search allowed, `/viewjob` disallowed | **Explicit ban** on bots and scrapers | **Avoid** |
| LinkedIn | No public job-search API | n/a | n/a | `User-agent: * Disallow: /` | **Explicit ban** (User Agreement §8.2) | **Avoid** |
| Totaljobs | No public API | n/a | Server HTML | `/jobs/*?` mostly disallowed | "may not otherwise copy … unauthorised processing" | **Avoid** |
| CV-Library | Partner-only key API. Cloudflare 403 | n/a | Blocked | `/*?` disallowed | [U] | **Avoid** |

---

## Part A: Job board APIs

### A1. Adzuna API

- **Key:** register at https://developer.adzuna.com/signup [V: 200]. You get an `app_id` and an `app_key`, both sent as query params on every call [D].
- **Endpoint:** `GET https://api.adzuna.com/v1/api/jobs/gb/search/{page}?app_id=…&app_key=…` [D]. `gb` is the UK market. Pages start at 1.
  - OpenAPI spec (machine-readable): https://developer.adzuna.com/swagger/spec/test2.json [V]. Interactive docs: https://developer.adzuna.com/activedocs
  - Other endpoints: `/jobs/gb/categories`, `/histogram`, `/top_companies`, `/geodata`, `/history`, `/version` [V spec].
- **Search params, all verified in the OpenAPI spec:** `what`, `what_and`, `what_phrase`, `what_or`, `what_exclude`, `title_only`, `where`, `distance` (km, default 5), `location0`…`location7`, `max_days_old`, `category` (tag from `/categories`), `sort_dir` (`up`/`down`), `sort_by` (`default`/`hybrid`/`date`/`salary`/`relevance`), `salary_min`, `salary_max`, `salary_include_unknown`, `full_time`, `part_time`, `contract`, `permanent`, `company`, `results_per_page`. Response format is set by the `Accept` header or the `content-type=application/json` param.
- **Response fields** [D]: `count`, `results[]` with `id`, `title`, `description` (snippet only), `created`, `redirect_url`, `salary_min/max`, `salary_is_predicted`, `location{area[],display_name}`, `category{label,tag}`, `company{display_name}`, `contract_type`, `contract_time`, `latitude/longitude`.
- **Rate limits** (Terms of Service, https://developer.adzuna.com/docs/terms_of_service) [D]: **25 hits/minute, 250/day, 1,000/week, 2,500/month** by default.
- **Terms** [D]:
  - Permitted uses are publishing Adzuna ads, publishing Jobsworth salary estimates, and **personal research**.
  - Other commercial, academic or government use is limited to a 14-day trial.
  - **Attribution:** each displayed advert must carry an "Adzuna" label at least 116×23 px, linked to adzuna.co.uk.
  - Don't contact the advertisers' content providers.
  - On termination, delete all Adzuna data.
- **Keyless test:** `GET /v1/api/jobs/gb/search/1?what=apprenticeship` returns **HTTP 400** with an HTML error page [V]. A key is required. `api.adzuna.com/robots.txt` is `Disallow: /` [V]. That rule targets crawlers, not keyed API use.
- **adzuna.co.uk website:** CloudFront returned **403** to every request from this machine, including robots.txt [V]. Don't scrape the site; use the API.
- **Is it good for apprenticeships?** [U, needs a key to test] There is no apprenticeship `contract_type` or category, so you must match keywords. Suggested query: `title_only=apprentice apprenticeship` (or `what_phrase=apprenticeship`) + `what_or=data analyst analytics scientist science "machine learning" AI`, with `max_days_old=2` for daily deltas and `sort_by=date`. Expect noise ("Apprenticeship Coach", "Apprenticeship Assessor") and duplicates of FAA and Reed ads. One query a day plus a few pages fits easily within 250/day.
- **Verdict:** a useful secondary aggregator (it picks up employer careers-site ads), but it needs dedupe and noise filtering. Cheap to add.

### A2. Reed.co.uk Jobseeker API

- **Key:** https://www.reed.co.uk/developers/jobseeker has a "Register" button that calls `getApiKey`, so you need a free reed.co.uk account [V]. Index of developer APIs: https://www.reed.co.uk/developers [V].
- **Auth:** HTTP Basic, with **the API key as the username and an empty password** [D]. Without a key: `GET https://www.reed.co.uk/api/1.0/search?...` returns **401** with `www-authenticate: Basic` [V].
- **Endpoints** [D]:
  - `GET https://www.reed.co.uk/api/1.0/search?…`
  - `GET https://www.reed.co.uk/api/1.0/jobs/{jobId}` (full details).
- **Params** [D]: `keywords`, `locationName`, `distanceFromLocation` (miles, default 10), `employerId`, `employerProfileId`, `permanent`, `contract`, `temp`, `partTime`, `fullTime`, `minimumSalary`, `maximumSalary`, `postedByRecruitmentAgency`, `postedByDirectEmployer`, `graduate`, `resultsToTake` (**max 100**), `resultsToSkip`. The docs' own example URL uses different casing (`location=`), so test both. There is no date-posted filter, so you have to diff by `jobId` yourself.
- **Response** [D]:
  - Search returns jobId, employerId, employerName, jobTitle, description (snippet), locationName, min/max salary, plus date, expirationDate, jobUrl and applications [U: the last few are from memory].
  - The details endpoint adds salary type, contractType, jobType, expirationDate, externalUrl and the reed URL.
- **Rate limits:** **not documented** for the Jobseeker API [D: none on the page]. A search snippet cites "2,000 requests/hour" for the *Recruiter* API [U]. At one or two dozen calls a day, this doesn't matter.
- **Terms:** I couldn't find a scraping clause. The policies page (https://www.reed.co.uk/policies#termsConditions) loads the T&Cs tab dynamically and my text search found nothing [U]. robots.txt disallows `/api/` for all crawlers and `/jobs/*?*sortBy=` [V]. The key-based API is the sanctioned route.
- **Size check on the website, today** [V, server-rendered Next.js, 25 cards per page]:
  - https://www.reed.co.uk/jobs/data-apprenticeship-jobs: **478** jobs
  - `/jobs/data-analyst-apprenticeship-jobs`: **93**
  - `/jobs/apprenticeship-jobs`: **2,198**
  - The first page of "data apprenticeship" was mostly QA Ltd (a training provider) ads, plus noise such as "Data Apprenticeship Coach" and "AI Apprenticeship Coach" (adult jobs *about* apprenticeships).
- **Verdict:** a decent secondary source. The free key is easy to get. Filter out titles matching `coach|assessor|tutor|trainer|IQA|skills coach|lecturer`, and require `apprentic` in the title.

### A3. Jooble API

- **Key:** fill in the form at https://jooble.org/api/about (name, position, email, website, phone) [D]. The page doesn't say whether it's free or approval-based. Third-party guides say a free key arrives quickly [U]. ToS: https://jooble.org/info/terms [D, contents not read].
- **Endpoint:** `POST https://jooble.org/api/{API_KEY}` with a JSON body such as `{"keywords":"data analyst apprentice","location":"UK","page":1}` [U: from a third-party guide; the official page didn't render the code samples].
  - Other body fields I remember: `radius`, `salary`, `ResultOnPage`, `datecreatedfrom`, `companysearch` [U].
  - Response: `totalCount`, `jobs[]` (title, location, snippet, salary, source, type, link, company, updated, id) [U].
- **Probe:** a dummy-key POST got a Cloudflare **403** [V]. I couldn't tell a bad key from a bot block. The uk.jooble.org website also shows a Cloudflare "Just a moment" challenge [V].
- **Rate limits:** not published. Third parties say "usage limits set per key" [U].
- **Verdict:** a meta-aggregator of other boards (Reed, Totaljobs, FAA and others), so it mostly adds duplicates. Optional; lowest priority among the APIs.

### A4. Careerjet API (v4)

- **Key:** "Each publisher website requires a unique API key, which you can obtain from your Publisher account" (sign up at https://www.careerjet.co.uk/partners/register/as-publisher, which needs a login) [D/V].
- **Endpoint:** `GET https://search.api.careerjet.net/v4/query` with HTTP Basic auth (key as username, empty password) [D].
- **Params** [D]:
  - `locale_code` (default `en_GB`), `keywords`, `location`, `contract_type` (`p`/`c`/`t`/`i` internship-training/`v`), `work_hours` (`f`/`p`), `sort` (`relevance`/`date`/`salary`), `page` (1–10), `page_size` (1–100), `offset`, `radius`, `fragment_size`.
  - **`user_ip` and `user_agent` are required** ("of the user whose action(s) triggered the API call").
  - The curl example also sends a `Referer` (`-e`) of the publisher's search page [V].
- **Probes** [V]:
  - v4 without a key returns 401 `"You did not provide an API key…"`.
  - The legacy `public.api.careerjet.net/search` returns 403 `"Undeclared referrer. Please add a Referer header…"`.
- **Response** [D]: `{type:"JOBS", hits, pages, jobs:[{title, company, date, description, locations, salary, salary_min/max, salary_type, url}]}`. The `url` is a tracking redirect (`jobviewtrack.com`).
- **robots.txt (careerjet.co.uk)** [V]: disallows `/job/`, `/jobview/`, `/search/query.html`, `/search/rss.html` and the query params `p`, `sort`, `radius` and others.
- **Rate limits:** not documented [D].
- **Verdict:** built for publishers monetising live end-user traffic. A daily batch job with no real end user doesn't fit the `user_ip` requirement. **Skip.**

### A5. Indeed

- **Public API:** none any more.
  - The old Publisher Job Search API docs URL (`opensource.indeedeng.io/api-documentation/docs/job-search/`) now redirects to the engineering blog [V].
  - `developer.indeed.com` redirects to `partners.indeed.com` (employer and ATS partner integrations only) [V].
  - `ads.indeed.com/jobroll/xmlfeed` redirects to an employer page [V].
  - Third-party sources say it was shut to new publishers around 2023 [U on the exact date].
- **ToS** (https://uk.indeed.com/legal) [V, quoted]: you must not "Use any automated system (bots, scrapers, spiders, AI or Agentic AI) to access, data-mine, or submit content to the Site … without Indeed's express written permission (we conditionally grant permission to crawl the Site solely as outlined in our robots.txt file). You may not crawl, scrape, extract data from…"
- **robots.txt** [V]: the `User-agent: *` group allows `/` but disallows `/viewjob`, `/rc/`, `/m/viewjob`, `/*&start=` (beyond page 10), `/rss` and `/*?rss`.
- **Practical:** `https://uk.indeed.com/jobs?q=data+apprenticeship` returned **403 with `cf-mitigated: challenge`** ("Security Check") [V].
- **Verdict:** **avoid.**

### A6. LinkedIn

- **No public job-search API.**
  - The only jobs API is the **Job Posting API**, which ATSs and partners use to *post* jobs.
  - Its overview page (https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview) says: "We are currently not accepting new partnerships for LinkedIn's Job Posting API" [V].
  - Use is "restricted to those developers approved by LinkedIn … sign an API agreement" [V].
- **ToS:** the User Agreement (effective 3 Nov 2025), **§8.2 "Don'ts"**, says you will not "Develop, support or use software, devices, scripts, robots or any other means or processes (such as crawlers, browser plugins and add-ons or any other technology) to scrape or copy the Services…" [V, quoted]. It also forbids bypassing "use limits of the Services (such as search results…)".
- **robots.txt** [V]: header notice "The use of robots or other automated means to access LinkedIn without the express permission of LinkedIn is strictly prohibited", followed by `User-agent: *` / `Disallow: /`. Whitelisting is by email to whitelist-crawl@linkedin.com.
- **Verdict:** **avoid.** That includes the unofficial `jobs-guest` endpoints. The student can set LinkedIn job alerts manually.

### A7. Totaljobs (StepStone group)

- **API:** no public API found. `https://www.totaljobs.com/api` returns 404 and `developer.stepstone.com` returns 404 [V]. A web search found only third-party Apify scrapers [U].
- **ToS** (https://www.totaljobs.com/about/terms-and-conditions/) [V, quoted §1.1]: information is "for the sole purpose of individuals looking for employment … You may not otherwise copy, display, transmit or distribute any material from the site and if you do or if you perform any other unauthorised processing of information on the site it shall be deemed a material breach".
- **robots.txt** [V]:
  - The `User-agent: *` group mostly allows `/jobs/` and `/job/`. It disallows `/jobs*?page=*` except pages 2–5, `/job/*?`, filter params (`salary=`, `radius=`, `postedwithin=` and others), `/JobSearch/RSS.aspx` and `/search-results`.
  - The `Twitterbot` group is weirdly broad and should be ignored.
- **Rendering and size** [V]: server-rendered, 25 job links per page, with BreadcrumbList and FAQPage JSON-LD on listing pages. https://www.totaljobs.com/jobs/data-analyst-apprenticeship showed **37** jobs.
- **Verdict:** **avoid.** ToS forbids it, and most ads also appear on Reed, Adzuna or FAA.

### A8. CV-Library

- **API:** partner-only.
  - `https://www.cv-library.co.uk/search-jobs-json` returns HTTP 400 `{"error":"Must specify key"}` [V], so a key-gated JSON search endpoint exists.
  - A search snippet describes a **Job View API** (single job by ID, client-side use, "Access … is not provided as standard … contact our Partner team") at https://www.cv-library.co.uk/developers/job-view-api [U: page blocked].
- **Website:** Cloudflare **403** on `/developers`, `/apprenticeship-jobs` and the other pages tried [V].
- **robots.txt** [V]: `Allow: /` but `Disallow: /*?` (except `?jobId=` and `?page_number=`), plus `/api/` and `/candidate/`.
- **Verdict:** **avoid** (no self-serve API, bot-blocked).

---

## Part B: UK apprenticeship and early-careers sites

### B0. Find an apprenticeship (GOV.UK). Not on the original list, but it is the primary source

Full details are in `research/gov-api.md`. Key facts re-checked here:

- **Display Advert API v2.** Base URL `https://api.apprenticeships.education.gov.uk/vacancies`, headers `Ocp-Apim-Subscription-Key` and `X-Version: 2` [V: spec].
  - Free self-registration: https://developer.apprenticeships.education.gov.uk/third-party-accounts/register [V: 200].
  - **150 requests per 5 minutes** [D].
  - The spec explicitly recommends polling and storing locally [V].
- **Filters** [V spec]: `StandardLarsCode` (array), `Routes` (max 2), `Lat`/`Lon`/`DistanceInMiles`, `PostedInLastNumberOfDays`, `Sort` (`AgeDesc`…), `ExcludeRecruitingNationally`, `PageSize` (≤100), `IncludeDetails`.
  - Header `AdditionalDataSources` takes the enum values **`Nhs`, `Csj`**. That presumably pulls in NHS Jobs and Civil Service Jobs apprenticeships [U on behaviour].
- **Relevant LARS codes** (Skills England API, https://skillsengland.education.gov.uk/api/apprenticeshipstandards) [V]:

  | LARS code | Standard | Level |
  |---|---|---|
  | 576 | Data technician | L3 |
  | 80 | Data analyst | L4 |
  | 828 | AI and automation practitioner | L4 |
  | 165 | Business analyst | L4 |
  | 746 | Data engineer | L5 |
  | 337 | Data scientist (integrated degree) | L6 |
  | 795 | Machine learning engineer | L6 |
  | 25 | Digital and technology solutions professional (integrated degree, has a data analyst option) | L6 |
  | 327 | DTS specialist | L7 |
  | 561 | AI data specialist (renaming to "AI technologist") | L7 |
  | 669 | Medical statistician | L7 |

- **Website check today** [V, server-rendered GOV.UK HTML, no JSON-LD]:
  - Whole of England: **3,881** vacancies.
  - Keyword searches: `searchTerm=data` 31, "data analyst" 4, "data scientist" 1, "AI" 28, "artificial intelligence" 7, "machine learning" 3.
  - Digital route (`routeIds=7`): 129. Digital + level 6: **10**. Seven of those are Thales 2027 AI Engineer, AI Researcher, Data Science and Software Engineering degree apprenticeships.
- **Lesson:** FAA keyword search matches only title and employer, so "data" missed "AI Engineer Apprentice" (course: Machine learning engineer L6). **Filter by LARS code or route, not keyword.**
- **Coverage gap:** searches for "Financial Conduct Authority" and "Airbus" returned **0** on FAA, but both have live data/AI or digital degree apprenticeships on Higherin. That is why Higherin matters.

### B1. UCAS apprenticeship search (Career Finder → "Explore")

- **Where:**
  - `careerfinder.ucas.com` now redirects to https://www.ucas.com/explore/search/apprenticeships [V].
  - The UCAS Hub dashboard is at `digital.ucas.com/search/dashboard` and needs a login [V link only].
- **API / RSS / sitemap / JSON-LD:** no public API. The search UI is built on **Algolia InstantSearch**: the page references `ALGOLIA_INSIGHTS_SRC` and uses `refinementList[...]` URL params [V]. `/sites/default/files/sitemap.xml` is disallowed in robots.txt.
- **Rendering:** the client-side JS search sits behind **Cloudflare managed challenge**. `/explore/search/apprenticeships?query=data` returned **403, `cf-mitigated: challenge`** ("Managed Challenge / I'm Under Attack Mode") to both curl and WebFetch [V]. Getting through would need Playwright *and* a challenge solve.
- **robots.txt** (https://www.ucas.com/robots.txt) [V]: `Crawl-delay: 10`, and `Disallow: /search/`. `/explore/search/` is not explicitly disallowed.
- **ToS** ("terms-and-conditions-for-use-of-the-ucas-network") [V, §4.1]: "you must not: 4.1.1 decrypt, **extract**, disassemble, reverse-engineer or decompile the Website … 4.1.3 include any portion of the Website in any other software program … 4.1.5 create any modifications or derivative works".
- **Count of "data" results:** not visible [U]. UCAS apprenticeship listings are largely syndicated from employers and FAA [U].
- **Verdict:** **avoid.** The student should use UCAS directly; it's also where degree-apprenticeship applications sometimes route.

### B2. RateMyApprenticeship, now **Higherin** (https://higherin.com)

- **Rebrand:** `www.ratemyapprenticeship.co.uk/*` returns a **301 to https://higherin.com/** [V]. The site is the RateMyPlacement and RateMyApprenticeship merger (window vars are still prefixed `__RMP_`).
- **Sitemap** [V]:
  - Index: https://higherin.com/sitemaps/sitemap-index.xml. It lists `job-sitemap-index.xml` → `https://cdn-production.higherin.com/sitemaps/job-sitemap-1.xml`, which had **2,206 job URLs** (lastmod 2026-10-08).
  - **464** of those have "apprentice" in the slug, and about **76** of those also match data/AI/digital/tech/analyst words.
  - There is also a `search-sitemap` of 5,802 category landing pages, such as `/search-jobs/degree-apprenticeship/data-analysis`.
- **JSON-LD:** every job page (e.g. https://higherin.com/jobs/45840/thales/level-6-data-science-degree-apprenticeship) has a full **schema.org `JobPosting`** with `title`, `description` (HTML), `datePosted`, `validThrough` (the deadline), `employmentType`, `hiringOrganization`, `baseSalary` (e.g. GBP 24,000/YEAR) and `jobLocation` [V].
- **Search pages:** a Vue front-end, but the **results are embedded as JSON in the HTML** as `window.__RMP_SEARCH_RESULTS_INITIAL_STATE__ = {data:[…], meta:{totalResults, pagination, aggregations}}` [V]. **No Playwright needed.**
  - Per-item fields: `jobId`, `jobTitle`, `jobTypeName` (e.g. "Degree Apprenticeship"), `deadline`, `url`, `salary`, `jobLocationNames`, `companyName`, `isPreReg` and others.
  - 20 per page.
- **Counts today** [V]:

  | Search | Results |
  |---|---|
  | `/search-jobs/apprenticeships` (all) | **408** |
  | `/search-jobs/degree-apprenticeship` | **114** |
  | `/search-jobs/degree-apprenticeship/data-analysis` | **13** |
  | `/search-jobs/higher-level-apprenticeship/data-analysis` | **14** |
  | `/search-jobs/level-3-apprenticeship/data-analysis` | **11** |
  | `/search-jobs/degree-apprenticeship/artificial-intelligence` | **10** (Thales Data Science / AI Engineer / AI & Data Science, FCA L6 AI/ML) |

- **robots.txt** (https://higherin.com/robots.txt) [V]:
  - Disallows `/ajax/`, `/api/`, `/redirect`, and `/search-jobs*` URLs with `company=`, `sort-by=`, **`search-term=`**, `lat=` or commas.
  - **Path-based category pages and `/jobs/…` detail pages are allowed.**
  - It blocks only Baiduspider and ShapBot entirely.
- **ToS** (https://higherin.com/terms-and-conditions) [V]: mostly about reviews. **No scraping, crawling or copying clause found.**
- **Approach:**
  1. Daily: fetch the job sitemap (one request) and diff URLs.
  2. Fetch only *new* job pages whose slug matches `apprentice` and parse the JSON-LD (around 5–20 pages a day).
  3. Optionally also fetch the 3–4 category pages above for `totalResults` sanity checks.
- **Verdict: primary.** It carries big-employer degree apprenticeships (Thales, FCA, Airbus, NBCUniversal and others) with deadlines, and the structured data is clean.

### B3. Not Going To Uni (https://notgoingtouni.co.uk)

- **API / RSS:** none public. Images and data are served from `api.notgoingtouni.co.uk`, which is undocumented [V].
- **Sitemap** [V]:
  - Index https://notgoingtouni.co.uk/sitemap.xml (lastmod 2026-09-27).
  - `sitemap/job-occupation.xml` has **370** `/{provider}/opportunity-detail/{slug}-{id}` URLs, but it lags (highest ID 12,770, while live ads reach 12,865).
  - There are also sector, type, county and town listing sitemaps.
- **JSON-LD:** opportunity pages have a schema.org **`JobPosting`** (title, description, datePosted, employmentType, hiringOrganization, identifier such as `teamtailor-…`) [V].
- **Rendering:** Next.js App Router (turbopack chunks). Listing pages carry the first page of results inside the RSC flight payload (`self.__next_f.push`), so slugs are regex-extractable from raw HTML, but not as plain `<a>` tags [V]. Pagination or totals beyond page 1 probably need JS or Playwright [U].
  - Search URL template (from the SearchAction JSON-LD): `https://notgoingtouni.co.uk/opportunities/filter_by/query/{term}` [V].
- **Counts today** [V]:
  - `query/data`: 15 opportunity slugs, mostly QA Ltd (Data Analyst, Data Engineer, Data Administrator) plus a Uxbridge College L4 Data Centre course.
  - `query/data analyst`: 6.
  - `sector/it-technology`: 24 on page 1.
- **robots.txt** [V]: `Allow: /`. It disallows only account, login and register pages.
- **ToS** (https://notgoingtouni.co.uk/terms-of-use) [V]: standard copyright clause ("copyright … in all material on the Website … owned by us or our licensors"). **No explicit scraping ban found.**
- **Verdict:** secondary or optional. Many ads are from QA Ltd and also appear on FAA, Reed and Higherin. If used, call `query/data` once a day and parse the JobPosting on new detail pages.

### B4. Amazing Apprenticeships "Vacancy Snapshot" and Higher & Degree Listing

- **What exists** [V], per https://www.amazingapprenticeships.com/promote-your-vacancies/:
  - **"Vacancy Snapshot Newsletter":** a *monthly email* to aspiring apprentices. There is no web or RSS archive of it, and subscribing is the only route.
  - **"Higher & Degree Vacancy Listing":** a **PDF** made "three times this academic year (October, January and April)" on behalf of the Careers & Enterprise Company.
- **Current file:**
  - Resource page: https://www.amazingapprenticeships.com/resources/higher-and-degree-listing/
  - PDF: https://www.amazingapprenticeships.com/wp-content/uploads/2026/04/April-HD-Listing-2026-MASTER-1.pdf [V: 200, 795 KB, 27 pages, exported from PowerPoint]
  - It has **65 vacancy entries**. The landing page claims "950+ vacancies" (it counts positions) from 35+ employers.
- **Next edition:** the landing page (https://www.amazingapprenticeships.com/higher-degree-listing/) says **"New Higher & Degree edition coming 13th October 2026"** [V]. That's four days away.
- **Format:** `pdftotext -layout` gives a parsable block per vacancy [V]: employer, Role, Level, Location(s), Applications open/close, Start Date, Starting salary, and a short link (`amapps.uk/…`). Sections follow FAA route names, so look at "Digital". In the April edition the Digital section was a single page (page 11: Neptune North, "Degree Apprentice (DevOps)" and "(SRE)"). It had no data or AI roles. "Data Analyst L4" appeared only under the British Army.
- **API / sitemap / JSON-LD:** none for vacancies. It's a WordPress site with Yoast `sitemap_index.xml` (post, page, category and local sitemaps) [V].
- **robots.txt** [V]: malformed. It's just `Disallow: /officially-amazing/best-practice/` with no User-agent line, so it effectively allows everything.
- **Verdict:** supplementary. Check the resource page weekly for a new `wp-content/uploads/…pdf` link, parse it, keep the Digital section plus keyword hits, and resolve the `amapps.uk` short links. The October edition is aimed exactly at Year 13s applying for 2027 starts.

### B5. Springpod (https://www.springpod.com)

- **Sitemap** [V]: `sitemap.xml` → `opportunities.xml` with only **50** URLs (`/opportunities/OP-00092…OP-00141`, lastmod 2026-10-07). Most of the site is virtual work experience and uni taster courses.
- **Rendering:** Next.js pages router. Each opportunity page embeds `__NEXT_DATA__` with the full item: title, type (e.g. "Apprenticeship"), description HTML, `applicationUrl`, city, partner org and createdAt. There's no JSON-LD [V].
  - **However, the UI gates the details** ("You need a Springpod account … to view more about this Barclays opportunity") [V].
  - Pulling data the UI deliberately hides is ethically grey. Don't.
- **robots.txt** [V]: `User-agent: *` / `Disallow:` (everything allowed).
- **ToS** (https://springpod-support.frontkb.com/en/articles/1173442, edited 11 Aug 2026) [V]: no scraping clause found.
- **Count:** the sitemap total is 50 opportunities of all types. The example on OP-00141 was Barclays' 2027 Technology Developer Graduate Apprenticeship in Glasgow (Scottish GA). The data-specific count wasn't determined [U].
- **Verdict:** **avoid** for scraping (tiny, gated). It's still worth the student having an account for its virtual work experience.

### B6. Gradcracker (https://www.gradcracker.com)

- **robots.txt** (fetched OK) [V]:
  - `Allow: /`
  - Disallows `/out`, `/campaign`, `/download`, `/keyword-search`, and `/search/*?order=` / `&order=`
  - `Sitemap: https://www.gradcracker.com/sitemap.xml`
- **Everything else is blocked:** the homepage, the sitemap and `/search/computing-technology/degree-apprenticeships` all return **403 Cloudflare "Just a moment…"** challenges to curl and WebFetch [V]. API, RSS, JSON-LD, rendering, ToS and counts are all **[U]**.
- **Verdict:** **avoid** for automation. It's STEM-focused and has a degree-apprenticeship section, so the student could browse it manually or use its email alerts.

### B7. Bright Network (https://www.brightnetwork.co.uk)

- **Everything blocked:** every URL, *including robots.txt and sitemap.xml*, returns **403 `cf-mitigated: challenge`** ("Just a moment…") [V]. WebFetch was blocked too.
- API, RSS, JSON-LD, ToS and counts are all **[U]**. It's graduate- and internship-heavy, with a smaller school-leaver section [U].
- **Verdict:** **avoid.**

### B8. Get My First Job (https://www.getmyfirstjob.co.uk)

- **Sitemap** [V]: https://www.getmyfirstjob.co.uk/sitemap.xml → `sitemap-vacancies-1.xml` with **5,564** `/opportunity/{uuid-or-prefixed-id}` URLs (lastmods 2026-09-24 to 10-08).
- **Rendering:** **server-rendered HTML** search at `https://www.getmyfirstjob.co.uk/search?query=data`. Form fields: `query`, `location`, `lat`, `lng`, `radius`, `sort` (`relevance`/`closing`/`newest`/`wage-high`/`wage-low`) [V]. There's no JSON-LD on vacancy pages [V].
- **Source of the listings:** links on the "data" results page were **`/opportunity/faa-VAC2000057378`** (11 of 13) and one **`/opportunity/scrape-…`** [V]. **GMFJ mostly mirrors FAA and scrapes employer sites.**
- **Counts today** [V]: "data" gives 2 pages (Data Analyst, Data Technician and Data Admin apprentices), "data scientist" 0, "artificial intelligence" 0, "machine learning" 1 (a "2027 Machine Learning Apprentice – Level 6 AI Engineer", i.e. the Thales FAA ad).
- **robots.txt** [V]: `Allow: /`. It disallows `/account`, `/apply/`, `/track/`, `/out/`, `/promo/` and `/embed/`.
- **ToS** (https://www.getmyfirstjob.co.uk/terms-of-use) [V]: "You may print off one copy, and may download extracts, of any page(s) from our site for your personal use…". There's no explicit scraping clause.
- **Verdict:** **skip.** It's redundant with the FAA API.

### B9. TARGETjobs (and the old TARGETcareers)

- **Apprenticeship sections are gone:**
  - https://targetcareers.co.uk/ and https://targetapprenticeships.co.uk/ both **redirect to `targetjobs.co.uk/careers-advice/advice-for-school-leavers`**, an advice article [V].
  - TARGETjobs itself lists `/graduate-jobs/*` and `/internships/*` only. `/apprenticeships`, `/jobs/apprenticeships` and `/search/apprenticeships` return 404 [V].
- **Rendering:** Gatsby 5. Job cards are not in the HTML of `/graduate-jobs/it` (0 job links), so they load client-side. The page has BreadcrumbList and FAQPage JSON-LD only [V].
- **robots.txt** [V]: `User-agent: * Allow: /`. Its sitemap URL (`/sitemap/sitemap-index.xml`) returns **404**.
- **ToS:** [U] (not checked, since the site is irrelevant).
- **Verdict:** **avoid.** No school-leaver vacancies.

### B10. Prospects (https://www.prospects.ac.uk)

- **Search:** `https://www.prospects.ac.uk/graduate-jobs-results?keyword=…`. It's **AngularJS (`ng-app`), client-rendered**, and the HTML had 0 job links [V]. No public API endpoint was found in `main.js`. There's no job sitemap: the sitemap index → `newContentSitemap-pages.xml` (×4) holds 1,579 content and advice URLs, with no vacancies [V].
- **Apprenticeships:** advice pages only (`/jobs-and-work-experience/apprenticeships/…`). Its degree-apprenticeship page links to a keyword search for "degree apprenticeship" in graduate jobs [V].
- **robots.txt** [V]: disallows only `/redirect/`, `/apply?id=*` and `/partials/`.
- **ToS** (https://www.prospects.ac.uk/terms-of-use/) [V, quoted]: "You may not copy or distribute any of the content on this site for commercial gain … for your own personal, non-commercial use … **Changing the pages or using the content in any other product without consent will be considered a breach of our copyright**".
- **Count:** not visible without JS [U].
- **Verdict:** **avoid.** It's graduate-focused, JS-only, and the ToS blocks reuse.

### B11. Civil Service Jobs (https://www.civilservicejobs.service.gov.uk)

- **robots.txt** [V]: `User-agent: * Allow: /` (only JoobleBot is disallowed).
- **But:** the very first request to `/csr/index.cgi` gets a **"Quick Check Needed – We just need to confirm you're a real person"** page with an **ALTCHA** proof-of-work CAPTCHA and `<meta name="robots" content="noindex">` [V].
- **RSS / API / JSON-LD:** **[U]** (blocked behind the CAPTCHA). The search is session-based (`SID` URLs) [U].
- **Better route:** the FAA Display Advert API `AdditionalDataSources: Csj` header [V: enum in spec; U: behaviour]. Civil Service apprenticeships (e.g. Government Digital and Data apprenticeship schemes) are normally also listed on FAA [U].
- **Verdict:** **don't scrape.** Use the FAA API.

### B12. NHS Jobs (https://www.jobs.nhs.uk)

- **robots.txt:** **none.** `/robots.txt` returns 200 with an HTML "Service Domain Information – page no longer active" page [V].
- **Public XML endpoint (undocumented, keyless)** [V]: `https://www.jobs.nhs.uk/api/v1/search_xml?keyword=…&contractType=Apprenticeship&location=…&distance=…&page=N`
  - Returns `<nhsJobs><vacancyDetails>` with id, reference, title, description (snippet), employer, type, salary, closeDate, postDate, url and locations, plus `<totalResults>` and `<totalPages>`. 10 per page.
  - The JSON sibling `/api/v1/search` returns 403 [V].
- **Website search:** server-rendered at `/candidate/search/results?keyword=…&contractType=Apprenticeship`. There's no JSON-LD [V]. Filter names: `contractType` (Apprenticeship, Permanent, Fixed-Term …), `payBand`, `payRange`, `distance`, `location`, `employer` [V].
- **Counts today** [V]:
  - `contractType=Apprenticeship`: **24** apprenticeships across all of NHS Jobs.
  - Plus `keyword=data`: **7**, and those were mostly business admin apprentices.
  - Plus London within 20 miles: 3.
  - Watch out: a bare `keyword=data apprentice` returns 3,347 results because terms are OR-matched.
- **ToS** (acceptable use, https://www.jobs.nhs.uk/candidate/acceptable-use) [V, quoted]: "You may print and download extracts from NHS Jobs for personal non-commercial use … you agree not to: use the NHS Jobs for commercial purposes without obtaining our prior written agreement; or copy, reproduce, distribute, republish…"
- **Verdict:** optional and low-yield (around 0–3 data-relevant ads). Prefer the FAA API `Nhs` source. If used directly: one call a day, `contractType=Apprenticeship`, then filter titles locally. It's fine for a personal, non-commercial tool.

---

## Part C: Recommended ranked sources

### Primary (build these first)

1. **Find an apprenticeship: Display Advert API v2.**
   - Official, free and explicitly meant to be polled and cached. It covers essentially all England apprenticeships (3,881 live today).
   - Query by `StandardLarsCode` = 576, 80, 828, 746, 337, 795, 25, 327, 561 (plus 165 and 2 optionally), with `PostedInLastNumberOfDays=2`, `PageSize=100`, `IncludeDetails=true`, and header `AdditionalDataSources: Nhs,Csj`.
   - Daily needs are about 5–15 requests against a limit of 150 per 5 minutes.
   - Filtering by LARS beats keywords: keyword "data" missed the Thales AI and ML L6 ads.
2. **Higherin (ex-RateMyApprenticeship).** One job-sitemap fetch a day, a diff, then JSON-LD `JobPosting` from new `/jobs/…apprentic…` pages, plus 3–4 allowed category pages (`/search-jobs/{degree|higher-level|level-3}-apprenticeship/data-analysis`, `/search-jobs/degree-apprenticeship/artificial-intelligence`).
   - It has unique big-employer degree apprenticeships that aren't on FAA (FCA, Airbus).
   - robots.txt allows these paths and the ToS has no scraping ban. Plain HTTP is enough; no Playwright.

### Secondary (cheap to add, needs dedupe and noise filtering)

3. **Reed API.** A free key, about 2–4 calls a day (`keywords="data apprentice"`, `"AI apprentice"`, `"degree apprenticeship"`, `resultsToTake=100`). Filter out coach, assessor and tutor roles.
4. **Adzuna API.** A free key and 250 calls a day. Use `title_only=apprentice` + `what_or=data analyst analytics scientist "machine learning" AI` + `max_days_old=2`. Display the "Adzuna" attribution in the UI. Its usefulness for apprenticeships is [U] until tested with a key.
5. **Amazing Apprenticeships Higher & Degree PDF.** Poll the resource page weekly. Edition 3 a year, **next on 13 Oct 2026**. Parse with `pdftotext -layout`.
6. **Not Going To Uni.** Optional. One `query/data` page a day, then JobPosting JSON-LD on new detail pages. Expect heavy overlap with FAA and Reed (QA Ltd ads).
7. **NHS Jobs XML.** Optional and only if the FAA `Nhs` source turns out not to work. One call a day with `contractType=Apprenticeship`.

### Avoid

- **LinkedIn and Indeed:** explicit ToS bans on bots and scrapers. Indeed also has a Cloudflare challenge, LinkedIn's robots.txt is `Disallow: /`, and neither has a public search API.
- **Totaljobs:** ToS forbids copying and "unauthorised processing". No API.
- **CV-Library:** partner-only API, Cloudflare 403.
- **UCAS:** Cloudflare managed challenge, Algolia client-side search, and a ToS "must not … extract" clause.
- **Gradcracker and Bright Network:** Cloudflare challenge on every page (Bright Network even on robots.txt). The student can use them manually with alerts.
- **Civil Service Jobs:** CAPTCHA. Use FAA `Csj` instead.
- **Prospects:** JS-only, graduate-focused, and the ToS bars "using the content in any other product".
- **TARGETjobs:** no apprenticeship vacancies any more.
- **Springpod:** only 50 opportunities, details gated behind login.
- **Get My First Job:** an FAA mirror, so it adds nothing over the API.
- **Careerjet and Jooble:** publisher-oriented, mostly duplicates. Careerjet requires an end-user IP, UA and Referer.

---

## Part D: Implementation notes for a polite daily scraper

- **User-Agent:** send an honest one with contact details, e.g. `apprenticeship-finder/0.1 (+https://github.com/<user>/apprenticeship-finder; personal, non-commercial)`. Respect robots.txt with `urllib.robotparser`. Sleep 2–5 s between HTML requests, and honour UCAS's `Crawl-delay: 10` if you ever touch it (you shouldn't).
- **GitHub Actions caveat:** runners use Azure datacenter IPs. Cloudflare and CloudFront-fronted sites (Adzuna web, Gradcracker, Bright Network, Indeed, CV-Library, Jooble web, UCAS) already blocked this machine's IP, so expect the same or worse from Actions. The recommended primary and secondary sources are all APIs or sites that served plain HTTP fine.
- **Dedupe key:** normalised `(employer, title, closing date)`, plus FAA `VAC…` references where present (Get My First Job uses `faa-VAC…`, and Higherin and FAA both carry the Thales ads).
- **Noise filter:** require `apprentic` in the title. Drop `coach|assessor|tutor|trainer|lecturer|IQA|internal quality|recruiter`. Classify level from the FAA `course.level` field or title regex (`level [2-7]`, `degree`, `higher`).
- **Secrets:** keep API keys in GitHub Actions secrets or environment variables, never in the repo. The FAA hub explicitly asks for this.
- **Attribution:** Adzuna requires an "Adzuna" label linked to adzuna.co.uk on displayed ads. Show the source and link back on every listing anyway.

---

## Unverified or open items

1. Adzuna: real-world precision of `title_only=apprentice` queries, the `results_per_page` max (believed to be 50), and whether a UK "apprenticeship" category exists (`/categories` needs a key).
2. Reed: Jobseeker API rate limits, the exact ToS scraping clause, and whether `locationName` or `location` is accepted.
3. Jooble: endpoint body fields beyond `keywords`/`location`, cost, limits, and ToS content.
4. FAA `AdditionalDataSources: Nhs,Csj`: actual behaviour (needs a key).
5. Gradcracker, Bright Network, UCAS, CV-Library, Civil Service Jobs: content, counts and ToS couldn't be fetched (bot walls).
6. NHS Jobs `search_xml`: undocumented, so it could change or disappear without notice.
7. Not Going To Uni: how to get results beyond the first page of a listing without JS.
8. The web-search budget for this session ran out partway through, so third-party corroboration (e.g. Indeed's API shutdown date) is thinner than ideal. All core claims above come from direct fetches.

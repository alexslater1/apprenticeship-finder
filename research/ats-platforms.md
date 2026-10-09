# ATS platforms: how to fetch open jobs without auth

Research date: **2026-10-09**. Every "Verified" claim below comes from a live `curl` request made that day. Anything not tested live is marked **UNVERIFIED**.

Purpose: a daily scraper covering about 100–150 UK employers, looking for data-science and data-analyst apprenticeships. Most large employers host their jobs on an ATS (applicant tracking system), so the approach is: detect the ATS from the careers URL, then call that ATS's public JSON/XML/RSS endpoint, or parse its server-rendered HTML.

---

## 0. Cross-cutting findings (read first)

1. **Search is fuzzy everywhere, so filter locally.** Searching Workday for `"data"` at Barclays matched 615 of 781 jobs. Oracle's `keyword=data` matched 538 of 692 UK jobs at JPMorgan. JPMorgan's `keyword=apprentice` matched 0, even though apprenticeships exist elsewhere. Recommended approach: pull **all UK jobs** for each employer (or the server-side "Apprentice" facet where one exists), then apply your own regex locally:
   `/(apprentic|degree apprenticeship|higher apprenticeship|level [3-7])/i` AND `/(data|analyst|analytics|science|machine learning|\bAI\b|insight)/i`.
   Real match found today: *Barclays "2027 Technology Analyst AI and Data Science Graduate Apprenticeship Programme Glasgow"* (Workday, closes 2026-11-01).
2. **Some sites report "no jobs" when they mean "wrong ID".** SmartRecruiters returns `200 {totalFound:0}` for a non-existent company, and Eightfold returns `count:0` for a wrong `domain`. Store a "last non-zero count" per employer and alert if it drops to 0.
3. **Posted dates come in many formats.** Workday list = `"Posted 2 Days Ago"` / `"Posted 30+ Days Ago"` (relative; the detail call gives ISO `startDate`). Cornerstone = `"10/6/2026"` (M/D/YYYY). SuccessFactors microdata = `"Fri Oct 09 02:01:00 UTC 2026"`. Lever = epoch ms. Eightfold = epoch seconds. Recruitee = `"2026-10-01 13:40:19 UTC"`. Normalise everything to ISO-8601 in one function.
4. **The best dedupe key is the ATS job ID**, not the URL: Workday's `externalPath` contains the `_JR-…` req ID, and Oleeo URLs contain a session hash that changes on every request.
5. **Politeness.** At 150 employers a day, a few hundred requests total, you are far below any rate limit. Run requests in series per host with a 1 s gap, or 10 s where robots.txt sets `Crawl-delay: 10` (Oleeo, Cornerstone). Use an honest User-Agent such as `ApprenticeshipFinder/0.1 (+contact URL)`. In testing, Workday, Greenhouse, Lever, Ashby and Personio all worked from plain `curl` with no browser UA.
6. **robots.txt notes**: SmartRecruiters' API host has `Disallow: /` for `*`. Oleeo `tal.net` blocks `ClaudeBot`/`GPTBot` and sets `Crawl-delay: 10`. SuccessFactors disallows `/services/` (so not its RSS feed). Several hosts send `Content-Signal: ai-train=no` (Teamtailor, Workable). That signal is about training AI models, not job-alert scraping. Details are in each section.
7. **Wrapper sites.** Phenom, Radancy/TMP and similar "talent experience" layers often sit in front of a real ATS. GSK's Phenom site links to `gsk.wd5.myworkdayjobs.com`. When the wrapper is hard to parse, follow an `applyUrl` to find the underlying ATS and use that instead.

---

## 1. Workday (`myworkdayjobs.com`)

**Verified with:** Barclays (UK), `barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays`, 781 jobs, 19 with the "Apprentice" job type. AstraZeneca and GSK also returned 200.

**How to recognise it**
- `https://{tenant}.wd{N}.myworkdayjobs.com/{locale?}/{site}` (e.g. `/en-US/External_Career_Site_Barclays`)
- `https://wd{N}.myworkdaysite.com/recruiting/{tenant}/{site}`. The same CXS API also works on this host (verified).
- Job URL: `/{site}/job/{location-slug}/{title-slug}_{ReqId}`
- `tenant` = subdomain; `site` = first path segment after an optional locale like `en-US`/`en-GB`.

**List request**
```http
POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
Content-Type: application/json
Accept: application/json

{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}
```
- **`limit` max = 20.** `21` and `50` both return **HTTP 400** (verified).
- Pagination: `offset += 20` until `jobPostings` is empty or `offset >= total`. Barclays returned `total` on every page (offset 760 → total 781). Some tenants are reported to return `total: 0` after page 1, so keep the first page's total. That report is **UNVERIFIED**.
- A wrong `site` name gives **HTTP 422** (seen with `hsbc/external`, `bp/bpCareers`). Copy the site name exactly from the careers URL.
- `searchText` is fuzzy (see §0).
- Server-side filtering uses `appliedFacets`, built from the `facets` array returned by any list call. Barclays example: `{"appliedFacets":{"workerSubType":["6139d325cdcc1001a72ceac9adfe0000"]}}` → exactly the 19 apprenticeships (verified). Facet IDs are tenant-specific. Common `facetParameter`s are `workerSubType` (Job Type: Apprentice/Graduate/Intern), `jobFamilyGroup`, `timeType`, and `locations`/`locationCountry` (nested under `locationMainGroup` at Barclays).

**List response**
```jsonc
{ "total": 781, "facets": [...], "userAuthenticated": false,
  "jobPostings": [{
    "title": "2027 Risk Analyst Higher Apprenticeship Programme Northampton",
    "externalPath": "/job/Northampton-Barclays-Campus-Pavilion-Drive/XMLNAME-2027-..._JR-0000129125",
    "locationsText": "Northampton, Barclays Campus, Pavilion Drive",   // or "2 Locations"
    "postedOn": "Posted 2 Days Ago",                                   // relative!
    "timeType": "Full time",
    "bulletFields": ["JR-0000129125"] }] }
```

**Detail request**: `GET https://{host}/wday/cxs/{tenant}/{site}{externalPath}` (Accept: application/json)
→ `jobPostingInfo.{title, jobDescription (HTML), location, additionalLocations[], postedOn, startDate ("2026-09-25" = posting date), endDate ("2026-11-01" = closing date), timeLeftToApply, jobReqId, externalUrl, country.descriptor, jobRequisitionLocation.country.alpha2Code}`, plus `hiringOrganization` and `similarJobs`.
Use the detail call whenever `locationsText` reads "N Locations", or when you need an exact date.

**Job URL:** `https://{tenant}.wd{N}.myworkdayjobs.com/{site}{externalPath}` (equals `jobPostingInfo.externalUrl`).

**Rendering:** the careers UI is a JS app, but the API is plain JSON, so no headless browser is needed. Job-detail HTML also contains server-rendered JSON-LD `JobPosting` with `datePosted` (verified).

**Sitemap:** `https://{host}/{site}/siteMap.xml` (linked from robots.txt). It returned 781 job URLs with no `<lastmod>` (verified). `/sitemap.xml` at the root returns 404.

**robots/ToS:** `Allow: /{site}/`, `Disallow: /Private/`, `Disallow: /refreshFacet/`. `/wday/cxs/` is not mentioned. CXS is Workday's undocumented internal API. It is very widely used by scrapers, but the shape could change without notice.

---

## 2. Greenhouse

**Verified with:** Monzo (UK, 68 jobs) and TrueLayer (UK, on an **EU-hosted** board).

**How to recognise it:** `boards.greenhouse.io/{token}`, `job-boards.greenhouse.io/{token}`, `job-boards.eu.greenhouse.io/{token}`, `boards.eu.greenhouse.io`, embed `boards.greenhouse.io/embed/job_board?for={token}`, a `?gh_jid=` query parameter on custom careers pages, or `grnh.se` short links.

**List request:** `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`
- **No pagination.** Every job comes back in one response, with `meta.total`.
- **EU boards use the same host.** `boards-api.greenhouse.io` served TrueLayer's EU board. `boards-api.eu.greenhouse.io` does **not resolve** (verified).
- An unknown token returns `404 {"status":404,"error":"Job not found"}`.

**Key fields:** `id`, `title`, `absolute_url`, `location.name` (free text, e.g. "Cardiff, London or Remote (UK)"), `first_published` (ISO), `updated_at`, `requisition_id`, `departments[]`, `offices[]`, `application_deadline`, `company_name`, `content`. `content` is **HTML-entity-escaped HTML**, so decode it twice.

**Detail request:** `GET /v1/boards/{token}/jobs/{id}?questions=false`. Board metadata: `GET /v1/boards/{token}`.

**Rendering:** JSON. **robots:** `boards-api` disallows only `/embed/`. This is Greenhouse's documented public Job Board API.

---

## 3. Lever (US and EU instances)

**Verified with:** Zopa (UK, 34 jobs, London/Manchester) and Matillion (UK). **The EU instance was NOT verified against a live company:** more than 100 EU/UK slugs all returned 404 on `api.eu.lever.co`. The host is live (it returns the same `{"ok":false,"error":"Document not found"}` JSON), and Lever documents it.

**How to recognise it:** `jobs.lever.co/{company}[/{uuid}]` → US API. `jobs.eu.lever.co/{company}` → EU API.

**List request:** `GET https://api.lever.co/v0/postings/{company}?mode=json`, or `https://api.eu.lever.co/v0/postings/{company}?mode=json` for EU boards.
- Without `limit`, it returns all postings. Pagination with `skip` and `limit` works (verified).
- Filters: `location=` (verified: Manchester → 4), plus `team=`, `department=`, `commitment=`, `level=`. `group=team` returns grouped output.
- Unknown company → `404 {"ok":false,"error":"Document not found"}`.

**Key fields:** `id`, `text` (title), `categories.{location, team, department, commitment, allLocations[]}`, `country` (ISO-2, e.g. "GB"), `workplaceType`, `createdAt` (**epoch ms**), `hostedUrl`, `applyUrl`, `descriptionPlain`/`description`, `lists[]`, `additionalPlain`.

**Detail request:** `GET /v0/postings/{company}/{id}?mode=json`.

**Rendering:** JSON. **robots:** `Allow: /`, `Crawl-delay: 1` (api and jobs hosts). This is a documented public API.

---

## 4. Ashby

**Verified with:** Multiverse (UK, 26 jobs). Synthesia, Wayve, Deliveroo, Lendable, Marshmallow, Zego and Paddle also returned 200.

**How to recognise it:** `jobs.ashbyhq.com/{org}[/{uuid}]`, or an `ashby_jid=` parameter on custom careers pages.

**List request:** `GET https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true`. **No pagination.** Unknown org → `404 Not Found`.

**Key fields:** `jobs[].{id, title, department, team, employmentType, location, secondaryLocations[], address.postalAddress.{addressCountry, addressLocality, addressRegion}, isRemote, workplaceType, publishedAt (ISO), jobUrl, applyUrl, descriptionHtml, descriptionPlain, isListed, compensation}`. `addressCountry` is inconsistent ("UK" at Multiverse), so normalise it.

**Rendering:** JSON. **robots:** `jobs.ashbyhq.com` has `Disallow: /api/`. That covers the internal GraphQL at `jobs.ashbyhq.com/api/non-user-graphql`, which you should not use. `api.ashbyhq.com/posting-api` is Ashby's documented public posting API.

---

## 5. SmartRecruiters

**Verified with:** Experian (UK, 39 GB jobs). Primark (119 GB), Bosch Group (40 GB) and ServiceNow (24 GB) also returned jobs.

**How to recognise it:** `jobs.smartrecruiters.com/{CompanyId}/{postingId}-{slug}`, `careers.smartrecruiters.com/{CompanyId}`. `CompanyId` is the identifier shown in the URL (e.g. `Experian`, `BoschGroup`, `Ubisoft2`).

**List request:** `GET https://api.smartrecruiters.com/v1/companies/{CompanyId}/postings?country=gb&limit=100&offset=0[&q=keyword]`
- Pagination: `offset += limit` until `offset >= totalFound`. `limit=100` works; a higher limit is **UNVERIFIED**.
- ⚠ **A wrong or unknown CompanyId returns HTTP 200 with `totalFound: 0`**. Visa, IKEA and Sky all did this, so validate once by hand.

**Key fields:** `content[].{id, name (title), uuid, refNumber, releasedDate (ISO), location.{city, country, region, remote, hybrid, fullLocation}, department.label, function.label, typeOfEmployment.label, experienceLevel.label, customField[], ref (detail URL)}`.

**Detail request:** `GET /v1/companies/{CompanyId}/postings/{id}` → `postingUrl`, `applyUrl`, `releasedDate`, and `jobAd.sections.{companyDescription, jobDescription, qualifications, additionalInformation}.text` (HTML).

**Rendering:** JSON. HTML fallback: `careers.smartrecruiters.com/{CompanyId}` is server-rendered and listed 33 job links for Experian. Job pages carry **schema.org microdata** (`itemprop="datePosted"` etc.), not JSON-LD.

**robots ⚠:** `api.smartrecruiters.com/robots.txt` = `User-agent: * / Disallow: /`, with only `LinkedInBot` allowed `/v1/companies/`. The Posting API is publicly documented for career-site use, but robots asks generic crawlers to stay off. If you want strict robots compliance, use the server-rendered `careers.smartrecruiters.com` and `jobs.smartrecruiters.com` pages instead; their robots.txt is effectively empty.

---

## 6. Workable

**Verified with:** Treatwell (London/EU, 17 UK jobs). The accounts for Carwow, Zopa, Moneybox and Multiverse exist but had 0 jobs.

**How to recognise it:** `apply.workable.com/{account}/`, `apply.workable.com/{account}/j/{shortcode}/`, `apply.workable.com/j/{shortcode}`, and the legacy `{account}.workable.com`.

**Option A (simplest), widget API:** `GET https://apply.workable.com/api/v1/widget/accounts/{account}?details=true`
→ `{name, description, jobs[]}`, with every job in one response. Fields: `title, shortcode, url, application_url, published_on ("2026-09-28"), created_at, country, city, state, locations[{country,countryCode,city,region}], department, employment_type, telecommuting, experience, function, description (HTML, only when details=true)`. Unknown account → 404.

**Option B, v3 search API:**
```http
POST https://apply.workable.com/api/v3/accounts/{account}/jobs
Content-Type: application/json

{"query":"","location":[{"country":"United Kingdom","countryCode":"GB"}],"department":[],"worktype":[],"remote":[]}
```
→ `{total, results[10], nextPage}`. To page, resend the same body with `"token": "<nextPage>"` (verified). The location filter worked (UK → 17). Fields: `id, shortcode, title, location.{city,country,countryCode}, locations[], published (ISO), department[], workplace, type, remote`.
⚠ **UNEXPLAINED:** for Treatwell, the widget returned 107 jobs while v3 reported `total: 86`. Use the widget for completeness.

**Detail request:** `GET https://apply.workable.com/api/v2/accounts/{account}/jobs/{shortcode}` → adds `description`, `requirements`, `benefits` (HTML). **Job URL:** `https://apply.workable.com/{account}/j/{shortcode}/`.

**Rendering:** `apply.workable.com` is a JS app, so use the JSON APIs. **robots:** `Disallow:` (empty, so everything is allowed) plus `Content-Signal: search=yes, ai-input=yes, ai-train=no`.

---

## 7. Teamtailor

**Verified with:** Cazoo (UK; `cazoo.teamtailor.com` redirects to `careers.cazoo.co.uk`). Tibber and Mindler were also checked.

**How to recognise it:** `{company}.teamtailor.com/jobs`, or a custom domain where the HTML references `teamtailor` (CDN/asset hosts). Job URL: `/jobs/{numericId}-{slug}`.

**List request:** `GET https://{company}.teamtailor.com/jobs.rss` (also works on the custom domain) → RSS 2.0, with all jobs in one feed. The RSS item count matched the HTML listing on all three sites tested (3/3, 7/7, 9/9).
Item fields: `title`, `description` (HTML), `pubDate` (RFC-822), `link`, `guid`, `remoteStatus`, `tt:department`, `tt:role`, and `tt:locations/tt:location/{tt:name, tt:city, tt:country, tt:zip, tt:address}` (namespace `https://teamtailor.com/locations`).

**Detail:** job pages are server-rendered with a **JSON-LD `JobPosting`** (`datePosted`, `jobLocation`, `employmentType`, `identifier`), verified.

**Rendering:** plain HTML and RSS, no JS needed. The official Teamtailor REST API needs a company API key and was not used. **robots:** disallows `/app/`, `/messages/` and `/jobs/internal/`, and fully blocks `aihitdata`. `Content-Signal: ai-train=no`. Sitemap at `/sitemap.xml`.

---

## 8. Recruitee

**Verified with:** Vilgain (a Czech company with a London "Country Manager UK" role). ⚠ No **UK-headquartered** Recruitee customer was found to test against (Bunq and Peak also exist), but the API is the same for every tenant.

**How to recognise it:** `{company}.recruitee.com`, job URL `{company}.recruitee.com/o/{slug}`, or custom domains.

**List request:** `GET https://{company}.recruitee.com/api/offers/` → `{offers[]}`. **No pagination.**
Key fields: `id, title, slug, careers_url, careers_apply_url, city, country, country_code ("GB"), location, locations[], published_at ("2026-10-01 13:40:19 UTC"), created_at, updated_at, close_at, department, description (HTML), requirements, employment_type_code, remote, hybrid, on_site, salary, status, tags`.

**Detail request:** `GET /api/offers/{id}` → `{offer:{…}}` with 56 keys (verified).

**Rendering:** JSON. **robots:** `Disallow: /v/` only.

---

## 9. Personio

**Verified with:** Linnworks (UK, Norwich; 8 positions, offices "Linnworks-UK", "Linnworks-USA" and "Linnworks-Estonia"). Personio's own board was also checked.

**How to recognise it:** `{company}.jobs.personio.de` or `{company}.jobs.personio.com`. Job URL `/job/{id}`. Try `.de` first, then `.com`.

**List request:** `GET https://{company}.jobs.personio.de/xml?language=en` → XML `<workzag-jobs><position>…`. **No pagination.** Unknown company → 404.
Position fields: `id, subcompany, office, additionalOffices/office, department, recruitingCategory, name (title), jobDescriptions/jobDescription/{name, value (HTML)}, employmentType, seniority, schedule, yearsOfExperience, occupation, occupationCategory, createdAt (ISO)`.
⚠ The feed has **no job URL**; build it as `https://{company}.jobs.personio.de/job/{id}` (verified 200). `office` is free text such as "Linnworks-UK", so match locations loosely. Only `createdAt` is given, not a re-publish date.

**Rendering:** XML. **robots:** `Allow: /`.

---

## 10. Eightfold (two API generations)

**Verified with:** HSBC (UK) on the legacy v2 API, and Vodafone (UK) on the newer PCSX API.

**How to recognise it:** `{tenant}.eightfold.ai/careers`, or custom domains (`portal.careers.hsbc.com/careers`, `jobs.vodafone.com/careers`) whose HTML mentions `eightfold`. Job URL: `/careers/job/{positionId}`. The API also works on the custom domain (verified for both).

**`domain` parameter:** the company's email domain (`hsbc.com`, `vodafone.com`). A wrong value returns `count: 0` (Bayer gave 0 with `bayer.com`).

**A. Legacy v2:** `GET https://{host}/api/apply/v2/jobs?domain={domain}&start=0&num=10&query={q}&location=United%20Kingdom`
→ `{count, positions[]}`. **`num` is capped at 10** (50 and 100 still returned 10), so page with `start += 10` (verified).
Position fields: `id, name, location, locations[], department, business_unit, t_create, t_update (epoch seconds), ats_job_id, display_job_id, canonicalPositionUrl, work_location_option, custom_data`.
Detail: `GET /api/apply/v2/jobs/{id}?domain={domain}` → adds `job_description` (HTML).

**B. PCSX (newer):** used when v2 returns **`403 {"message":"Not authorized for PCSX"}`**, as seen at Vodafone, Qualcomm, Starbucks and Micron.
`GET https://{host}/api/pcsx/search?domain={domain}&query=&location=United%20Kingdom&start=0`
→ `{status, data:{count, positions[]: id, displayJobId, atsJobId, name, locations[], standardizedLocations ["GB"], postedTs, creationTs (epoch s), department, workLocationOption, positionUrl}}`. 10 per page (`num` ignored), so page with `start += 10`.
Detail: `GET /api/pcsx/position_details?position_id={id}&domain={domain}&hl=en` → `data.{jobDescription (HTML), publicUrl, postedTs, …}` (verified).

**Rendering:** JSON. **robots:** `Disallow: /` with **explicit `Allow: /careers`, `/api/apply`, `/api/pcsx`**, so this is clearly fine.

---

## 11. Oracle Recruiting Cloud (Fusion HCM "Candidate Experience")

**Verified with:** JPMorgan Chase (`jpmc.fa.oraclecloud.com`, site `CX_1001`; 7,346 jobs globally, 692 in the UK).

**How to recognise it:** `https://{pod}.fa.{dc}.oraclecloud.com/hcmUI/CandidateExperience/{lang}/sites/{siteNumber}/requisitions` or `…/job/{Id}`. `siteNumber` looks like `CX_1001`. Custom careers domains usually link or redirect here.

**List request (GET):**
```
https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions
  ?onlyData=true
  &expand=requisitionList.secondaryLocations,flexFieldsFacet.values
  &finder=findReqs;siteNumber=CX_1001,facetsList=LOCATIONS;WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS,limit=25,offset=0,locationId=300000000289276,keyword=data,sortBy=POSTING_DATES_DESC
```
- ⚠ **`expand=requisitionList…` is mandatory.** Without it the response has `TotalJobsCount` but **no `requisitionList`** (verified).
- Pagination: `offset=` inside the `finder` string. `limit=200` worked.
- UK filter: `locationId` comes from `locationsFacet` (`{"Id":300000000289276,"Name":"United Kingdom","TotalCount":692}` at JPMC). **The ID is tenant-specific**, so look it up once per employer with `facetsList=LOCATIONS`.
- `keyword` is broad and can miss things (§0). Quoting the keyword (`keyword=%22data%20analyst%22`) works.

**Response:** `items[0].{TotalJobsCount, Offset, Limit, locationsFacet[], requisitionList[]}`. Each requisition has `Id, Title, PostedDate ("2026-10-09"), PostingEndDate, PrimaryLocation, PrimaryLocationCountry ("GB"), secondaryLocations[], ShortDescriptionStr, JobFamily, JobFunction, WorkplaceType, HotJobFlag`.

**Detail request:** `GET /hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="{Id}",siteNumber=CX_1001` → `items[0].{Title, ExternalDescriptionStr (HTML), ExternalPostedStartDate, ExternalPostedEndDate, PrimaryLocation, …}` (63 keys).

**Job URL:** `https://{host}/hcmUI/CandidateExperience/en/sites/{siteNumber}/job/{Id}`. This is a JS shell (19 KB, no JSON-LD), so use the API.

**robots/WAF ⚠:** fetching `/robots.txt` returned **"W4S-402: Blocked by WAF4SaaS"**, so the robots rules are unknown and there is a WAF in front. The API calls themselves succeeded. Keep request rates low.

---

## 12. Oracle Taleo (Enterprise)

**Verified with:** BAE Systems (`baesystems.taleo.net`, career section `2`, 189 jobs, UK sites including Lancashire/Warton, Cumbria/Barrow and Bristol/Filton).

**How to recognise it:** `https://{tenant}.taleo.net/careersection/{section}/jobsearch.ftl?lang=en` and `…/jobdetail.ftl?job={contestNo}`. An invalid section returns **HTTP 200 with the title "Career Section Unavailable"**. Taleo Business Edition (`*.tbe.taleo.net`) is a different product and is **UNVERIFIED**.

**Step 1:** GET `jobsearch.ftl` and regex the portal number out of the HTML: `portal=101430233` / `portalNo: '101430233'`.

**Step 2, list request:**
```http
POST https://{tenant}.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal={portalNo}
Content-Type: application/json
tz: GMT+01:00
tzname: Europe/London

{"multilineEnabled":false,"sortingSelection":{"sortBySelectionParam":"3","ascendingSortingOrder":"false"},
 "fieldData":{"fields":{"KEYWORD":"","LOCATION":""},"valid":true},
 "filterSelectionParam":{"searchFilterSelections":[{"id":"POSTING_DATE","selectedValues":[]},{"id":"LOCATION","selectedValues":[]},{"id":"JOB_FIELD","selectedValues":[]}]},
 "advancedSearchFiltersSelectionParam":{"searchFilterSelections":[]},"pageNo":1}
```
No cookies were needed. GET returns 405.
Response: `{requisitionList[], pagingData:{currentPageNo, pageSize:25, totalCount:189}, facetResults[]}`. Paginate with `pageNo++`.
Each requisition: `{jobId, contestNo, column[], hotJob}`. ⚠ **`column[]` holds whatever columns the section is configured to show.** At BAE that is only the title, so location and date must come from the detail page. `facetResults` includes `LOCATION` values such as `{"id":"570450347","text":"Lancashire","quantity":"42"}`. Filtering by putting those IDs in `selectedValues` is **UNVERIFIED**.

**Detail request:** `GET /careersection/{section}/jobdetail.ftl?job={contestNo}&lang=en`. This is server-rendered HTML with no JSON-LD. The data sits in `<input id="initialHistory" value="…">` as a `!|!`-delimited, URL-encoded list. At BAE: index 12 = title, 13 = contestNo, 14 = description HTML (prefixed `!*!`), 16 = job field, 18 = location. ⚠ **These positions are tenant-specific.** Locate fields by content rather than fixed index, or just hash the decoded text.

**robots:** none (robots.txt returns a 404 page).

---

## 13. SAP SuccessFactors (Recruiting Marketing / "Career Site Builder")

**Verified with:** Babcock International (UK; `jobs.babcockinternational.com`, 281 jobs, 207 for "United Kingdom").

**How to recognise it:** custom domains whose job URLs look like `/job/{Location-Title-slug}/{numericId}/` or `/{Brand}/job/…/{id}/`, plus `/search/?q=`, `/services/rss/job/`, and `jobTitle-link`/`data-row` markup. Legacy non-CSB sites (`career{N}.successfactors.eu/career?company={id}`) are JS-heavy and **UNVERIFIED**.

**List request (HTML):** `GET https://{host}/search/?q={kw}&locationsearch=United%20Kingdom&startrow=0&sortColumn=referencedate&sortDirection=desc`
- Server-rendered. **25 rows per page**, with `startrow += 25` (verified). Total comes from `Results <b>1 – 25</b> of <b>207</b>`.
- Rows: `tr.data-row` → `a.jobTitle-link[href]`, `span.jobLocation`, and on some sites `span.jobDate`, `jobFacility`, `jobShifttype`.

**RSS:** `/services/rss/job/?locale=en_GB&keywords=apprentice` exists and returned items. ⚠ **robots.txt has `Disallow: /services/`**, so do not use it.

**Sitemap:** `/sitemap.xml` lists every job with `<lastmod>` (281 URLs). This is the best way to spot new jobs.

**Detail:** job pages are server-rendered with **schema.org microdata**, not JSON-LD: `itemprop="title|datePosted|description|jobLocation|hiringOrganization"`, with `datePosted` content like `"Fri Oct 09 02:01:00 UTC 2026"`.

**Bot protection:** `jobs.sap.com` and `jobs.nationalgrid.com` returned 403 to curl, so some CSB sites sit behind Akamai and may need a headless browser.

---

## 14. iCIMS

**Verified with:** Teleperformance (`careers-teleperformance.icims.com`, global) and M.C. Dean (`careers-mmc`). ⚠ **No UK employer on iCIMS was found** (about 60 guessed tenant names returned 404). The mechanics are the same for every tenant.

**How to recognise it:** `https://{prefix}-{tenant}.icims.com/jobs/…`, where prefix is `careers`, `uk`, `us`, `jobs` or `globalcareers`. Job URL `/jobs/{id}/{slug}/job`. Customer sites often iframe it.

**List request:** `GET https://careers-{t}.icims.com/jobs/search?ss=1&in_iframe=1&searchKeyword={kw}&pr={page}`
- `in_iframe=1` returns the bare listing instead of a wrapper page. Server-rendered, **50 per page**, `pr=0,1,…` (verified: `pr=1` → "Page 2 of 2").
- Each row is `li.iCIMS_JobCardItem` containing:
  - `a.iCIMS_Anchor[href]` with an `h3` title
  - the "Job Locations" header (`"MY-Pulau Pinang-Bayan Lepas"` = COUNTRY-REGION-CITY)
  - posted date in `span[title="7/28/2025 5:49 AM"]`
  - `dl.iCIMS_JobHeaderGroup` holding Requisition ID, Category and Country.

**Detail:** `/jobs/{id}/{slug}/job?in_iframe=1` → **JSON-LD `JobPosting`** (`datePosted`, `validThrough`, `jobLocation.address.addressCountry`, `title`, `description`), verified.

**Sitemap:** `/sitemap.xml` (declared in robots). **robots:** disallows login/referral/candidate/connect paths; listings and jobs are allowed. Unknown tenant → 404.

---

## 15. Avature

**Verified with:** Tesco (UK; `careers.tesco.com` = `tesco.avature.net`; "999+" jobs, 2,712 URLs in the en_GB sitemap).

**How to recognise it:** `{tenant}.avature.net/{lang}/careers/…`, or custom domains with `/careers/SearchJobs` and `/careers/JobDetail/{slug}/{id}`. Pages carry `<meta name="avature.portal.*">`. Each customer's template is bespoke, so CSS classes vary between tenants.

**List request (HTML):** `GET https://{host}/en_GB/careers/SearchJobs/{keyword?}?jobOffset=0`
- Server-rendered, **10 per page**, `jobOffset += 10` (verified). The `jobRecordsPerPage` parameter was ignored on HTML pages. Total text: `"1-10 of 999+ results"`, which is capped, so you can't get an exact count.
- The keyword goes in the path segment (`/SearchJobs/apprentice`, reflected in `<meta name="avature.portallist.search">`).
- Tesco rows: `h3.article__header__text__title > a.link[href*="/JobDetail/"]`.

**RSS:** `<link rel="alternate" type="application/rss+xml">` → `/{lang}/careers/SearchJobs/{kw}/feed/?jobRecordsPerPage=10`. It returns `title, link, pubDate, description (ref no.)`. ⚠ It is **capped at 20 items and `jobOffset` is ignored**, so it can't list everything. Use it only as a quick "anything new?" check.

**Sitemap (best option for discovery):** robots.txt → `https://careers.tesco.com/careers/sitemap_index.xml` → one sitemap per locale.

**Detail:** job pages have **JSON-LD `JobPosting`** (`datePosted`, `validThrough`, `jobLocation`, `hiringOrganization`, `identifier`), verified.

**robots:** `Allow: /careers`, `Disallow: /careers/*qtvc=`.

---

## 16. Phenom (Phenom People "TXM")

**Verified with:** GSK (UK; `jobs.gsk.com/gb/en`; 108 UK jobs). GSK's `applyUrl` values point to Workday.

**How to recognise it:** a custom domain with `/{cc}/{lang}/` path prefix (`/gb/en/search-results`, `/gb/en/job/{jobId}/{slug}`). The HTML contains `phApp`/`phApp.ddo`, and `widgetApiEndpoint` points at `https://{host}/widgets`.

**Option A (server-rendered):** `GET https://{host}/gb/en/search-results?keywords={kw}`. The HTML embeds `phApp.ddo = {…};` JSON with `eagerLoadRefineSearch.{totalHits, hits, data.jobs[]}` (first 10 jobs). Extract it with the regex `/phApp\.ddo\s*=\s*(\{.*?\});\s*phApp\./s`. ⚠ Paging this page via `&from=10&s=1` dropped the keyword in testing (totalHits went to 683), so use Option B to paginate.

**Option B (JSON):**
```http
POST https://{host}/widgets
Content-Type: application/json

{"lang":"en_gb","deviceType":"desktop","country":"gb","pageName":"search-results","ddoKey":"refineSearch",
 "from":0,"size":100,"jobs":true,"counts":false,"pageId":"page23","siteType":"external",
 "keywords":"","global":true,"selected_fields":{"country":["United Kingdom"]}}
```
→ `refineSearch.{totalHits:108, hits:100, data.jobs[]}`. `size:100` worked, and `from:100` returned the remaining 8 (verified). Read `lang`, `country`, `pageId` and `refNum` from the page's `phApp` variables. Whether `pageId` is actually required is **UNVERIFIED**.
Job fields: `jobId, jobSeqNo, reqId, title, location, city, state, country, multi_location[], postedDate (ISO), dateCreated, category, type, applyUrl, descriptionTeaser, ml_skills`.

**Detail:** `GET https://{host}/gb/en/job/{jobId}` → **JSON-LD `JobPosting`** plus `phApp.ddo.jobDetail` (full description).

**robots:** disallows `*/apply`, `*/jobcart`, `*/chatbot`, `*/px-widgets`, etc. `/widgets` and `search-results` are not disallowed.

---

## 17. Cornerstone OnDemand (CSOD)

**Verified (mechanics only):** Tetra Tech (`tetratech.csod.com`, region `uk.api.csod.com`, 42 requisitions, which turned out to be Australian jobs). ⚠ The **UK tenant tested (Dyson) returned 0 jobs** on site IDs 1–8. QinetiQ, Costain, KPMG, Thales and Airbus all redirect `/ux/ats/careersite/1/home` to `/ui/error`, which probably means they use CSOD only for learning management, not recruiting. **No UK employer with live CSOD jobs was confirmed.**

**How to recognise it:** `https://{tenant}.csod.com/ux/ats/careersite/{siteId}/home?c={tenant}`, job `…/home/requisition/{reqId}?c={tenant}`. CSOD does not use wildcard DNS, so made-up tenants fail to resolve.

**Step 1:** GET the career-site HTML. It contains `csod.context={… "endpoints":{"cloud":"https://uk.api.csod.com/"}, "token":"eyJ…"}`. The token is an **anonymous JWT** (user -100) that expires after **about 1 hour** (iat→exp). The cloud host is region-specific.

**Step 2, list request:**
```http
POST {cloud}rec-job-search/external/jobs
Authorization: Bearer {token}
Content-Type: application/json

{"careerSiteId":1,"careerSitePageId":1,"pageNumber":1,"pageSize":25,"cultureId":1,"searchText":"",
 "cultureName":"en-US","states":[],"countryCodes":[],"cities":[],"placeID":"","radius":null,
 "postingsWithinDays":null,"customFieldCheckboxKeys":[],"customFieldDropdowns":[],"customFieldRadios":[]}
```
→ `{data:{totalCount, requisitions[]:{requisitionId, displayJobTitle (HTML-escaped), locations[{city,state,country}], postingEffectiveDate ("10/6/2026" M/D/YYYY), postingExpirationDate, externalDescription}}}`. Paginate with `pageNumber++`.

**Detail request:** `GET https://{tenant}.csod.com/Services/API/ATS/CareerSite/{siteId}/JobRequisitions/{reqId}?useMobileAd=false&cultureName=en-US` with the same Bearer token → `data[0].items[0].fields.{id, reqId, title, location, ad (HTML), description}`. Without the token: **401**.

**Rendering:** a fully JS app; the requisition page has no data or JSON-LD. Fetching the page to get the anonymous token counts as "no login", but the token is required. **robots:** `Crawl-delay: 10`.

---

## 18. Oleeo (incl. `*.tal.net`, Civil Service Jobs)

**Verified with:** Morgan Stanley Campus (`morganstanley.tal.net`, 50+ programmes including London roles). BlackRock (`blackrock.tal.net`, 12 opportunities) also worked.
Other tenants observed:
- NAO: "This system is not available at this time".
- Slaughter and May, Met Police: "System Pending Deletion".
- Nomura (Old): empty.
- BNP Paribas, Aon: a "**Quick Check Needed**" bot challenge.
- Deloitte: the candidate URL redirected to its events board.

**How to recognise it:**
- Board: `https://{tenant}.tal.net/vx/lang-en-GB/mobile-0/appcentre-{n}/brand-{n}/xf-{hash}/candidate/jobboard/vacancy/{boardId}/adv/`
- Opportunity: `…/candidate/so/pm/{n}/pl/{n}/opp/{oppId}-{slug}/en-GB`
- Landing: `https://{tenant}.tal.net/candidate`
- ⚠ `xf-{hash}` is a **per-request session token**. Strip it before comparing or storing URLs; key on `oppId`.
- The short form `https://{tenant}.tal.net/vx/candidate/jobboard/vacancy/1/adv/` works and redirects as needed (verified). Board IDs (`vacancy/1`, `vacancy/2`, `event/1`) are tenant-specific; read them from the links on `/candidate`.
- Requests to the tenant root (`/`) land on the recruiter ATS login page, which is the wrong side of the system.

**List request (HTML):** `GET https://{tenant}.tal.net/vx/candidate/jobboard/vacancy/{boardId}/adv/?start=0`
- Server-rendered table, **50 rows per page**, `?start=50`, `?start=100`… (verified via the `div.paging` "Next page" link).
- Row: `tr.search_res[data-oppid][data-title]` → `a.subject[href]` (title + URL) and the next `td` (location, e.g. "London"). There is no posted date in the list.
- Boards have filter forms (Region, Business Area, Entry level, City). Keyword/filter query parameters are **UNVERIFIED**; just fetch everything and filter locally.

**Detail:** server-rendered HTML with labelled fields (City, Education Level, Business Unit, Job description; closing date where configured). **No JSON-LD.**

**RSS:** none found in the HTML (**UNVERIFIED** whether any exists).

**robots ⚠:** `Disallow: /*/agent/`, `/*/ats/`, `/*/channel/`; **`Crawl-delay: 10`**. `ClaudeBot`, `GPTBot`, `Bytespider`, `ImageSiftBot` and `SemrushBot` are fully disallowed. Use your own honest UA, keep 10 s between requests, and never use the AI-crawler UAs.

**Civil Service Jobs** (`www.civilservicejobs.service.gov.uk/csr/index.cgi`, run on Oleeo): robots says `Allow: /`, **but every request gets a "Quick check needed: confirm you're a real person" challenge** (`/protect/main.js`, with a checkbox). Plain HTTP can't get past it. A headless browser might, but that is not robust and arguably goes against the intent of the check. For civil-service and other levy-funded apprenticeships, consider **GOV.UK Find an apprenticeship** instead:
- Its API (`https://api.apprenticeships.education.gov.uk/vacancies/vacancy`) needs a free subscription key; it returned 401 without one (verified).
- The public search pages (`findapprenticeship.service.gov.uk/apprenticeships?searchTerm=…`) are server-rendered (verified 200).

---

## 19. Generic fallbacks

### 19.1 schema.org `JobPosting` extraction (JSON-LD **and** microdata)
Confirmed on job-detail pages from Workday, Teamtailor, iCIMS, Avature and Phenom (JSON-LD) and from SuccessFactors and SmartRecruiters (**microdata**, `itemprop`). Listing pages almost never have it, so first discover job URLs (sitemap or link regex), then extract per job.
- Parse every `<script type="application/ld+json">`. Handle top-level arrays, `@graph`, `@type` given as an array, and invalid JSON (raw newlines or HTML inside strings; retry after replacing control characters).
- Fields: `title`, `datePosted`, `validThrough` (closing date), `jobLocation[].address.{addressLocality, addressRegion, addressCountry}`, `hiringOrganization.name`, `employmentType`, `identifier.value`, `description` (HTML), `url`.
- Microdata fallback: `[itemtype*="schema.org/JobPosting"]` → `[itemprop=title]`, `[itemprop=datePosted][content]`, `[itemprop=jobLocation]`, `[itemprop=description]`.
- Normalise dates (ISO, RFC-822, `"Fri Oct 09 02:01:00 UTC 2026"`) with one tolerant parser.
- Libraries: `cheerio` (+ `JSON.parse`), or `metascraper`/`web-auto-extractor`-style microdata parsers.

### 19.2 sitemap.xml job discovery
1. GET `/robots.txt` and collect the `Sitemap:` lines. Fall back to `/sitemap.xml` and `/sitemap_index.xml`.
2. Recurse through `<sitemapindex>`, and decompress `.xml.gz` files.
3. Keep only URLs matching that ATS's job pattern (`/job/`, `/JobDetail/`, `/jobs/\d+`, `/opp/\d+`, …).
4. Diff against the set of IDs already seen, and fetch only new or changed URLs (use `<lastmod>` when present) → §19.1.

Verified sitemaps: Workday `/{site}/siteMap.xml` (781 URLs, no lastmod), SuccessFactors `/sitemap.xml` (281, with lastmod), Avature `/careers/sitemap_index.xml` → per-locale (2,712), iCIMS `/sitemap.xml`, Teamtailor `/sitemap.xml`.

### 19.3 "Page content hash changed" detection (for pages you can't parse)
- Fetch the page (headless only if the content is rendered by JS). Send `If-None-Match`/`If-Modified-Since` when an ETag or Last-Modified header is available; a 304 means unchanged.
- **Normalise before hashing**:
  - remove `<script>`, `<style>`, `<noscript>`, cookie banners and nav/footer
  - strip volatile tokens: Oleeo `xf-[0-9a-f]+`, `__vxXSRF_Token`, Taleo `csrftoken`, `SID=`, `jsessionid`, cache-busting `?v=`, timestamps and relative times like "Posted 2 days ago", rotating "featured job" carousels
  - collapse whitespace and lowercase.
- Hash a **semantic projection** where you can, rather than raw text: e.g. the sorted set of `(link text, href)` for anchors matching a job-ish pattern. Fall back to SHA-256 of the main-content text.
- Store `{hash, normalisedText}`. On a change, diff the old and new text and report only *added* lines that match the apprenticeship + data regex. That avoids alerting on cosmetic edits.
- Alert separately on a fetch error, a 403, or a "Quick check needed"/captcha page, so that "blocked" is never mistaken for "no jobs".

---

## 20. TypeScript-friendly summary

```ts
export type AtsId =
  | 'workday' | 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'workable'
  | 'teamtailor' | 'recruitee' | 'personio' | 'eightfold' | 'oracle_orc' | 'taleo'
  | 'successfactors' | 'icims' | 'avature' | 'phenom' | 'cornerstone' | 'oleeo';

export type Transport = 'json' | 'xml' | 'rss' | 'ssr-html' | 'html-embedded-json';

export interface AtsProfile {
  id: AtsId;
  detect: RegExp[];            // run against careers URL (and/or final redirected URL / HTML)
  list: { method: 'GET' | 'POST'; url: string; body?: string };
  transport: Transport;
  pagination: 'none' | 'offset' | 'page' | 'cursor' | 'start';
  pageSizeMax: number | null;  // null = everything in one response
  needsBootstrap: boolean;     // must fetch an HTML page first for token/portal id/etc
  needsHeadless: boolean;
  dateField: string;
  jobUrlField: string;
  verifiedWith: string;        // 2026-10-09
  robots: string;
}

export const DETECTORS: Array<[AtsId, RegExp]> = [
  ['workday',        /(?:^|\/\/)([\w-]+)\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)|myworkdaysite\.com\/recruiting\/([^/]+)\/([^/?#]+)/],
  ['greenhouse',     /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)|[?&]gh_jid=/],
  ['lever',          /jobs\.(eu\.)?lever\.co\/([\w.-]+)/],
  ['ashby',          /jobs\.ashbyhq\.com\/([\w.%-]+)|[?&]ashby_jid=/],
  ['smartrecruiters',/(?:jobs|careers)\.smartrecruiters\.com\/([\w-]+)/],
  ['workable',       /apply\.workable\.com\/(?!j\/)([\w-]+)|([\w-]+)\.workable\.com/],
  ['teamtailor',     /([\w-]+)\.teamtailor\.com/],              // + HTML contains "teamtailor" for custom domains
  ['recruitee',      /([\w-]+)\.recruitee\.com/],
  ['personio',       /([\w-]+)\.jobs\.personio\.(de|com)/],
  ['eightfold',      /([\w-]+)\.eightfold\.ai|\/careers\/job\/\d{12,}/],   // + HTML contains "eightfold"
  ['oracle_orc',     /\.fa(?:\.[\w-]+)?\.oraclecloud\.com\/hcmUI\/CandidateExperience\/[\w-]+\/sites\/([\w]+)/],
  ['taleo',          /([\w-]+)\.taleo\.net\/careersection\/([\w-]+)/],
  ['successfactors', /\/job\/[^/]+\/\d{6,}\/?$|successfactors\.(?:eu|com)\/career|\/search\/\?q=.*startrow=/],
  ['icims',          /([\w-]+)\.icims\.com\/jobs/],
  ['avature',        /([\w-]+)\.avature\.net|\/careers\/(?:SearchJobs|JobDetail)\//],
  ['phenom',         /\/[a-z]{2}\/[a-z]{2}\/(?:search-results|job\/\d+)/],   // + HTML contains "phApp.ddo"
  ['cornerstone',    /([\w-]+)\.csod\.com\/ux\/ats\/careersite\/(\d+)/],
  ['oleeo',          /([\w-]+)\.tal\.net\/|civilservicejobs\.service\.gov\.uk|\/candidate\/jobboard\/vacancy\/\d+/],
];
```

| id | list request (no auth) | transport | pagination / max page | bootstrap? | headless? | posted-date field | job URL field | verified with (2026-10-09) | robots / ToS |
|---|---|---|---|---|---|---|---|---|---|
| workday | `POST https://{t}.wd{N}.myworkdayjobs.com/wday/cxs/{t}/{site}/jobs` body `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` | json | offset / **20** (21→400) | no | no | `postedOn` (relative); detail `jobPostingInfo.startDate` | `https://{host}/{site}` + `externalPath` | Barclays ✅ (781 jobs, 19 apprentices) | site path allowed; CXS undocumented |
| greenhouse | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | json | none | no | no | `first_published` / `updated_at` | `absolute_url` | Monzo ✅, TrueLayer (EU board) ✅ | public API; only `/embed/` disallowed |
| lever | `GET https://api.lever.co/v0/postings/{co}?mode=json` (EU: `api.eu.lever.co`) | json | `skip`/`limit` (optional) | no | no | `createdAt` (epoch ms) | `hostedUrl` | Zopa ✅, Matillion ✅; **EU ⚠ unverified** | public API; Crawl-delay 1 |
| ashby | `GET https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true` | json | none | no | no | `publishedAt` | `jobUrl` | Multiverse ✅ | public API (don't use `jobs.ashbyhq.com/api/`) |
| smartrecruiters | `GET https://api.smartrecruiters.com/v1/companies/{Id}/postings?country=gb&limit=100&offset=0` | json | offset / 100 | no | no | `releasedDate` | detail `postingUrl` (or build `jobs.smartrecruiters.com/{Id}/{id}`) | Experian ✅ | **API robots `Disallow: /` for `*`**; wrong Id → 200 + 0 |
| workable | `GET https://apply.workable.com/api/v1/widget/accounts/{acct}?details=true` (or v3 POST + `token`) | json | none (v3: cursor/10) | no | no | `published_on` / `published` | `url` / `apply.workable.com/{acct}/j/{shortcode}/` | Treatwell ✅ | allowed; ai-train=no |
| teamtailor | `GET https://{co}.teamtailor.com/jobs.rss` | rss | none | no | no | `pubDate` | `link` | Cazoo ✅ | allowed; ai-train=no |
| recruitee | `GET https://{co}.recruitee.com/api/offers/` | json | none | no | no | `published_at` | `careers_url` | Vilgain (London role) ✅; UK-HQ ⚠ | `/v/` disallowed only |
| personio | `GET https://{co}.jobs.personio.de/xml?language=en` (or `.com`) | xml | none | no | no | `createdAt` | build `https://{co}.jobs.personio.de/job/{id}` | Linnworks ✅ | `Allow: /` |
| eightfold | `GET https://{host}/api/apply/v2/jobs?domain={d}&start=0&num=10&location=United%20Kingdom`; if 403 "PCSX" → `GET /api/pcsx/search?domain={d}&location=United%20Kingdom&start=0` | json | start / **10** | need `domain` | no | `t_create` / `postedTs` (epoch s) | `canonicalPositionUrl` / `https://{host}` + `positionUrl` | HSBC (v2) ✅, Vodafone (PCSX) ✅ | `/api/apply` + `/api/pcsx` explicitly allowed |
| oracle_orc | `GET https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={S},limit=200,offset=0,locationId={UK},sortBy=POSTING_DATES_DESC` | json | offset (in finder) / 200 | need `siteNumber` (+ UK `locationId` once) | no | `PostedDate` | build `…/CandidateExperience/en/sites/{S}/job/{Id}` | JPMorgan ✅ | WAF (robots blocked) — go slow |
| taleo | `POST https://{t}.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal={portalNo}` (JSON body, `pageNo`) | json list + ssr detail | page / 25 | **yes** (portalNo from jobsearch.ftl) | no | detail page only (tenant-specific) | build `…/careersection/{sec}/jobdetail.ftl?job={contestNo}` | BAE Systems ✅ | no robots.txt |
| successfactors | `GET https://{host}/search/?q=&locationsearch=United%20Kingdom&startrow=0` (+ `/sitemap.xml`) | ssr-html | startrow / 25 | no | no (some Akamai 403) | microdata `datePosted` | `a.jobTitle-link[href]` | Babcock ✅ | **`/services/` (RSS) disallowed** |
| icims | `GET https://careers-{t}.icims.com/jobs/search?ss=1&in_iframe=1&pr=0` | ssr-html | pr / 50 | no | no | `span[title]` in row; JSON-LD on detail | `a.iCIMS_Anchor[href]` | Teleperformance ✅; **UK ⚠** | listings allowed; sitemap |
| avature | `GET https://{host}/en_GB/careers/SearchJobs/?jobOffset=0` (+ `sitemap_index.xml`) | ssr-html | jobOffset / 10 | no | no | JSON-LD `datePosted` (detail) | `a[href*="/JobDetail/"]` | Tesco ✅ | `/careers` allowed |
| phenom | `POST https://{host}/widgets` body `{ddoKey:"refineSearch",from,size:100,selected_fields:{country:["United Kingdom"]},…}` | json (or html-embedded-json) | from / 100 | read lang/country/pageId from page | no | `postedDate` | build `https://{host}/{cc}/{lang}/job/{jobId}` | GSK ✅ | `/widgets` not disallowed |
| cornerstone | `POST {cloud}rec-job-search/external/jobs` + `Authorization: Bearer {anon token}` | json | pageNumber / 25 | **yes** (token + cloud host from page; ~1h TTL) | no | `postingEffectiveDate` (M/D/YYYY) | build `…/careersite/{sid}/home/requisition/{id}?c={t}` | Tetra Tech (AU jobs) ✅; **UK ⚠ none live** | Crawl-delay 10 |
| oleeo | `GET https://{t}.tal.net/vx/candidate/jobboard/vacancy/{board}/adv/?start=0` | ssr-html | start / 50 | find board id on `/candidate` | no (CSJ & some tenants: bot check) | none in list (detail text) | `a.subject[href]` (strip `xf-…`) | Morgan Stanley ✅, BlackRock ✅; Civil Service Jobs ❌ (bot check) | **Crawl-delay 10; AI UAs disallowed** |

---

## 21. What is NOT verified (summary)

- **Lever EU** (`api.eu.lever.co`): the host is live, but no live EU-hosted company was found to test against.
- **iCIMS**: no UK employer found. Mechanics verified on Teleperformance and M.C. Dean.
- **Cornerstone**: no UK employer with live jobs found. Mechanics verified on Tetra Tech (Australian postings); Dyson's UK site returned 0.
- **Recruitee**: verified via a Czech company's London role, not a UK-headquartered employer.
- **Workday**: the claim that some tenants return `total: 0` after page 1 was not reproduced.
- **Taleo**: location-facet filtering in the POST body, and Taleo Business Edition, not tested.
- **SuccessFactors**: legacy non-CSB career sites (`career{N}.successfactors.*`) not tested.
- **Oleeo**: RSS feeds, and keyword/filter query parameters, not tested.
- **Phenom**: whether `pageId` is required, and correct paging for the HTML-embedded data, not settled.
- **Avature**: keyword search via a query parameter (only the path form was tested).
- **SmartRecruiters**: `limit` above 100 not tested. **Workable**: the v1 (107) vs v3 (86) count difference is unexplained.
- **Oracle ORC**: robots.txt contents unknown (WAF blocked the request).
- **Civil Service Jobs**: cannot be fetched with plain HTTP (bot check). Not attempted with a headless browser.
- Web search ran out of budget during this research. Tenant names for Lever EU, iCIMS UK and Cornerstone UK were found by guessing subdomains, so any of them may still have UK customers on those systems.

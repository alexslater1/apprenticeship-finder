# Devolved nations: Scotland, Wales, Northern Ireland — apprenticeship vacancy sources

Research date: 2026-10-09. Everything below was verified by fetching the live sites/APIs with curl
unless explicitly marked **UNVERIFIED**. Counts are a point-in-time snapshot (9 Oct 2026).

TL;DR for the scraper:

| Nation | Source | Type | Auth | Data-related live now |
|---|---|---|---|---|
| Scotland | `sdsapi-prod.azure-api.net/vacancy/...` (behind apprenticeships.scot) | JSON (Azure Search) | public APIM key embedded in site JS | 1 GA (Thales AI/Data Science), 4 MA IT support |
| Scotland | `api.myworldofwork.co.uk/job-vacancies/Search` (external/aggregated feed shown on same page) | JSON | second public APIM key in site JS | ~12 digital-ish of 176 |
| Scotland | myjobscotland.gov.uk (councils/public sector) | server-rendered HTML + JobPosting JSON-LD on detail pages | none | 5 apprenticeships total, none data |
| Wales | `api.careerswales.gov.wales/apprenticeships-api/api/v1/apprenticeships/q` | JSON | none | 42 total, 2 digital (L3 software dev, L2 IT tech), 1 degree-level (OT) |
| NI | jobapplyni.com (`/?sector=Apprenticeships&DoSearch=true`) | server-rendered Razor Pages HTML, no JSON-LD | none (GET works) | 8 apprenticeships, 6 are Thales HLAs (engineering/project); 0 data |
| NI | HLA listing (nidirect) + college portals (Belfast Met mindmill) | static HTML | none | course list only, not vacancies |

---

## 1. Scotland

### 1a. apprenticeships.scot (Skills Development Scotland) — primary source

**Architecture.** Astro static site with Svelte/React islands. Vacancy search at
`https://www.apprenticeships.scot/find-a-vacancy/` is 100% client-side: the page HTML contains no
vacancies and no JSON-LD. The island `/_astro/VacancySearchApp.<hash>.js` calls an Azure API
Management gateway directly from the browser. The subscription keys are hard-coded in the public JS
bundle (so they are "public" in the practical sense, but see ToS note below).

**robots.txt** (`https://www.apprenticeships.scot/robots.txt`): `Disallow: /vacancy-details/` and
`/dashboard/...`; `/find-a-vacancy/` is allowed. Sitemap: `sitemap-index.xml` -> `sitemap-0.xml`
(412 URLs, framework pages only, no vacancy URLs). The API host `sdsapi-prod.azure-api.net` has no
robots.txt relevance (it's an API gateway). Note: `/vacancy-details/?refCode=...` is the public
detail page and is disallowed to crawlers; the API detail endpoint below gives you the same data.

**Terms** (`/terms-and-conditions/`): "designed for your personal, non-commercial use ... you must
not use, copy ... the Site or any materials ... without our consent except as permitted under
applicable law"; "if you wish to make a request for consent, please contact us". A personal,
low-volume aggregator is arguably personal use, but it's not explicitly permitted. Recommendation:
poll once a day, send a descriptive UA with contact email, cache aggressively, and consider emailing
SDS (`apprenticeships.scot` contact form) for consent. SDS has no public developer-portal listing:
`https://sdsapi-prod.developer.azure-api.net/` exists (Azure APIM dev portal) but `/apis` shows no
public products anonymously (sign-up required; **UNVERIFIED** whether they would grant a key).

#### Endpoints (all verified live)

Common header: `Ocp-Apim-Subscription-Key: 276f3f23c88c4d07b406a22fb3572581` (from
`VacancySearchApp.7d10da6a.js`; will rotate if they redeploy — re-scrape the key from the JS
chunk referenced by `/find-a-vacancy/` if you get 401).

1. **Count**
   `GET https://sdsapi-prod.azure-api.net/vacancy/vacancies/count?api-version=1.0`
   -> `{"vacancies":119,"opportunities":124,"faCount":0,"gaCount":4,"maCount":115}`

2. **Search** (Azure Cognitive Search behind a facade)
   `POST https://sdsapi-prod.azure-api.net/vacancy/vacancies/search?api-version=1.0`
   `Content-Type: application/json`
   Body (exact shape the site sends):
   ```json
   {"keywords":"data","location":"","apprenticeshipTypeFacet":"GA","jobCategoryFacet":"",
    "qualificationFacet":"","IsTwoTicksFacet":"","skip":0,"take":15,"sort":"",
    "currentPage":1,"frameworkId":"","frameworkSearch":"","distance":15}
   ```
   - `apprenticeshipTypeFacet`: `"GA"`, `"MA"`, `"FA"` or comma-joined (site does `array.toString()`); `""` = all.
   - `jobCategoryFacet`: JobFamily string, e.g. `"Computing and ICT"`, `"Engineering"`.
   - `qualificationFacet`: e.g. `"SCQF level 10"`.
   - `skip`/`take` paginate (take=50 verified fine; take=15 is the UI default). `count` in response is the total.
   - `sort`: `""` (relevance); the UI offers a `vacancySort` select (values not captured — **UNVERIFIED**; try `"closingDate asc"`).
   - `location` is a free-text place/postcode; `distance` in miles.
   - `keywords` is full-text across description too (e.g. "data" matches admin roles that mention "data entry").
   Response: `{"facets":{VacancyType[],JobFamily[],ModernApprenticeshipLevel[],IsTwoTicks[]},
   "results":[{"score","highlights","document":{...}}],"count":119,"isRelatedVacancies":false}`
   `document` fields (PascalCase): `Id, RefCode, JobTitle, City, Postcode, PositionsAvailable, MinSalary,
   MaxSalary, SalaryFrequency ("Hour"|"Year"), DescriptionOverview, DescriptionLearn,
   DescriptionQualifications, DescriptionTypicalDay, EmployerName, HideEmployerName,
   TrainingProviderName (= university for GA), EmployerWebsite, ContactName, ContactEmail,
   ApplicationWebAddress, PreferredApplyMethod ("Direct"|"Website"), ModernApprenticeshipLevel
   ("SCQF level 6/7/8/10"), EntryRequirement, LocalAuthority, ClosingDate (ISO Z), FirstPublishedDate,
   CreatedWhen, UpdatedWhen, GeoLocationLat/Lon, GeoLocation (GeoJSON), JobFamily, VacancyType
   ("MA"|"GA"|"FA"), Framework (opaque Contentful-style id, e.g. "73ek13sMqiITmHo2NbM0lr"),
   LogoFileName, TypeOfEmployment ("Full"|"Part"), WorkingHours, IsTwoTicks, Nationwide, AcceptFA`.
   Logos: `https://apprenticeshipsprod.blob.core.windows.net/media/logos/<LogoFileName>`.
   Public page: `https://www.apprenticeships.scot/vacancy-details/?refCode=<RefCode>`.

3. **Detail by RefCode** (camelCase, adds `frameworkName`, numeric salary)
   `GET https://sdsapi-prod.azure-api.net/vacancy/vacancy/ref/<RefCode>?api-version=1.0`
   e.g. ref 167315 -> `frameworkName: "Engineering: Instrumentation, Measurement and Control"`,
   `trainingProviderName: "Glasgow Caledonian University"`, `applicationWebAddress: <Workday URL>`.
   (`/vacancy/vacancies/<id>` and `/vacancy/vacancy/<id>` are 404/401 — use `/ref/`.)

4. **Featured**: `GET .../vacancy/vacancies/featured?api-version=1.0` (same key).

5. **Framework index** (resolves framework names/types; useful to build the GA list)
   `POST https://sdsapi-prod.azure-api.net/apprenticeshipindex/frameworks/individual?api-version=1.0`
   Body: `{"queryType":"simple","searchMode":"all","search":"*","select":"description, link, title, type",
   "facets":["type,count:100000000,sort:value"],"top":1000,"orderby":"title asc",
   "scoringProfile":"individualframeworkSearchScoring"}`
   -> 133 frameworks: 15 FA, 15 GA, 103 MA. (Raw Azure Search response: `value[]`, `@search.facets`.)
   Note it does not return the opaque `Framework` id used in vacancy docs — map by `frameworkName`
   from the detail endpoint instead.

6. **Learning providers** (who delivers which framework, incl. GA universities)
   `POST https://sdsapi-prod.azure-api.net/apprenticeshipindex/learningproviders?api-version=1.0`
   Body: `{"queryType":"full","searchMode":"all","filter":"search.ismatch('Data Science*', 'MAType')",
   "facets":["Pathways,count:10000"],"top":1000}`
   Row fields: `TrainingProvider, MAType, Location, Website, Email, ContactName, Address, Postcode, Pathways[], Industry`.

#### GA frameworks (all 15, from the framework index)
Accounting; Business Management; Business Management: Business Analysis; Business Management:
Project Management; Civil Engineering; Construction and the Built Environment; **Cyber Security**;
**Data Science**; Early Learning and Childcare; Engineering: Design and Manufacture; Engineering:
Instrumentation, Measurement and Control; **IT: Management for Business**; **IT: Software
Development**; Operating Department Practice; Social Work.
Data-relevant for a Sept 2027 school leaver: Data Science (BSc Hons, SCQF 10, up to 4 yrs),
IT: Software Development (SCQF 10), Cyber Security (SCQF 10/11), Business Management: Business
Analysis (SCQF 10), IT: Management for Business (SCQF 10). Framework pages:
`https://www.apprenticeships.scot/graduate-apprenticeships/<slug>/individual/`.
Also relevant MA (non-degree, SCQF 8): "Digital Technology" with pathway
**"Diploma in Digital Technology: Data Analytics"** (412 provider rows: QA Ltd, City of Glasgow
College, BPP, Elite Training, Genius People, Sixth Sense, Highland Learning Academy...).

#### GA Data Science universities (from learningproviders API, 2026-10-09)
Glasgow Caledonian University, Heriot-Watt University, University of Stirling, Edinburgh Napier
University, Robert Gordon University (all "Data Science (Graduate Apprenticeship at SCQF 10)",
Location "All").
- Cyber Security GA: Edinburgh Napier (10), Strathclyde (11), RGU (11), GCU (10 and 11).
- IT: Software Development GA: GCU, Glasgow, Heriot-Watt, Strathclyde, UHI, UWS, Napier, Dundee.
- Business Management / Business Analysis / IT Mgmt for Business GA: Heriot-Watt, GCU, QMU, UWS.
Employers offering GA Data Science are *not* listed anywhere structured; they appear only as
vacancies. Today the single GA data vacancy is **Thales Group, "2027 AI Engineer Apprentice"**
(ref 167315, Glasgow, GCU, closes 2026-12-01, listed under the Engineering IMC framework but
described as "AI and Data Science Graduate Level Apprenticeship", applies via Workday).

#### Snapshot counts (2026-10-09)
Total 119 (GA 4, MA 115, FA 0). GA: 3x Stantec civil engineering + Thales AI. JobFamily
"Computing and ICT": 4 MA (IT support/helpdesk roles). Keyword "data": 15 hits (mostly admin noise).
Expect GA volume to spike Jan–Mar for Sept starts; today's total is low because it's early in the
cycle.

### 1b. api.myworldofwork.co.uk (SDS's external aggregated feed) — secondary

The same search page merges in "External" vacancies from SDS's My World of Work job feed
(Adzuna-sourced, ids like `ADZ-7769-...`, plus mirrored `APS-<RefCode>` copies of apprenticeships.scot
vacancies which the site filters out with `id.includes("APS-")`).
- `GET https://api.myworldofwork.co.uk/job-vacancies/Search?pageSize=10000&page=1&vacancyType=Apprenticeship&api-version=1.0[&searchTerm=data][&location=Glasgow&distance=15]`
  Header `Ocp-Apim-Subscription-Key: fb34d116b57e46a29eb2f28fbfc7b7a9` (from the same JS bundle).
  Response `{pageNumber,pageSize,totalPages,count,facets{vacancyType,employmentHours,contractType,workLocation},
  vacancies[{id,title,description(html),salary(text),contractType[],employmentHours[],companyName,
  localAuthority,location{latitude,longitude},displayLocation,...}]}` — 176 apprenticeship rows today,
  49 match "data" (loose). Includes a second Thales listing for the same AI/Data Science GA.
- Detail: `GET https://api.myworldofwork.co.uk/job-vacancies/<id>?api-version=1.0` (gives `url`, `closingDate`).
Usefulness: low-to-medium; it duplicates Adzuna, which you may already cover in England. Worth a
`searchTerm` sweep for "graduate apprenticeship" to catch GA roles advertised only on employer sites.

### 1c. myjobscotland.gov.uk (COSLA — councils, NHS boards, some third sector)

New Drupal 10/11 site deployed Sept 2026 (banner: "new site ... known issues"). Search is
**server-rendered** (results in HTML; JS only enhances via `_wrapper_format=drupal_ajax`).
- robots.txt: standard Drupal; `/search/` is disallowed but the search path is `/search-jobs` (allowed).
  No crawl-delay. No RSS/JSON feed found (`/jobs/rss`, `/jobs/feed`, `/jsonapi` all 404).
- Search: `GET https://www.myjobscotland.gov.uk/search-jobs?keyword=apprentice&page=0`
  - `keyword` (full-text), `location`, `distance` (5|10|20|50|200), `sort` (`sort-closing-date-sooner`,
    `sort-job-added-old`, `sort-title-a-z`, ...), `page` **0-indexed**, 25 per page.
  - Facets are query params named by `data-facet` with the numeric `value` from the page's checkbox
    inputs: `contract_type=8727` (Apprenticeship), `categories=2099` (Modern Apprenticeship / Trainee),
    `categories=2092` (IT / Telecommunications), `position_type=7014` (Full Time). Multi-value: repeat
    param (**UNVERIFIED** — the JS keeps an array; test `categories=2099&categories=2092`).
    Note: `keyword=` (empty) combined with a facet returns 0 — omit `keyword` when empty.
  - Result card: `.mjs-card` with `h3.mjs-card__title a[href]` (absolute URL
    `https://myjobscotland.gov.uk/<org-type>/<org-slug>/jobs/<slug>-<id>`), "Published by <org>",
    `.mjs-card__description p` (location), `.mjs-card__tags` (Full Time / Apprenticeship / salary / "Closing on dd/mm/yyyy"),
    `Ref #...`, `data-job-id`.
  - Count text: "Showing 1 - 25 of 2173 available jobs".
- Detail pages carry a proper **schema.org JobPosting JSON-LD** (`title, datePosted, validThrough,
  employmentType, baseSalary{min,max,unitText}, hiringOrganization{name,url,logo}, description`).
- Snapshot: 2,173 jobs; `contract_type=8727` -> 5 apprenticeships (all council MAs: business
  support, customer services, countryside ranger, building maintenance); "keyword=graduate apprentice"
  207 hits are mostly noise (the keyword search is OR-ish). `keyword=data&contract_type=8727` -> 3,
  none actually data roles. Low value for data science but cheap to include (1 request/day on
  `contract_type=8727` + `categories=2099`).
- No T&Cs page found (`/terms-and-conditions` 404); only `/privacy-and-cookies`. Public-sector site.

### 1d. SDS open data
No vacancy open-data feed exists. SDS publishes only statistics (quarterly MA stats PDFs/XLSX,
annual GA report + supplementary tables at
`https://www.skillsdevelopmentscotland.co.uk/publications-statistics/statistics/graduate-apprenticeships/`).
data.gov.uk has nothing for Scotland (only SFA England datasets). The de-facto "open" feed is the
APIM endpoint above.

---

## 2. Wales

### 2a. Careers Wales apprenticeship search — primary (and effectively only) source

- `ams.careerswales.com` (old Apprenticeship Matching Service) now 301s to `https://careerswales.gov.wales/`.
  `apprenticeships.gov.wales` does not resolve (DNS fail). The live search is
  `https://careerswales.gov.wales/apprenticeship-search` (Welsh: `gyrfacymru.llyw.cymru/chwilio-am-brentisiaethau`).
- The page is a React SPA shell (`<div id="root">`, bundle at
  `https://careerswales.gov.wales/apprenticeship-search/static/js/main.58a8d233.js`). No JSON-LD,
  no server-rendered results. Public result routes: `/apprenticeship-search/results?keywords=...&level=4&sector=10`
  and detail `/apprenticeship-search/results/<slug>`.
- robots.txt (careerswales.gov.wales): standard Drupal; `/apprenticeship-search` not disallowed.
  `api.careerswales.gov.wales` has no robots.txt (404). The API is served by istio-envoy, returns
  `vary: Origin`, but **accepts any/no Origin and no auth** (verified 200 with foreign Origin and with none).
- T&Cs (`/about-us/terms-and-conditions` 4.2): material may be used "only for personal and research
  use ... not for commercial or business use ... may not re-distribute or re-publish". A private
  aggregator for one applicant fits "personal and research use"; don't republish publicly.

#### API (verified)
Base: `https://api.careerswales.gov.wales/apprenticeships-api/api/v1/apprenticeships`

1. **Search**: `GET {base}/q?<params>` — **query params** (qs `arrayFormat: repeat`):
   `keywords`, `apprenticeshipLevel` (1=Foundation L2, 2=Apprenticeship L3, 3=Higher L4-5, 4=Degree L6; repeatable),
   `apprenticeshipSector` (ids below; repeatable), `location` (text), `apprenticeshipProximity`
   (1=5mi, 2=20mi, 3=50mi, 4=Wales), `apprenticeshipHours`, `apprenticeshipWelshLanguage`,
   `apprenticeshipDisabilityConfident`, `id` (vacancy id).
   **Paging/sort go in HTTP headers, not params**: `Accept-Language: en|cy`, `page: 1` (1-indexed),
   `groupSize: 10` (site uses 10, map view uses 999; 100 verified), `order: rel | closingDateAsc |
   closingDateDesc | distanceNearest` (the UI's `sort` default is `rel`; `closingDateSoon`,
   `relevance`, `date` -> HTTP 500). Omit `order` for relevance.
   Response: `{"results":42,"pages":5,"data":[{id,slug,slugTrans,title,employer,closingDate(ISO Z),
   location,coordinates:"lat,lon",apprenticeshipLevel(1-4),payDetails,distance,score}]}`.
   **No results -> HTTP 204 with empty body** (not an empty array) — handle that.
   Note: the legacy param names `level=`/`sector=` are silently ignored; use the `apprenticeship*` names.
2. **Detail**: `GET {base}/<slug>` with `Accept-Language: en` (numeric id -> 404; must be slug).
   Fields: `id,title,apprenticeshipLevel,slug,slugTrans,pay,closingDate,hours,positions,
   about{duties,additionalInformation},requirements{requiredQualifications,desirableQualifications,skills,
   welshLanguage[],welshSpoken,welshWritten},training{trainingProvider,trainingProviderCourse},
   apprenticeshipDisabilityConfident,employerDetails{name,address{addressLine1,addressLine2,locality,postCode},mapLink},
   apply{format:"url"|"email",url,email,additionalInstructions},interview`.
3. **Filters/lookup**: `GET https://api.careerswales.gov.wales/filters-api/api/v1/filters?filters=apprenticeshipLevel&filters=apprenticeshipSector&filters=apprenticeshipProximity&filters=apprenticeshipHours`
   (header `Accept-Language: en`; with no `filters` param -> 400). Sector ids: 1 Advanced Manufacturing,
   2 Agriculture, 3 Automotive/Transport, 4 Business and Management, 5 Catering, 6 Childcare,
   7 Construction, 9 Creative/Design/Media, **10 Digital Technology**, 11 Education & Information
   Services, 12 Energy, 13 Engineering, 14 Food & Drink, 15 Hair & Beauty, 16 Health & Social Care,
   17 Legal & Financial, 18 Life Sciences, 19 Property, 20 Protective, 21 Public Services, 22 Retail,
   24 Travel/Tourism, 25 Healthcare.
4. Settings/CMS blob (not needed): `GET https://careerswales.gov.wales/api/v1/settings/apprenticeship-search`.

#### Snapshot (2026-10-09)
42 live vacancies in all of Wales: level 1: 29, level 2: 10, level 3 (Higher): 2, level 4 (Degree): 1.
Digital Technology sector: 2 — "Apprentice Software Developer" (Border Merchant Systems, Monmouth,
L3) and "IT Technician" (Ysgol Maesydderwen, L2). The only degree apprenticeship is Occupational
Therapy (Powys CC / Wrexham Uni). Keyword "cyber"/"analyst" -> 204 (none). So Careers Wales is a
tiny feed; poll once daily with `apprenticeshipLevel=3&apprenticeshipLevel=4` and
`apprenticeshipSector=10`, plus a few keywords.

### 2b. Degree apprenticeships in Wales (context)
Medr-funded degree apprenticeships exist only in **digital, engineering, construction, advanced
manufacturing** (careerswales.gov.wales/apprenticeships/degree-apprenticeships). Delivering
universities: Bangor, Cardiff Met, Cardiff (Engineering), Swansea, OU in Wales, USW, UWTSD, Wrexham.
Applicants must be 18+ and working in Wales 51%+ of the time; vacancies are advertised by employers
"in the same way as a normal job", i.e. mostly on employer sites/Indeed, not on Careers Wales.
Which specific data-science degree apprenticeships each Welsh university runs: **UNVERIFIED** (not
fetched; Cardiff Met and USW historically ran Data Science / Applied Software Engineering DAs).
Practical implication: for Wales, employer-site scraping (ATS feeds) matters more than the national
portal.

---

## 3. Northern Ireland

### 3a. JobApplyNI (Department for Communities) — the official vacancy board
nidirect's "Search for apprenticeship opportunities" page simply links to
`https://www.jobapplyni.com/` (HLAs included). Details:
- ASP.NET Core Razor Pages; **server-rendered HTML**, jQuery/Bootstrap, no API, no JSON-LD, no sitemap,
  **robots.txt is 404** (no restrictions declared). Terms link goes to communities-ni.gov.uk generic
  T&Cs (Crown copyright; no anti-scraping clause found). It is a public-sector site; be polite.
- Search is a GET on `/`:
  `https://www.jobapplyni.com/?sector=Apprenticeships&DoSearch=true&CurrentPage=1`
  Params: `keyword` (title/company/location/ID), `sector` (repeatable; values = option text, e.g.
  `Apprenticeships`, `IT`, `Engineering`), `location` (`Belfast`, `Co Antrim`, `Co Armagh`, `Co Down`,
  `Co Fermanagh`, `Co Tyrone`, `Derry or Londonderry`, `Jobs based across Northern Ireland`),
  `Filter=Closing%20Soon`, `CurrentPage` (1-indexed; ~10 results/page — the page also injects a few
  "you may also be interested" cards, so count real cards by their `/Vacancy/VacancyDetail?Id=` links
  within `.card` blocks and use the `<h1>` "N jobs" total). Advanced-search selects also exist for
  wageBand/positionType/jobType/jobCategory (names seen in JS; option values **UNVERIFIED**).
- Result card: `h2.card-title a[href="/Vacancy/VacancyDetail?Id=<id>&..."]`, `p.h5` = employer,
  `<dl>`: Vacancy ID, Salary, Area, Location, Hours, Closing date ("13 Oct 2026").
- Detail: `GET /Vacancy/VacancyDetail?Id=<id>` -> `<dl>` with Vacancy ID, Job ref., Job Sector,
  Area, Location, Salary, No. vacancies, Contract Type, Weekly hours, Published date (dd/mm/yyyy),
  Closing date, Worktime; plus free-text Job description / Responsibilities / Requirements.
  Employer address is in a modal. Apply requires login (ignore; link to the page).
- Snapshot: 934 jobs total; `sector=Apprenticeships` -> 8: six **Thales UK Belfast 2027 HLAs**
  (Project Planning & Controls; L5 Mechatronics; L3 Manufacturing; L6 ILS Engineering; L5/L6 Academy
  Engineer Mechatronic), plus Starbucks barista and a butcher. `keyword=data` -> 3 (non-apprentice
  analyst jobs). `sector=IT` -> 4. No data-science HLA vacancies today.

### 3b. How HLAs in data/computing are actually advertised
NI has no central HLA vacancy feed. The model is: FE colleges/universities run cohort recruitment
and match applicants to employer partners, so vacancies are often **college application portals**,
not job ads.
- nidirect `articles/higher-level-apprenticeships` holds the authoritative **table of HLAs by
  sector/level/provider** (static HTML, easy to parse). ICT rows (2026-10-09):
  - L5 Cloud Computing with Cyber Security — Northern Regional College
  - L5 Cloud Computing, Analytics and Security for Industry — Southern Regional College
  - L5 Computing — NRC, North West Regional College, South West College
  - L5 Cyber Security — NWRC
  - L5 Cyber Security with Cloud and Network Infrastructure — Belfast Met
  - **L5 Software and Cloud Development with Data Analysis — Belfast Met** (FdSc, validated by OU)
  - L6 Cloud Computing with Cyber Security (Top-up) — NRC; L6 Computing for Industry (Top-up) — SRC;
    L6 Computing Science (Top-up) — SWC; L6 Computing Systems — Ulster; L6 Software Engineering — QUB
  - **L6 Software and Cloud Development with Data Science (Top-up) — Belfast Met**
  - L7 Artificial Intelligence — Ulster; L7 Computer Science — Ulster
  - Business: L5 FinTech (SRC), L6 Financial Technology / Business Technology (Ulster), L7 International
    Accounting with Analytics (Ulster), L7 FinTech / Business Technology (Ulster).
- **Belfast Met IT Apprenticeship** (`belfastmet.ac.uk/apprenticeships/it-apprenticeship/`): "over 50
  IT Apprenticeship roles" per cycle across L3/L5/L6 with employers incl. Allen & Overy, BBC, BT, Citi,
  EY, Fujitsu, NICS, NI Water, QUB, Randox, Rapid7, Version 1. **Applications open 24 Jan 2026 for the
  2026 cohort** (expect ~Jan 2027 for 2027) via `https://belfastmet.mindmill.co.uk/` (Mindmill
  recruitment portal, server-rendered, lists the courses incl. the Data Analysis FdSc). Contact
  `ITApprenticeship@belfastmet.ac.uk`. Monitor this page for the opening date rather than scraping.
- Ulster (`ulster.ac.uk/apprenticeships`), QUB and OU pages return 403/404 to curl (WAF); content
  **UNVERIFIED** here. Ulster/QUB HLAs are typically employer-nominated (apply to the employer).
- Large NI employers that post HLAs on their own ATS: Thales (Workday — also on JobApplyNI), Citi,
  PwC, Allstate, Kainos, Liberty IT, FinTrU, Version 1, NICS (NICS recruitment site). These are
  better covered by your employer/ATS scrapers than by any NI portal.
- NI statistics only: economy-ni.gov.uk HLA bulletins + NISRA datavis (no vacancy data).

---

## 4. Implementation notes for the Node/TS scraper

- **Scotland (SDS APIM)**: 1 POST/day with `take: 200`, `apprenticeshipTypeFacet: ""`; filter
  locally on `VacancyType === "GA"` or JobFamily in {Computing and ICT, Engineering, Financial
  Services, Administration...} plus title/description regex (data|analy|AI|machine learning|software|
  cyber|digital). Then `GET /vacancy/vacancy/ref/<RefCode>` only for new RefCodes (gives
  `frameworkName`, `applicationWebAddress`). Dedupe key: `RefCode`. Re-scrape the subscription key
  from `/find-a-vacancy/` -> `/_astro/VacancySearchApp.*.js` on 401. Cache the framework and
  learning-provider indexes weekly (they change rarely).
- **myworldofwork**: optional 1 GET/day `vacancyType=Apprenticeship&pageSize=10000`; filter ids not
  starting with `APS-`; dedupe against Adzuna if you ingest that elsewhere.
- **myjobscotland**: 2 GETs/day (`contract_type=8727`, `categories=2099`); parse cards; fetch
  JSON-LD from detail only for new ids. Use `page` 0-indexed.
- **Wales**: 2–3 GETs/day to `/q` with headers `Accept-Language: en`, `groupSize: 100`, `order:
  closingDateAsc`; treat 204 as empty. Detail by `slug`. Dedupe key: numeric `id`.
- **NI**: 2 GETs/day to jobapplyni (`sector=Apprenticeships`, `sector=IT`) + paging while
  `CurrentPage` links exist; parse `<dl>`; detail only for new `Id`. Also a weekly fetch of the
  nidirect HLA article and the Belfast Met IT Apprenticeship page diffed for "applications open".
- UA: something like `apprenticeship-finder/1.0 (+mailto:you@example.com)`; retry with backoff; all
  three nations' totals are small, so a full daily refresh is <20 requests.
- Keys/IDs above are copied from public client bundles on 2026-10-09; store them in config, not code.

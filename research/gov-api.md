# UK Government apprenticeship data sources: research notes

Researched and checked on **2026-10-09**. Every item below was fetched live that day unless it is marked **UNVERIFIED**.
Scope: England only. Find an apprenticeship (FAA) and Skills England cover England. Scotland, Wales and NI run separate systems.

---

## 1. Find an apprenticeship: Display Advert API

### 1.1 Status and version

- **Current version: v2.** The developer hub home page (https://developer.apprenticeships.education.gov.uk/) says: "The new API version (version 2) lets you display apprenticeships that are available in more than one location. You must update to this new version by **1 April 2026**."
  - An older copy of the page, seen in search snippets, gave **30 January 2026**. The live page says 1 April 2026. Either way, the deadline has passed, so **build against v2 only.**
- v2 docs (Stoplight UI): https://developer.apprenticeships.education.gov.uk/Documentation/display-advert-api-v2
- **Machine-readable OpenAPI 3.0.1 spec (v2):** https://developer.apprenticeships.education.gov.uk/Documentation/display-advert-api-v2/description. This is the source of everything in section 1.4 onwards. Download it for codegen.
- v1 docs/spec, kept for reference: https://developer.apprenticeships.education.gov.uk/Documentation/display-advert-api-v1 (spec at `.../display-advert-api-v1/description`).
- Versioning policy: "After a new release version of the API, the old version will be maintained for 3 months only."
- **UNVERIFIED:** whether v1 still serves data. Without a key, both `X-Version: 1` and `X-Version: 2` return 401, so the auth check runs before version routing.
- Other APIs on the hub (Recruitment, Track Apprenticeship Progress) need an employer or provider key and **aren't available to independent developers**: "If you're working on your own, You can only use the Display Advert API."

### 1.2 Base URL, headers and auth

| Item | Value |
|---|---|
| Base URL (from the OpenAPI `servers`) | `https://api.apprenticeships.education.gov.uk/vacancies` |
| Auth header | `Ocp-Apim-Subscription-Key: <key>` (Azure API Management) |
| Version header | `X-Version: 2` (a whole number, required) |
| Format | REST + JSON (`application/json; ver=2`) |
| CORS | **Not enabled.** The spec says don't call it from a browser: "call the API intermittently to retrieve the latest vacancies, store those vacancies in your own data store." |

Live probe on 2026-10-09:
- `GET /vacancies/vacancy` with no `X-Version` header returns **404** (empty body). This matches the docs: missing or invalid version gives 404.
- With `X-Version: 2` and no key, it returns **401** `{"statusCode":401,"message":"Access denied due to missing subscription key..."}`, with header `www-authenticate: AzureApiManagementKey realm="https://gateway.apprenticeships.education.gov.uk/vacancies",name="Ocp-Apim-Subscription-Key",type="header"`.

The hub's key-security advice is not to embed keys in code or the source tree, to use env vars or config, and to regenerate keys regularly.

### 1.3 Getting a key as a member of the public

- The "If you're working on your own" route on the developer hub lets you **create an account** at https://developer.apprenticeships.education.gov.uk/third-party-accounts/register and then sign in at `/third-party-accounts/sign-in` to see the key.
- Registration form fields (verified): **first name, last name, email, password, confirm password**. The password needs upper and lowercase letters, a number and 8+ characters. Continuing means you accept the terms of use.
- No eligibility criteria, organisation details or approval step appear on the form or the hub.
- **UNVERIFIED: how long it takes.** No official source states a turnaround. The form has no approval or vetting step, which suggests self-service, probably instant or after email verification. I didn't create an account to confirm this. **Register early** in case there's a manual step.
- The older GOV.UK guidance "Display adverts from Find an apprenticeship if you don't have an apprenticeship service account" was **withdrawn on 22 Sep 2025** and now points to FAA: https://www.gov.uk/guidance/display-adverts-from-find-an-apprenticeship-if-you-dont-have-an-apprenticeship-service-account

### 1.4 Rate limits

From the developer hub home page: "You can make up to **150 requests within a 5 minute period**." Going over returns **429**, and the limit resets at the end of the 5-minute window.
→ With `PageSize=100`, a full sync of about 4k live vacancies takes about 40 calls, which is fine. Throttle to about 1 request every 2 seconds for safety.

### 1.5 Endpoints (v2 OpenAPI)

All paths are relative to `https://api.apprenticeships.education.gov.uk/vacancies`, and all need the `X-Version` header.

| Method + path | Purpose |
|---|---|
| `GET /vacancy` | List or search vacancies (paged) |
| `GET /vacancy/{vacancyReference}` | One vacancy. Returns 404 if not found. The spec gives the format example as `10001122`. |
| `GET /referencedata/courses` | All training courses: `{trainingCourses:[{larsCode, title, route, type}]}`. **This is the LARS-code lookup.** |
| `GET /referencedata/courses/routes` | Route names (the spec's response schema shows a single `{name}`, but it's presumably a list), used in the `Routes` filter |
| `GET /accountlegalentities` | Employer or provider keys only. Third parties get **403**. |

**UNVERIFIED:** the exact `vacancyReference` format for v2. The FAA website uses `VAC2000054344` in URLs (`/apprenticeship/VAC2000054344`), while the spec example is `10001122`. Use whatever the list endpoint returns in `vacancyReference`.

### 1.6 `GET /vacancy` query parameters (v2, verbatim semantics from the spec)

| Param | Type | Notes |
|---|---|---|
| `PageNumber` | int | Defaults to 1 |
| `PageSize` | int 1–100 | Defaults to 10, **max 100** |
| `Sort` | enum | `AgeDesc` (newest first, the **default**), `AgeAsc`, `DistanceAsc` / `DistanceDesc` (only with Lat+Lon+DistanceInMiles), `ExpectedStartDateDesc` ("closest to starting"), `ExpectedStartDateAsc` |
| `Lat`, `Lon` | double | Must be supplied with each other and with `DistanceInMiles` |
| `DistanceInMiles` | int | Radius |
| `PostedInLastNumberOfDays` | int | Posted within the last N days |
| `StandardLarsCode` | int[] (repeat the param) | E.g. `StandardLarsCode=337&StandardLarsCode=80`. **If supplied, `Routes` is ignored.** |
| `Routes` | string[] (**max 2**) | Route names from `/referencedata/courses/routes` (e.g. presumably `Digital`) |
| `ExcludeRecruitingNationally` | bool | `true` returns only non-national adverts. Unset or `false` returns everything. (Replaces v1's `NationWideOnly`; the spec's example text still uses the old `NationWideOnly=true`, which is a stale example.) |
| `EmployerName` | string | Fuzzy: "doesn't need to be exact, as we'll match it to the closest employer" |
| `Ukprn` | int | Filter by training provider |
| `IncludeDetails` | bool | If `PageSize` ≤ 100 and this is `true`, the full-text fields are returned (description, training, etc.) |
| `FilterBySubscription`, `AccountLegalEntityPublicHashedId` | | For employer or provider keys only |
| Header `AdditionalDataSources` | enum[] `Nhs`, `Csj` | Pulls in extra vacancy sources. **UNVERIFIED meaning.** Most likely NHS Jobs and Civil Service Jobs apprenticeships. Worth testing with `Nhs,Csj`. |

**NOT supported by the API (do these yourself):**
- **No postcode parameter.** Geocode first. postcodes.io works with no key, e.g. `https://api.postcodes.io/postcodes/LS14BN` gives lat 53.7948, lon -1.5537 (verified).
- **No level filter.** Filter client-side on `course.level` or `apprenticeshipLevel`. Alternatively pass `StandardLarsCode`s, which fixes the level implicitly.
- **No keyword or free-text search** (only `EmployerName`). Do keyword matching on title or description locally.
- **No closing-date or wage sort.** Do these locally.

Official examples from the spec:
```
/vacancy?Lat=52.408056&Lon=-1.510556&Sort=DistanceAsc&DistanceInMiles=20&StandardLarsCode=123&StandardLarsCode=345
/vacancy?PageNumber=5&PageSize=10&Routes=example&NationWideOnly=true&PostedInLastNumberOfDays=30
```

### 1.7 Response shape (v2)

`GET /vacancy` returns a `GetVacanciesDetailsListResponseV2`:
```json
{ "vacancies": [ <GetVacancyResponseV2>, ... ], "total": 0, "totalFiltered": 0, "totalPages": 0 }
```

`GetVacancyResponseV2`, which is also what `GET /vacancy/{ref}` returns. The field notes are paraphrased from the spec.

| Field | Type | Notes |
|---|---|---|
| `title` | string | ≤100 chars |
| `description` | string | Short summary, ≤350 chars |
| `numberOfPositions` | int64 | ≥1 |
| `postedDate` | date-time | Date added to FAA |
| `closingDate` | date-time | "Will always be more than 2 weeks after the posted date" |
| `startDate` | date-time | Planned start |
| `wage` | object | `wageType` (`ApprenticeshipMinimum`, `NationalMinimum`, `Custom`, `CompetitiveSalary`), `wageAmount` (annual figure when `Custom`, nullable), `wageUnit` (`Unspecified`, `Weekly`, `Monthly`, `Annually`), `wageAdditionalInformation` (≤250), `workingWeekDescription` (≤250) |
| `hoursPerWeek` | double | Work plus training |
| `expectedDuration` | string | E.g. "21 months" |
| `addresses` | array | `{addressLine1..4, postcode, latitude, longitude}`. Multi-location in v2. Sorted by distance if you passed lat/lon. **Empty when `isNationalVacancy` is true.** |
| `distance` | double (miles) | Only when lat/lon was supplied |
| `applicationUrl` | string | Where to apply. Often the employer's ATS. |
| `vacancyUrl` | string | FAA page for the advert |
| `vacancyReference` | string | Unique ref |
| `employerName`, `employerWebsiteUrl`, `employerDescription` (≤4000) | string | |
| `employerContactName` / `Phone` / `Email` | string | Contact at the employer or provider |
| `course` | object | `{larsCode:int, title:"Furniture restorer (level 3)", level:int, route:"Creative and design", type:"apprenticeship" or "foundationApprenticeship"}` |
| `apprenticeshipLevel` | string | intermediate (L2), advanced (L3), higher (L4–5), degree (L6–7). **Note that L6/7 counts as "degree" even when no degree is awarded.** |
| `providerName`, `ukprn` | | Training provider |
| `isDisabilityConfident` | bool | |
| `isNationalVacancy`, `isNationalVacancyDetails` | bool, string | Recruiting across England, remote or multi-site |
| `trainingDescription`, `additionalTrainingDescription`, `outcomeDescription`, `fullDescription`, `thingsToConsider`, `companyBenefitsInformation` | string | Long text. List calls probably need `IncludeDetails=true`. |
| `skills` | string[] | |
| `qualifications` | array | `{weighting:"Essential" or "Desired", qualificationType, subject, grade}`. Useful for A-level or GCSE requirement matching. |

Error body: RFC 7807 `ProblemDetails {type,title,status,detail,instance}`.

### 1.8 Example request and illustrative response

```bash
curl -s "https://api.apprenticeships.education.gov.uk/vacancies/vacancy?Lat=53.794763&Lon=-1.553732&DistanceInMiles=30&Sort=DistanceAsc&PageSize=100&StandardLarsCode=337&StandardLarsCode=80&StandardLarsCode=576&StandardLarsCode=828&IncludeDetails=true" \
  -H "X-Version: 2" \
  -H "Ocp-Apim-Subscription-Key: $FAA_API_KEY"
```

The response below is **illustrative, not a captured API response.** The shape comes from the v2 OpenAPI spec. The values come from the public FAA page for VAC2000054344 as of 2026-10-09. Fields I couldn't see are shown as `"…"`.
```json
{
  "vacancies": [{
    "title": "AI, Data and Conversion Apprentice",
    "description": "…",
    "numberOfPositions": 1,
    "postedDate": "2026-10-02T00:00:00Z",
    "closingDate": "2026-10-14T00:00:00Z",
    "startDate": "2026-11-16T00:00:00Z",
    "wage": { "wageType": "Custom", "wageAmount": 28000, "wageUnit": "Annually",
              "wageAdditionalInformation": "…", "workingWeekDescription": "…" },
    "hoursPerWeek": 36,
    "expectedDuration": "…",
    "addresses": [{ "addressLine1": "…", "addressLine2": "…", "addressLine3": "…", "addressLine4": "…",
                    "postcode": "LS1 4BN", "latitude": 53.79, "longitude": -1.55 }],
    "distance": 0.6,
    "employerName": "RH BRAND AMBITION LIMITED",
    "course": { "larsCode": 828, "title": "Artificial intelligence (AI) and automation practitioner (level 4)",
                "level": 4, "route": "Digital", "type": "apprenticeship" },
    "apprenticeshipLevel": "…(higher; exact casing unverified)",
    "providerName": "…", "ukprn": 0,
    "isDisabilityConfident": false,
    "vacancyUrl": "https://www.findapprenticeship.service.gov.uk/apprenticeship/VAC2000054344",
    "vacancyReference": "…",
    "isNationalVacancy": false,
    "qualifications": [], "skills": []
  }],
  "total": 0, "totalFiltered": 0, "totalPages": 1
}
```

### 1.9 Terms and conditions on reuse

API terms: https://developer.apprenticeships.education.gov.uk/third-party-accounts/terms-conditions (full text checked).

- By calling the API you agree to the terms. DfE will email you about new versions, support old versions for 3 months, and give notice before retiring the API.
- There's no guarantee of availability or accuracy, and DfE has no liability for downtime, data delays or reliance on the content.
- **Don't** share your key, **don't mislead people** using the content, and **don't disrupt** others (e.g. "consistently exceeding your usage rate"). DfE "may block you" for misuse.
- **Nothing in the terms prohibits** storing, caching or redisplaying the data, and the spec actively recommends storing vacancies locally. No attribution or link-back requirement is stated.
- The site footer says "All content is available under the **Open Government Licence v3.0**, except where otherwise stated", with Crown copyright. OGL allows reuse, including commercially, with attribution ("Contains public sector information licensed under the Open Government Licence v3.0"). Good practice is to always link `vacancyUrl` and `applicationUrl` back to the source.
- Privacy: use of the APIs may fall under the DfE privacy notice for stakeholders. The data includes named employer contacts, so handle it accordingly.

---

## 2. Skills England standards relevant to data science

Source: the **Skills England (ex-IfATE) apprenticeship standards API**, which needs **no key**:
- `GET https://skillsengland.education.gov.uk/api/apprenticeshipstandards` returns a JSON array of every standard version (2,032 records, about **79 MB**, observed 2026-10-09). Query params such as `?route=` are ignored. The old `instituteforapprenticeships.org/api/...` URL redirects here.
- `GET https://skillsengland.education.gov.uk/api/apprenticeshipstandards/ST0585` returns the current version of one standard (observed: returns v1.1).
- Useful fields: `referenceNumber`, `larsCode`, `version`, `level`, `title`, `status`, `route`, `integratedDegree` (`integrated degree`, `non-integrated degree`, `non-degree qualification`, or empty), `integration`, `earliestStartDate`, `latestStartDate`, `typicalDuration` (months), `maxFunding`, `options`, `typicalJobTitles`, `standardPageUrl`, `careerStarter`.
- Standard page URL pattern: `https://skillsengland.education.gov.uk/apprenticeships/st0585-v1-1`
- The Skills England "RSS feed" (https://skillsengland.education.gov.uk/apprenticeships/rss-feed/) is a **standards-change feed, not vacancies**.

`larsCode` here is the same LARS standard code the FAA API uses in `StandardLarsCode` and `course.larsCode`. Cross-check against `GET /referencedata/courses` once you have a key. That check is **UNVERIFIED** because I had no key, but it's the same LARS identifier.

### 2.1 Core data and AI standards (all route "Digital")

"Degree?" uses Skills England's `integratedDegree` field. **Integrated degree** means the apprentice gets a bachelor's or master's degree. **Non-degree** means L6/7 with no degree awarded, although FAA still labels it level "degree".

| Standard | Ref | LARS | Level | Degree? | Duration | Current version / status (as of 2026-10-09) | Notes for a Sept 2027 start |
|---|---|---|---|---|---|---|---|
| Data technician | ST0795 | **576** | 3 | No | 24 m | v1.1 approved (since 2025-08-20). v2.0 in development, no date. | Flagged as a "career starter" |
| Data analyst | ST0118 | **80** | 4 | No | 24 m | v1.1 approved (since 2021-06-01) | Most common data vacancy type |
| AI and automation practitioner | ST1512 | **828** | 4 | No | 18 m | **New:** first approved 2025-12-10, v2.1 from 2026-05-22 | The only new data/AI standard first approved in 2025–26 |
| Business analyst | ST0117 | **165** | 4 | No | 18 m | v1.2 runs to 2027-04-12, **v2.0 from 2027-04-13** (in development) | |
| Software developer | ST0116 | **2** | 4 | No | 24 m | v1.2 since 2025-12-10 | |
| Software development technician | ST0128 | **154** | 3 | No | 18 m | v1.1 | |
| Data engineer | ST1386 | **746** | 5 | No | 24 m | v1.0 runs to 2026-12-17, **v2.0 from 2026-12-18** | |
| **Data scientist (integrated degree)** | ST0585 | **337** | 6 | **Yes, integrated (BSc Data Science)** | 36 m | v1.1 since 2024-04-24 | Entry: "likely to include 3 A Levels with 1 STEM subject" (standard page). OfS is the EQA. |
| **Digital and technology solutions professional** | ST0119 | **25** | 6 | **Yes, integrated** | 48 m | v1.2 since 2023-09-01 | **Has a data specialism:** options are software engineering, IT consultant, business analyst, cyber security, **"computing data analyst professional"** and network engineering. Vacancies under LARS 25 cover all of these, so keyword-filter for data. |
| Machine learning engineer | ST1398 | **795** | 6 | **No (non-degree qualification)** | 24 m | v1.0 runs to 2026-12-10, **v2.0 from 2026-12-11** | First approved 2024-12-18 |
| AI data specialist → **AI technologist** | ST0763 | **561** | 7 | No (non-degree) | 24 m | v1.0 runs to 2027-04-26. **Renamed "AI technologist" v2.0 from 2027-04-27.** | Level 7 funding is age-limited (see 2.3) |
| DTS specialist (integrated degree) | ST0482 | **327** | 7 | Yes, integrated (MSc) | 18 m | v1.0 | Options include "Data Analytics Specialist". Usually for experienced staff or graduates, not school leavers. |
| Spatial data specialist | ST0957 | **756** | 7 | Yes (L7 integrated degree qualification) | 24 m | v1.1 | GIS/geospatial data science. Usually post-grad level. |

### 2.2 Adjacent data or quant standards (other routes)

| Standard | Ref | LARS | Level | Degree? | Route | Status |
|---|---|---|---|---|---|---|
| Professional economist (integrated degree) | ST0603 | 323 | 6 | Yes, integrated | Legal, finance and accounting | v1.0 approved (v2.0 in development) |
| Actuarial technician | ST0004 | 17 | 4 | No | Legal, finance and accounting | v2.0 from 2026-08-12 |
| High integrity software engineer | ST0013 | 38 | 6 | Yes, integrated | Engineering and manufacturing | v1.2 |
| Software tester | ST0129 | 91 | 4 | No | Digital | v1.1 |
| DevOps engineer | ST0825 | 548 | 4 | No | Digital | v1.1, v2.0 from 2026-12-18 |
| Intelligence analyst | ST0516 | 382 | 4 | No | Protective services | v2.0 from 2026-12-10 |
| Medical statistician | ST0892 | 669 | 7 | v1.0 integrated degree. v2.0 (from 2027-09-13) has a contradictory flag: "non-degree" but integration "Degree-apprenticeship". | Health and science | |
| Bioinformatics scientist | ST0649 | 406 | 7 | v1.0 non-integrated degree, v2.0 (from 2027-09-13) integrated | Health and science | |
| Operational research specialist | ST0884 | 600 | 7 | No | Business and administration | v1.2 |
| Actuary | ST0502 | 255 | 7 | No | Legal, finance and accounting | v2.0 |
| Actuarial analyst | ST1473 | (none yet) | 6 | (n/a) | Legal, finance and accounting | **In development, no LARS code yet.** Watch this one. |

**Suggested `StandardLarsCode` set for the tool:**
- Core: `337, 25, 80, 576, 746, 795, 828, 165, 2, 154, 561`
- Optional wider net: `323, 17, 38, 91, 548, 382, 327, 756, 669, 406, 600`

The API can't filter by level, but level is implied by the LARS code anyway.

### 2.3 Policy notes that affect a Sept 2027 school leaver

- **Level 7 funding is age-limited.** From 1 Jan 2026, L7 apprenticeships are only government-funded for apprentices **aged 16–21 at start**, or 22–24 with an EHC plan or care-leaver status. Sources: the DfE FE update of 22 Oct 2025 (https://www.gov.uk/government/publications/dfe-update-22-october-2025/dfe-update-further-education-22-october-2025) and the Funding Rules 2025–26. An 18–19-year-old is eligible, but employers have cut many L7 schemes, so expect fewer L7 vacancies.
- **Foundation apprenticeships** (L2, ages 16–21) exist and appear in FAA as `course.type = "foundationApprenticeship"`. They're not in the Skills England standards API dump and aren't relevant for a Y13 leaver.
- Several standards switch version between now and Sept 2027: Data engineer, ML engineer, Business analyst, and AI data specialist → AI technologist. Key the tool on **LARS code, not title**, because the LARS code stays the same across versions.

---

## 3. FAA website: alerts, RSS and coverage gaps

### 3.1 Saved searches, alerts and RSS

- **Saved-search alerts: yes, but you must sign in.** Every FAA results page has a "**Create an alert for this search**" link that goes to `/signin` (GOV.UK One Login). This was verified on https://www.findapprenticeship.service.gov.uk/apprenticeships?searchTerm=data&location=Leeds&distance=20
  - Alerts go by email. Third-party guides also mention SMS.
  - **UNVERIFIED:** alert frequency (daily or instant) and the exact delivery channels. No official help page describes them.
- **RSS: no.** There's no RSS link on FAA pages. The withdrawn GOV.UK guidance has a change note dated 1 Apr 2022: "Deleted information about the RSS feed and Av live legacy tools being turned off." Read via the GOV.UK content API: https://www.gov.uk/api/content/guidance/display-adverts-from-find-an-apprenticeship-if-you-dont-have-an-apprenticeship-service-account
  - The legacy vacancy RSS feed is therefore gone, and the API is the supported machine route.
- FAA account terms: users must be 13 or older. https://www.findapprenticeship.service.gov.uk/Home/terms-and-conditions
- FAA website search URL params can be used to deep-link users:
  - `searchTerm`, `location`, `distance` (2, 5, 10, 15, 20, 30, 40, `all`)
  - `levelIds` (2–7)
  - `routeIds` (**7 = Digital**, 12 = Legal, finance and accounting, 2 = Business and administration, 11 = Health and science, …)
  - `apprenticeshipTypes` (`Standard`, `Foundation`), `DisabilityConfident=true`, `ExcludeNational=true`
  - `sort` (`DistanceAsc`, `AgeAsc`, `ClosingAsc`, `SalaryDesc`, `ExpectedStartDateAsc`)
  - Vacancy page pattern: `https://www.findapprenticeship.service.gov.uk/apprenticeship/VAC2000054344`
- FAA counts observed 2026-10-09 (website, England):
  - all vacancies: **3,884**
  - Digital route: **129**
  - Digital + Level 6: **10**
  - keyword "data": **31**

### 3.2 Do large employers (banks, Big 4) list on FAA?

- **Many don't.** Schools' careers guidance routinely says "not all employers post their apprenticeship vacancies on this site" (e.g. https://commonweal.co.uk/where-to-look-for-apprenticeships/). I found **no official DfE statistic** on the share of vacancies missing.
- My own spot check, run 2026-10-09 by searching employer names on the FAA website, which is peak recruitment season for Sept 2027 degree apprenticeships:
  - **0 results** for PwC, KPMG, Deloitte, EY (the 10 "EY" hits were substring matches such as "EYFS"), Barclays, Lloyds Banking, NatWest, JP Morgan, Goldman Sachs, BT, Google, IBM, Capgemini, Accenture, Amazon, Rolls-Royce, BAE Systems and the Office for National Statistics.
  - **HSBC UK did list 5 degree apprenticeships** (Commercial and Retail Banking, start 12 Apr 2027).
  - Treat this as indicative: these were keyword or employer searches on one day.
- Implication for the tool: the FAA API alone will **miss most big-name data or tech degree apprenticeships**. Pair it with the following, all **not verified in this pass**:
  - Employer careers sites or ATS feeds
  - The UCAS apprenticeship search (has alerts)
  - RateMyApprenticeship
  - The Amazing Apprenticeships vacancy listings
  - Civil Service Jobs and NHS Jobs, which the API's `AdditionalDataSources: Csj, Nhs` header may partially cover

---

## Unverified or open items

1. How long it takes to get a key after registering. Self-service is likely, but I didn't test it.
2. Whether v1 still responds after the April 2026 cutover.
3. The `vacancyReference` format accepted by `GET /vacancy/{ref}` (with or without the `VAC` prefix).
4. The exact meaning and effect of the `AdditionalDataSources` header (`Nhs`, `Csj`).
5. The exact route name strings returned by `/referencedata/courses/routes`, and whether `/referencedata/courses` LARS codes match the Skills England `larsCode`s 1:1 (expected).
6. Whether list responses include long-text fields without `IncludeDetails=true`.
7. FAA alert frequency and channels.

The first time the key works, test 1–6 with a few calls.

---

## 4. Verified with a real key (2026-10-09, ~90 live calls)

The key in `.env` (`FAA_API_KEY`) works; every call below returned 200. This section supersedes the "unverified" list above.

| Question | Answer (verified) |
|---|---|
| Key turnaround | Instant after registering. |
| Headers | `X-Version: 2` + `Ocp-Apim-Subscription-Key` as documented. |
| `vacancyReference` format | Plain numbers, e.g. `2000041656` (no `VAC` prefix). `GET /vacancy/{ref}` accepts both `2000041656` and `VAC2000041656`. NHS extras use NHS refs like `C9824-26-0895`; Civil Service extras use short numbers like `483417`. Detail calls work for both when the `AdditionalDataSources` header is sent. |
| `IncludeDetails` | **Needed** for long text. Without it, list items lack `fullDescription`, `employerDescription`, `trainingDescription`, `outcomeDescription`, `qualifications`, `skills`, `thingsToConsider`. With it, payload is ~3.5× bigger. The single-vacancy endpoint always returns them. |
| `AdditionalDataSources: Nhs,Csj` | **Works.** Adds 26 vacancies today (3,694 → 3,720): ~22 NHS Jobs + ~5 Civil Service Jobs (e.g. DfE "Service Desk Analyst (L3 ICT)", DWP "Investigations – Operational Leader Apprenticeship", BEIS regulatory trainee, UKRI exec support). **These extras have `course.larsCode = 0`, `course.title = null`, `course.type = null`**, so a `StandardLarsCode` filter excludes them. `vacancyUrl` for extras is the bare FAA base URL (`/apprenticeship`), so use `applicationUrl` as the link. |
| Routes | 15 route names from `/referencedata/courses/routes`, e.g. `Digital`, `Business and administration`, `Health and science`. |
| Courses | `/referencedata/courses` returns 838 courses `{larsCode, title, route, type}`; LARS codes match Skills England 1:1 for all core codes (337, 25, 80, 576, 746, 795, 828, 561, 327, 165, 2). `type` values: `Apprenticeship` / `Standard` / `Foundation`. |
| `apprenticeshipLevel` values | `Advanced` (L3), `Higher` (L4–5), `Degree` (L6–7). Use `course.level` for the number. |
| Wages | **`wageAmount` is never populated** (0 of 3,720). The figure is only in `wageAdditionalInformation` free text, e.g. `"£20,400 a year"`, so parse salary from that string. `wageType`: `Custom`, `ApprenticeshipMinimum`, `NationalMinimum`. |
| `applicationUrl` | Often the employer's ATS (e.g. 7× `thales.wd3.myworkdayjobs.com`), otherwise training providers (QA, nowskills), Get My First Job, or empty. Useful for discovery (PLAN §6.5 D3). |
| `PostedInLastNumberOfDays` | Works (core codes, last 2 days → 7). |
| Totals | `total` 3,927 vs `totalFiltered` 3,694 even with no filters (gap of 233 unexplained; not national vacancies, which are only 6). Page through `totalFiltered`. |
| Foundation apprenticeships | 31 live (`course.type = "Foundation"`), not relevant; drop. |

### Counts today
- Core data LARS codes (337, 25, 80, 576, 746, 795, 828, 561, 327): **37 live vacancies**: data technician L3 ×15, AI & automation practitioner L4 ×7, DTS professional L6 ×6, data analyst L4 ×4, ML engineer L6 ×3, data engineer L5 ×1, data scientist L6 ×1.
- Notable L5–6: Thales 2027 Data Science / AI Engineer / ML / AI Researcher apprentices (Crawley, Templecombe; close 7–17 Feb 2027), Finyx Consulting Data Engineer L5 (York, closes 14 Oct 2026), Osborne Clarke Solutions L6 (Bristol, closes 31 Oct).

### LARS filtering misses real data jobs
A keyword scan of **all** vacancies found 16 data/AI/analyst titles filed under non-data standards, e.g. **"Data Analyst Apprenticeship Programme" at Howden (filed as Insurance practitioner L3)**, "Data & AI Apprentice" (Digital support technician L3), "HR Data & Systems Apprentice", Royal Navy Intelligence Analyst L4, Wolseley Business Analyst L4, and the DfE Civil Service vacancy (no course at all).

### Recommendation (adopted in PLAN §6.2)
Do a **full daily sync of every vacancy** (`PageSize=100`, `Sort=AgeDesc`, header `AdditionalDataSources: Nhs,Csj`, no LARS filter, no `IncludeDetails`): ~38 calls, ~1.5 min at 2 s spacing, well inside 150 per 5 min. Classify locally (LARS code **or** keywords), then call `GET /vacancy/{ref}` only for new relevant vacancies to get full text. This catches mis-filed data roles and the NHS/Civil Service extras that a LARS filter would drop.

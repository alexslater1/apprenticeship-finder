# Discovery sources: request details (verified 2026-10-10)

PLAN.md §6.5 asks for the exact SerpApi and Tavily parameters to be checked at build time. These
are what `sources/google-jobs.ts` and `sources/web-search.ts` use; queries live in
`config/discovery.json`.

## D1. Google for Jobs via SerpApi

- `GET https://serpapi.com/search.json?engine=google_jobs&q=…&location=United+Kingdom&gl=uk&hl=en&api_key=…`
  (one live request made 2026-10-10: 10 results, `jobs_results`, `filters`, `serpapi_pagination`).
- **Date filter:** there's no `date_posted` parameter any more (`chips` is deprecated). The
  response's `filters` array offers "Date posted" options whose `parameters.q` is the query with
  `since yesterday` / `in the last 3 days` / `in the last week` / `in the last month` appended,
  plus an opaque `uds` token. Appending the phrase to `q` is the stable route; we use
  `" in the last 3 days"`.
- **Pagination:** `start` is no longer supported; `serpapi_pagination.next_page_token` gives the
  next 10. We only read the first page per query (each page is a separate search on the bill).
  Cached repeats within an hour are free.
- **Result fields:** `title`, `company_name`, `location`, `via` (the board Google got it from),
  `description`, `extensions` (e.g. `"5 days ago"`, `"Full–time"`), `job_id`, `share_link`,
  `apply_options[{title, link}]`. `detected_extensions.posted_at` was absent in the sample;
  the age is in `extensions`.
- **Budget:** free plan 250 searches/month. 6 queries a day (+2 on Mondays) ≈ 200/month; the
  counter is `source_state['budget:serpapi']` and the source stops at 230.
- Apply links are often aggregators (Jobrapido, LinkedIn, StudySmarter); the employer's own ATS
  link, where present, is preferred and fed to employer detection (D3).

## D2. Open web search via Tavily

- `POST https://api.tavily.com/search`, header `Authorization: Bearer <key>`, JSON body
  `{query, search_depth: "basic", topic: "general", time_range: "week", country: "united kingdom",
  max_results: 10, include_domains?: [...]}`. `basic` costs 1 credit, `advanced` 2.
- Response `results[]`: `title`, `url`, `content`, `score` (`published_date` only with
  `include_published_date`).
- **Budget:** free plan 1,000 credits/month. 10 basic searches a day ≈ 300/month; counter
  `source_state['budget:tavily']`, stop at 900.
- ATS-domain searches (`include_domains`) return job URLs whose host alone identifies the
  connector (Workday tenant/site, tal.net board…), which makes strong suggestions.
- New result URLs (seen-set in `source_state['tavily:seen']`, 60 days) are fetched (robots
  respected, at most 12 a run): a JobPosting page becomes a listing (`source='web_search'`);
  other pages mentioning an apprenticeship plus data words become employer suggestions.

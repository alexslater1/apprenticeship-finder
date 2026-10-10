-- Each source's own Apply link (e.g. Not Going To Uni → QA's application page) and whether it
-- still works (pipeline/links.ts). A board can keep showing an advert after the employer or
-- training provider has closed it; the application page is the one that knows.
alter table public.listing_sources
  add column if not exists apply_url text,
  add column if not exists apply_status text check (apply_status in ('ok', 'dead', 'unknown')),
  add column if not exists apply_checked_at timestamptz;

-- Start dates known only to the year ("2027 Data Analyst Apprentice").
alter table public.listings drop constraint if exists listings_start_precision_check;
alter table public.listings
  add constraint listings_start_precision_check check (start_precision in ('day', 'month', 'year'));

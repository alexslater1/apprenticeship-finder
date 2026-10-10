import { hostOf, rankLinks, type EmployerRow, type ListingRow, type RankedLink } from '@af/shared';
import { ExternalLink, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SITE_NAMES: Record<string, string> = {
  'findapprenticeship.service.gov.uk': 'Find an apprenticeship (gov.uk)',
  'jobs.nhs.uk': 'NHS Jobs',
  'apprenticeships.scot': 'apprenticeships.scot',
  'careerswales.gov.wales': 'Careers Wales',
  'higherin.com': 'Higherin',
  'adzuna.co.uk': 'Adzuna',
  'reed.co.uk': 'Reed',
  'notgoingtouni.co.uk': 'Not Going To Uni',
  'amazingapprenticeships.com': 'Amazing Apprenticeships',
  'becomeanapprentice.qa.com': 'QA',
};

const siteName = (host: string) =>
  SITE_NAMES[host] ?? Object.entries(SITE_NAMES).find(([h]) => host.endsWith(`.${h}`))?.[1] ?? host;

function label(best: RankedLink, employer: string): { text: string; note?: string } {
  const site = siteName(best.host);
  switch (best.kind) {
    case 'official':
      return { text: `Apply on ${employer}’s site` };
    case 'government':
      return { text: `Apply on ${site}`, note: 'Official government service.' };
    case 'provider':
      return {
        text: `Apply through ${site}`,
        note: `${employer} recruits through this training provider, so this is the official route.`,
      };
    case 'board':
      return {
        text: `Open on ${site}`,
        note: `${site} is a job board, not ${employer}’s own site, and may ask you to sign up. Look for the advert on ${employer}’s careers site.`,
      };
    default:
      return {
        text: `Open on ${site}`,
        note: `This isn’t ${employer}’s site. Find the advert on ${employer}’s own careers site instead.`,
      };
  }
}

/** The best way to apply: the employer's own page first; boards and copy-sites only as a last resort. */
export function ApplyButton({ r, employer }: { r: ListingRow; employer?: EmployerRow }) {
  const careers =
    employer?.job_search_url ?? employer?.early_careers_url ?? employer?.manual_url ?? null;
  const hosts = [employer?.early_careers_url, employer?.job_search_url]
    .filter((u): u is string => !!u)
    .map(hostOf)
    .filter(Boolean);
  const best = rankLinks(r, hosts)[0];
  const search = `https://www.google.com/search?q=${encodeURIComponent(`${r.employer_name} ${r.title} apprenticeship`)}`;
  if (!best)
    return (
      <div className="grid gap-1">
        <Button asChild size="lg">
          <a href={careers ?? search} target="_blank" rel="noopener noreferrer">
            {careers ? `${r.employer_name} careers site` : 'Search for this advert'}{' '}
            <ExternalLink />
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          The links we had for this advert no longer work.
        </p>
      </div>
    );
  const { text, note } = label(best, r.employer_name);
  const weak = best.kind === 'board' || best.kind === 'third_party';
  return (
    <div className="grid w-full gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg" variant={weak ? 'outline' : 'default'}>
          <a href={best.url} target="_blank" rel="noopener noreferrer">
            {text} <ExternalLink />
          </a>
        </Button>
        {weak && (
          <Button asChild size="lg">
            <a href={careers ?? search} target="_blank" rel="noopener noreferrer">
              {careers ? (
                <>
                  {r.employer_name} careers site <ExternalLink />
                </>
              ) : (
                <>
                  <Search /> Find it on {r.employer_name}’s site
                </>
              )}
            </a>
          </Button>
        )}
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

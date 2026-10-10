import type { ListingRow } from '@af/shared';

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

export function formatSalary(
  r: Pick<ListingRow, 'salary_min' | 'salary_max' | 'salary_text'>,
): string | null {
  if (r.salary_min && r.salary_max)
    return `${gbp.format(r.salary_min)}–${gbp.format(r.salary_max)}`;
  if (r.salary_min) return gbp.format(r.salary_min);
  if (r.salary_text && r.salary_text.length <= 40) return r.salary_text;
  return null;
}

export function formatDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(opts.year || d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function closingLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return 'Closed';
  if (days === 0) return 'Closes today';
  if (days === 1) return 'Closes tomorrow';
  if (days <= 30) return `Closes in ${days} days`;
  return null;
}

export function levelLabel(level: number | null, isDegree: boolean | null): string {
  if (level === null) return isDegree ? 'Degree' : 'Level ?';
  return `L${level}${isDegree ? ' · Degree' : ''}`;
}

export function locationLabel(
  r: Pick<ListingRow, 'locations' | 'primary_city' | 'nation' | 'is_national'>,
): string {
  if (r.is_national) return 'Nationwide';
  const cities = [...new Set((r.locations ?? []).map((l) => l.city).filter(Boolean))];
  if (cities.length > 1) return `${cities[0]} +${cities.length - 1}`;
  return r.primary_city ?? (r.nation !== 'Unknown' ? r.nation : 'Location unknown');
}

export function milesLabel(d: number | null): string | null {
  if (d === null) return null;
  return d < 1 ? '<1 mi' : `${Math.round(d)} mi`;
}

/** "today", "yesterday", "3 days ago", else a date. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return formatDate(iso);
}

const ACRONYMS = new Set(['qa', 'bpp', 'cms', 'it', 'uk', 'nhs']);

/** 'Qa Limited' → 'QA'; 'Nowskills Limited' → 'Nowskills'; 'Just It Training Limited' → 'Just IT Training'. */
export function providerLabel(name: string): string {
  return name
    .replace(/\s*\(uk\)\s*/i, ' ')
    .replace(/\s+(limited|ltd\.?|plc|llp)$/i, '')
    .split(' ')
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w))
    .join(' ')
    .trim();
}

/**
 * Where the off-the-job study happens: the university for degree apprenticeships, else the
 * training provider (usually online with some workshops), else null when the advert doesn't say.
 */
export function studyWith(
  r: Pick<ListingRow, 'university' | 'provider_name'>,
): { kind: 'university' | 'provider'; name: string } | null {
  if (r.university) return { kind: 'university', name: r.university };
  if (r.provider_name) return { kind: 'provider', name: providerLabel(r.provider_name) };
  return null;
}

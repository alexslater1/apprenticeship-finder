const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Today's date in Europe/London as YYYY-MM-DD. */
export function londonToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/** The calendar date (Europe/London) of an instant, as YYYY-MM-DD. */
export function londonDate(d: Date): string {
  return londonToday(d);
}

/**
 * Parse the date formats seen across sources into YYYY-MM-DD (London calendar date):
 * ISO timestamps, RFC-822, 'Fri Oct 09 02:01:00 UTC 2026', 'M/D/YYYY', '9 October 2026',
 * and relative 'Posted 2 Days Ago' / 'today' / 'yesterday'.
 */
export function parseDate(input: string | null | undefined, now: Date = new Date()): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;

  // FAA closing dates are 23:59:59Z; take the London date of the instant.
  if (ISO_DATE.test(s)) {
    if (s.length === 10) return s;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s.slice(0, 10) : londonDate(d);
  }

  const rel = /(today|just posted)|(yesterday)|(\d+)\+?\s*(day|week|month)s?\s*ago/i.exec(s);
  if (rel) {
    const days = rel[1]
      ? 0
      : rel[2]
        ? 1
        : Number(rel[3]) * ({ day: 1, week: 7, month: 30 }[rel[4]!.toLowerCase() as 'day'] ?? 1);
    return londonDate(new Date(now.getTime() - days * 86_400_000));
  }

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mdy) return `${mdy[3]}-${mdy[1]!.padStart(2, '0')}-${mdy[2]!.padStart(2, '0')}`;

  const d = new Date(s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/, '$1'));
  return Number.isNaN(d.getTime()) ? null : londonDate(d);
}

/** Whole days from `fromIso` to `toIso` (both YYYY-MM-DD). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

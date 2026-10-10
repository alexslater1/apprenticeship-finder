import { matchTier, personalParts } from '@af/shared';
import { prefsFrom, type Derived } from '@/lib/derive';
import { useSettings } from '@/lib/queries';

const TIER = {
  high: 'High match (70+)',
  medium: 'Medium match (45–69)',
  low: 'Low match (under 45)',
};

/** The match score, part by part, so it's clear why one listing ranks above another. */
export function WhyThisMatch({ d }: { d: Derived }) {
  const { data: settings } = useSettings();
  const { parts, cap } = personalParts(d.row, prefsFrom(settings), d.distance);
  return (
    <details className="group rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-semibold select-none">
        Why this match: {d.score} · {TIER[matchTier(d.score)]}
      </summary>
      <table className="mt-2 w-full">
        <tbody>
          {parts.map((p) => (
            <tr key={p.label} className="border-t first:border-t-0">
              <td className="py-1 pr-3 text-muted-foreground">{p.label}</td>
              <td className="py-1 text-right font-medium tabular-nums">
                {p.points > 0 ? `+${p.points}` : p.points}
              </td>
            </tr>
          ))}
          {cap !== null && (
            <tr className="border-t">
              <td className="py-1 pr-3 text-muted-foreground">
                Capped: a line on a careers page, not a full advert
              </td>
              <td className="py-1 text-right font-medium tabular-nums">max {cap}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        Role and level points follow your High / Maybe choices in Settings. Scores over 100 show as
        100 but still sort in order.
      </p>
    </details>
  );
}

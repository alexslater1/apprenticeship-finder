import { SKILL_BY_ID, type SkillMention } from '@af/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { kindOf, type SkillKind } from '@/lib/skills';
import { cn } from '@/lib/utils';

const GROUPS: Array<{ kind: SkillKind; label: string }> = [
  { kind: 'asked', label: 'Asks for' },
  { kind: 'not_required', label: 'Not required' },
];

/** The skills this advert mentions, split into asked for and not required; tap one for the sentence. */
export function AdvertSkills({ skills }: { skills: SkillMention[] | null | undefined }) {
  const [picked, setPicked] = useState<string | null>(null);
  const known = (skills ?? []).filter((s) => SKILL_BY_ID[s.id]);
  if (!known.length) return null;
  const quote = known.find((s) => s.id === picked)?.quote;
  return (
    <section>
      <h3 className="mb-2 font-semibold">
        Skills in this advert{' '}
        <Link
          to="/skills"
          className="text-sm font-normal text-primary underline-offset-2 hover:underline"
        >
          (see all)
        </Link>
      </h3>
      <div className="grid gap-2">
        {GROUPS.map(({ kind, label }) => {
          const group = known.filter((s) => kindOf(s.ctx) === kind);
          if (!group.length) return null;
          return (
            <div key={kind} className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="mr-1 text-muted-foreground">{label}:</span>
              {group.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={picked === s.id}
                  onClick={() => setPicked(picked === s.id ? null : s.id)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs hover:bg-muted',
                    picked === s.id && 'border-primary bg-primary/10 text-foreground',
                  )}
                >
                  {SKILL_BY_ID[s.id]!.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {quote && (
        <blockquote className="mt-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
          “{quote}”
        </blockquote>
      )}
    </section>
  );
}

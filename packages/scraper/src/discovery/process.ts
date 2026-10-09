import type { SuggestionRow } from '@af/shared';
import { detectConnector } from '../connectors/detect.ts';
import { db, must } from '../db.ts';
import type { Ctx } from '../types.ts';
import { freeId } from './learn.ts';

/**
 * Turn approved suggestions into watched employers before the connectors run (PLAN.md §6.5
 * "Processing suggestions"), so a company added today is checked today. The job system is
 * detected from the careers URL (or the page's ATS links); if nothing is found the page itself
 * is watched for changes (pagehash) and flagged on the Health page.
 */
export async function processApproved(
  ctx: Ctx,
): Promise<{ added: string[]; needsReview: string[] }> {
  const rows = must<SuggestionRow[]>(
    await db()
      .from('employer_suggestions')
      .select('*')
      .eq('status', 'approved')
      .is('employer_id', null),
    'approved suggestions',
  );
  if (!rows.length) return { added: [], needsReview: [] };
  const taken = new Set(
    must<Array<{ id: string }>>(await db().from('employers').select('id'), 'employer ids').map(
      (e) => e.id,
    ),
  );
  const added: string[] = [];
  const needsReview: string[] = [];
  for (const s of rows) {
    const url = s.careers_url ?? s.evidence.find((e) => e.url)?.url;
    if (!url) continue;
    let detection =
      s.detected_connector && s.detected_config
        ? { connector: s.detected_connector, config: s.detected_config, via: url }
        : null;
    if (!detection) {
      try {
        detection = await detectConnector(ctx.http, url);
      } catch (err) {
        ctx.log.warn(`detect ${url}: ${(err as Error).message}`);
      }
    }
    const name = s.name ?? new URL(url).hostname;
    const id = freeId(name, taken);
    taken.add(id);
    if (ctx.dryRun) {
      ctx.log.info(`[dry] would add employer ${id} (${detection?.connector ?? 'pagehash'})`);
      continue;
    }
    must(
      await db()
        .from('employers')
        .insert({
          id,
          name,
          origin: s.origin === 'manual' ? 'manual' : 'discovered',
          early_careers_url: url,
          connector: detection?.connector ?? 'pagehash',
          connector_config: detection?.config ?? { url },
          watch: true,
          notes_md:
            s.evidence
              .slice(0, 3)
              .map((e) => [e.title, e.url, e.note].filter(Boolean).join(' — '))
              .join('\n') || null,
        }),
      `add employer ${id}`,
    );
    must(
      await db()
        .from('employer_suggestions')
        .update({
          status: 'added',
          employer_id: id,
          detected_connector: detection?.connector ?? 'pagehash',
          detected_config: detection?.config ?? { url },
        })
        .eq('id', s.id),
      `mark suggestion ${s.id} added`,
    );
    added.push(id);
    if (!detection) needsReview.push(id);
    ctx.log.info(`added employer ${id} via ${detection?.connector ?? 'pagehash'}`);
  }
  return { added, needsReview };
}

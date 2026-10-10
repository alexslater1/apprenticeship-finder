import { baseScore, normaliseEmployerName, rules, slugify, type SuggestionRow } from '@af/shared';
import { detectFrom } from '../connectors/detect.ts';
import { db, must } from '../db.ts';
import type { NormalisedListing } from '../pipeline/normalise.ts';
import type { Ctx } from '../types.ts';
import { ignoredName, ignoredNames, isAggregator, type SuggestionInput } from './config.ts';

/**
 * D3 (PLAN.md §6.5): every strong listing at a company we don't watch becomes a suggestion,
 * with its apply link run through ATS detection. Suggestions with a detected job system are
 * approved automatically (the next step turns them into watched employers); the rest wait in
 * the Suggested tab. Dismissed names never come back.
 */

const MIN_SCORE = 45;
const MAX_EVIDENCE = 10;
const PROVIDERS = new Set(rules.providerNames.map(normaliseEmployerName));

export function suggestionsFromListings(
  listings: NormalisedListing[],
  today: string,
): SuggestionInput[] {
  const ignored = ignoredNames();
  const out: SuggestionInput[] = [];
  for (const l of listings) {
    if (l.employerId || l.isLead) continue;
    const norm = l.employerNameNorm;
    if (!norm || norm === 'unknown' || ignored.has(norm) || PROVIDERS.has(norm)) continue;
    if (ignoredName(l.employerName)) continue;
    const score = baseScore({
      title: l.title,
      descriptionText: l.descriptionText ?? undefined,
      classification: l.classification,
      postedOrFirstSeen: l.postedDate,
      closingDate: l.closingDate,
      today,
    }).total;
    if (score < MIN_SCORE) continue;
    // A link to the employer's own site (not a board or training provider) is what makes a
    // suggestion useful: without one there's nothing to watch.
    const link = [l.applyUrl, l.url].find((u): u is string => !!u && !isAggregator(u));
    if (!link) continue;
    const s = l.sources[0]!;
    const detected = detectFrom(link);
    out.push({
      name: l.employerName,
      origin:
        s.source === 'google_jobs'
          ? 'google_jobs'
          : s.source === 'web_search'
            ? 'web_search'
            : 'listing',
      careersUrl: link,
      evidence: { source: s.source, url: s.url, title: l.title, seen_at: today },
      // Web pages often don't say who's hiring, so their names are guesses: never auto-watch them.
      detected: s.source === 'web_search' ? null : detected,
      board: detected,
    });
  }
  return out;
}

/** Upsert suggestions by normalised name; returns how many were new and how many auto-approved. */
export async function saveSuggestions(
  inputs: SuggestionInput[],
  ctx: Ctx,
  isWatched: (norm: string) => boolean,
  employers: Array<{ connector: string | null; connector_config: Record<string, unknown> }> = [],
): Promise<{ added: number; auto: number; updated: number }> {
  const ignored = ignoredNames();
  const byNorm = new Map<string, SuggestionInput[]>();
  const watchedBoards = new Set(
    employers.map((e) => boardKey(e.connector, e.connector_config)).filter(Boolean),
  );
  for (const s of inputs) {
    const norm = normaliseEmployerName(s.name);
    if (!norm || ignored.has(norm) || isWatched(norm) || ignoredName(s.name)) continue;
    // Already watching that job board under another name (Airbus's Workday tenant is 'ag').
    if (s.detected && watchedBoards.has(boardKey(s.detected.connector, s.detected.config)))
      continue;
    byNorm.set(norm, [...(byNorm.get(norm) ?? []), s]);
  }
  if (!byNorm.size) return { added: 0, auto: 0, updated: 0 };

  const existing = new Map(
    must<SuggestionRow[]>(
      await db()
        .from('employer_suggestions')
        .select('*')
        .in('name_norm', [...byNorm.keys()]),
      'load suggestions',
    ).map((r) => [r.name_norm!, r]),
  );
  let added = 0;
  let auto = 0;
  let updated = 0;
  for (const [norm, group] of byNorm) {
    const detected = group.find((g) => g.detected)?.detected ?? null;
    const evidence = group.map((g) => g.evidence);
    const prev = existing.get(norm);
    if (ctx.dryRun) {
      ctx.log.info(
        `[dry] suggestion ${group[0]!.name}${detected ? ` (${detected.connector})` : ''}${prev ? ' (known)' : ''}`,
      );
      continue;
    }
    if (!prev) {
      must(
        await db()
          .from('employer_suggestions')
          .insert({
            name: group[0]!.name,
            name_norm: norm,
            careers_url: detected?.via ?? group.find((g) => g.careersUrl)?.careersUrl ?? null,
            origin: group[0]!.origin,
            evidence: evidence.slice(0, MAX_EVIDENCE),
            detected_connector: detected?.connector ?? null,
            detected_config: detected?.config ?? null,
            status: detected ? 'approved' : 'pending',
            auto: !!detected,
          }),
        `add suggestion ${norm}`,
      );
      added++;
      if (detected) auto++;
      continue;
    }
    // Never revive a dismissed or already-added company; just keep the evidence fresh.
    const urls = new Set(prev.evidence.map((e) => e.url));
    const fresh = evidence.filter((e) => !urls.has(e.url));
    const upgrade = prev.status === 'pending' && !!detected;
    if (!fresh.length && !upgrade) continue;
    must(
      await db()
        .from('employer_suggestions')
        .update({
          evidence: [...fresh, ...prev.evidence].slice(0, MAX_EVIDENCE),
          ...(upgrade
            ? {
                status: 'approved',
                auto: true,
                detected_connector: detected!.connector,
                detected_config: detected!.config,
                careers_url: prev.careers_url ?? detected!.via,
              }
            : {}),
        })
        .eq('id', prev.id),
      `update suggestion ${norm}`,
    );
    updated++;
    if (upgrade) auto++;
  }
  return { added, auto, updated };
}

/** One job board's identity across connectors: Workday tenant, Greenhouse token, host… */
export function boardKey(connector: string | null, cfg: Record<string, unknown>): string {
  if (!connector) return '';
  const id =
    cfg.tenant ??
    cfg.token ??
    cfg.account ??
    cfg.company ??
    cfg.org ??
    cfg.companyId ??
    cfg.host ??
    cfg.url;
  return id ? `${connector}:${String(id).toLowerCase()}` : '';
}

/** A free employer id for a new company: 'acme', then 'acme-2'… */
export function freeId(name: string, taken: Set<string>): string {
  const base =
    slugify(name)
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 40) || 'company';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

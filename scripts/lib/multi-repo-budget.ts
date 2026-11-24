import type { UsageVerdict } from './usage-budget.ts';

// Account-wide worker allocator for a campaign that spans several repos. The usage budget is one
// account-wide quantity, so the headroom is computed once (workersAllowed) and only split here.
// Pure: no I/O, no clock. The ceiling is `verdict.workers`; a non-GO verdict carries 0, so nothing
// is allocated and the verdict's reasons pass through.

export type RepoCandidate = { repo: string; bug: boolean; priority: number };
export type RepoAllocation = { total: number; perRepo: Record<string, number>; reasons: string[] };

/** Ranks every candidate across all repos (bugs first, then higher priority, then input order) and
 * gives the top `verdict.workers` of them a slot. `perRepo` counts slots by repo and holds every
 * repo in `repos` (plus any repo a candidate names), so a repo with no candidate or no slot is
 * present with 0, on a non-GO verdict too. */
export const allocateWorkers = (verdict: UsageVerdict, candidates: RepoCandidate[], repos: string[]): RepoAllocation => {
  const perRepo: Record<string, number> = {};
  for (const r of repos) perRepo[r] = 0;
  for (const c of candidates) perRepo[c.repo] = 0;
  if (verdict.workers <= 0) return { total: 0, perRepo, reasons: verdict.reasons };
  const ranked = candidates
    .map((c, order) => ({ c, order }))
    .sort((x, y) => Number(y.c.bug) - Number(x.c.bug) || y.c.priority - x.c.priority || x.order - y.order)
    .slice(0, verdict.workers);
  for (const { c } of ranked) perRepo[c.repo] += 1;
  return { total: ranked.length, perRepo, reasons: verdict.reasons };
};

import type { ForgeAdapter, ForgeCheck } from '../forge-adapter/types.ts';
import type { PrSignal } from './types.ts';

// Review verdict, CI and mergeability of the open PRs the board shows, read through the forge
// adapter of the configured forge (GitHub, Gitea or GitLab), the same channel as the forge counts.
// Two adapter reads per PR (`prView` for labels and mergeability, `prChecks` for CI), at most
// PR_SIGNAL_CAP PRs per render, so a refresh stays a few seconds. The reads are independent: one
// that fails leaves its own fact unknown and keeps the other. A PR whose reads both fail, or that is
// past the cap, has no signal and the page says "not checked" for it.

export const PR_SIGNAL_CAP = 15;

const REVIEW_LABEL = 'ai-review:';
const FAILED = new Set<ForgeCheck['conclusion']>(['FAILURE', 'CANCELLED', 'ACTION_REQUIRED']);

/** The CI verdict of a set of checks. No check at all is `none`, never `green`. */
export function ciOf(checks: ForgeCheck[]): Pick<PrSignal, 'ci' | 'failing'> {
  const failing = [...new Set(checks.filter((c) => c.status === 'COMPLETED' && FAILED.has(c.conclusion)).map((c) => c.name))].sort();
  if (failing.length) return { ci: 'failing', failing };
  if (checks.length === 0) return { ci: 'none', failing: [] };
  return { ci: checks.some((c) => c.status !== 'COMPLETED') ? 'running' : 'green', failing: [] };
}

/** The `ai-review:*` verdict a PR carries, without the prefix; null when it carries none. */
export function reviewOf(labels: Array<{ name: string } | string> | undefined): string | null {
  const names = (labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
  const label = names.find((n) => n.startsWith(REVIEW_LABEL));
  return label ? label.slice(REVIEW_LABEL.length) || null : null;
}

const attempt = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read();
  } catch {
    return null;
  }
};

/** Reads the signal of each PR (lowest number first, capped). A failed read leaves its fact unknown; a PR whose reads both fail is left out. */
export async function fetchPrSignals(adapter: ForgeAdapter, prs: number[], cap: number = PR_SIGNAL_CAP): Promise<Record<number, PrSignal>> {
  const out: Record<number, PrSignal> = {};
  for (const n of [...new Set(prs)].sort((a, b) => a - b).slice(0, cap)) {
    const pr = await attempt(() => adapter.prView(n));
    const checks = await attempt(() => adapter.prChecks(n));
    if (!pr && !checks) continue;
    out[n] = {
      review: pr ? reviewOf(pr.labels) : null,
      review_read: pr !== null,
      mergeable: pr?.mergeable ?? null,
      ...(checks ? ciOf(checks) : { ci: 'unknown' as const, failing: [] }),
    };
  }
  return out;
}

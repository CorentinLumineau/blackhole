import { mapRestCheckRun, mapRestStatus, type RestCheckRun, type RestStatus } from '../forge-adapter/github-rest.ts';
import type { ForgeCheck } from '../forge-adapter/types.ts';

// CI verdict for the merge gate (phase-loop.md § Merge protocol step 2, ADR-050). A pure function
// of a checks snapshot, so the same verdict comes out whether the snapshot was polled with `gh`,
// read over REST, returned by the GitHub MCP tools, or re-read after a PR-event wake.

export type CiVerdict = { verdict: 'green' | 'red' | 'pending'; failing: string[]; pending: string[]; ignored: string[] };

/** Vercel preview deployments are expected to fail on campaign PRs and never gate a merge. */
export function isVercelPreviewCheck(name: string): boolean {
  return /^Vercel/i.test(name);
}

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/** Accepts a REST or MCP check-runs payload, a combined-status payload, both merged, or ForgeCheck[]. */
export const checksFromSnapshot = (snapshot: unknown): ForgeCheck[] => {
  if (Array.isArray(snapshot)) return snapshot as ForgeCheck[];
  if (snapshot === null || typeof snapshot !== 'object') throw new Error('checks snapshot must be an object or an array');
  const { check_runs, statuses } = snapshot as { check_runs?: RestCheckRun[]; statuses?: RestStatus[] };
  if (!check_runs && !statuses) throw new Error('checks snapshot has neither check_runs nor statuses');
  return [...(check_runs ?? []).map(mapRestCheckRun), ...(statuses ?? []).map(mapRestStatus)];
};

export type CiVerdictOptions = {
  /**
   * Evidence checks that must have run and passed, matched by exact check name as the forge reports
   * it (a GitHub check-run `name`, or a Gitea/GitHub commit-status `context` such as
   * `ci-main / ci-report (pull_request)`). Missing, queued or SKIPPED is pending; any other completed
   * conclusion than SUCCESS is red.
   *
   * This is the only way to catch a review-gated head where one cheap job succeeded and the rest
   * were skipped; without it only the all-skipped rule applies. The CLI fills it from
   * `merge_ready.required_checks` (`requiredChecksFromConfig`) unless `--required` is given.
   */
  requiredChecks?: string[];
};

export const ciVerdict = (checks: ForgeCheck[], options: CiVerdictOptions = {}): CiVerdict => {
  const ignored = checks.filter((c) => isVercelPreviewCheck(c.name)).map((c) => c.name);
  const gating = checks.filter((c) => !isVercelPreviewCheck(c.name));
  const pending = gating.filter((c) => c.status !== 'COMPLETED').map((c) => c.name);
  const failing = gating
    .filter((c) => c.status === 'COMPLETED' && !PASSING.has(c.conclusion ?? ''))
    .map((c) => c.name);
  for (const name of options.requiredChecks ?? []) {
    const matches = checks.filter((c) => c.name === name);
    const done = matches.filter((c) => c.status === 'COMPLETED' && c.conclusion !== 'SKIPPED');
    if (done.some((c) => c.conclusion !== 'SUCCESS')) {
      if (!failing.includes(name)) failing.push(name);
    } else if (done.length === 0 && !pending.includes(name)) {
      pending.push(name);
    }
  }
  // A set where nothing executed (no gating check, or every one SKIPPED) proves no testing, so it is
  // pending, never a pass.
  const executed = gating.some((c) => c.status === 'COMPLETED' && c.conclusion !== 'SKIPPED');
  const verdict = failing.length > 0 ? 'red' : pending.length > 0 || !executed ? 'pending' : 'green';
  return { verdict, failing, pending, ignored };
};

/** Reads `merge_ready.required_checks`; absent is an empty list, a wrong type throws (fail closed). */
export const requiredChecksFromConfig = (config: Record<string, unknown>): string[] => {
  const merge = config.merge_ready;
  if (merge === undefined) return [];
  const value = (merge as { required_checks?: unknown } | null)?.required_checks;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((n) => typeof n !== 'string' || n === '')) {
    throw new Error('config merge_ready.required_checks must be an array of non-empty check names');
  }
  return value as string[];
};

/**
 * With no required list a SKIPPED gating check cannot be told from a legitimately path-filtered one,
 * so the verdict stays as is; this names the skipped checks so the owner can see a head where one
 * cheap job passed and the rest never ran. Null when there is nothing to flag.
 */
export const unconfiguredSkipWarning = (checks: ForgeCheck[], options: CiVerdictOptions): string | null => {
  if ((options.requiredChecks ?? []).length > 0) return null;
  const skipped = checks.filter((c) => !isVercelPreviewCheck(c.name) && c.status === 'COMPLETED' && c.conclusion === 'SKIPPED').map((c) => c.name);
  if (skipped.length === 0) return null;
  return `ci-verdict: no required checks configured (merge_ready.required_checks) and ${skipped.length} gating check(s) were SKIPPED: ${skipped.join(', ')}. ` +
    'Green here does not prove those ran; set merge_ready.required_checks to the evidence check.';
};

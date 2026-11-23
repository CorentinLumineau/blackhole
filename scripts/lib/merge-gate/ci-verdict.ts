import { mapRestCheckRun, mapRestStatus, suiteProducers, type RestCheckRun, type RestStatus } from '../forge-adapter/github-rest.ts';
import type { ForgeCheck } from '../forge-adapter/types.ts';

// CI verdict for the merge gate (phase-loop.md § Merge protocol step 2, ADR-050). A pure function
// of a checks snapshot, so the same verdict comes out whether the snapshot was polled with `gh`,
// read over REST, returned by the GitHub MCP tools, or re-read after a PR-event wake.

export const REQUIRED_CHECKS_KEY = 'merge_ready.required_checks';

export type CiVerdict = {
  verdict: 'green' | 'red' | 'pending';
  failing: string[];
  pending: string[];
  ignored: string[];
  /** Set when no required list is configured and a gating check was SKIPPED (the skip cannot be told from a path-filtered one); the verdict is then at least pending. */
  missing_config?: typeof REQUIRED_CHECKS_KEY;
};

/** Vercel preview deployments are expected to fail on campaign PRs and never gate a merge. */
export function isVercelPreviewCheck(name: string): boolean {
  return /^Vercel/i.test(name);
}

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
/** Completed conclusions that cannot replace a CANCELLED run (`withoutSupersededCancelled`). */
const NOT_EXECUTED = new Set(['NEUTRAL', 'SKIPPED', 'CANCELLED']);

/**
 * Accepts a REST or MCP check-runs payload, a combined-status payload, both merged, or ForgeCheck[].
 * `runs` is the head's `actions/runs` payload, the producer source `withoutSupersededCancelled` needs.
 */
export const checksFromSnapshot = (snapshot: unknown, runs?: unknown): ForgeCheck[] => {
  const suites = runs === undefined ? undefined : suiteProducers(runs);
  if (Array.isArray(snapshot)) return snapshot as ForgeCheck[];
  if (snapshot === null || typeof snapshot !== 'object') throw new Error('checks snapshot must be an object or an array');
  const { check_runs, statuses } = snapshot as { check_runs?: RestCheckRun[]; statuses?: RestStatus[] };
  if (!check_runs && !statuses) throw new Error('checks snapshot has neither check_runs nor statuses');
  return [...(check_runs ?? []).map((row) => mapRestCheckRun(row, suites)), ...(statuses ?? []).map(mapRestStatus)];
};

export type CiVerdictOptions = {
  /**
   * Evidence checks that must have run and passed, matched by exact check name as the forge reports
   * it (a GitHub check-run `name`, or a Gitea/GitHub commit-status `context` such as
   * `ci-main / ci-report (pull_request)`). Missing, queued or SKIPPED is pending; any other completed
   * conclusion than SUCCESS is red.
   *
   * Without a list the gate fails closed: a SKIPPED gating check cannot be told from a path-filtered
   * one, so it is pending and the result carries `missing_config`. The CLI fills this from
   * `merge_ready.required_checks` (`requiredChecksFromConfig`) unless `--required` is given.
   */
  requiredChecks?: string[];
};

/** A start time is usable only when it parses to a moment after the epoch; the zero time of an unstarted run is not one. */
const startMs = (c: ForgeCheck): number => {
  const ms = c.startedAt ? Date.parse(c.startedAt) : NaN;
  return ms > 0 ? ms : NaN;
};

/**
 * Drops each COMPLETED CANCELLED run that a newer run provably replaced, and keeps every other entry,
 * so the verdict judges a head the way it would without the cancelled run.
 *
 * A check name does not identify a producer (two workflows can share a job name, one workflow can run
 * on push and on pull_request, a commit status can be named like a check run), and even a shared
 * workflow, event and branch does not prove replacement (two PRs from one branch, dispatch runs with
 * different inputs, siblings in one suite). So a run only replaces another when both carry the same
 * `producer` (proved by `suiteProducers` for one pull_request run of one PR) and `name`, and the newer
 * one has a strictly higher `suiteId` and `runId`, both server-assigned. A start time never orders
 * runs; it can only veto, when both starts are usable and the newer-by-id run started first. The
 * replacing run must be still running or have ended SUCCESS or failing: a newer NEUTRAL, SKIPPED or
 * CANCELLED run leaves the CANCELLED run in place, so the verdict stays red (fail closed). Since a
 * CANCELLED run never replaces, a replacing run is never itself dropped and no chain of runs can
 * route around the start veto.
 * Only a CANCELLED run is ever dropped, so no ordering can hide a FAILURE, and the replacing run is
 * judged as is. Anything unproved keeps every run: red or pending, never a false green.
 */
export const withoutSupersededCancelled = (checks: ForgeCheck[]): ForgeCheck[] => {
  const canReplace = (n: ForgeCheck): boolean =>
    n.status !== 'COMPLETED' || !NOT_EXECUTED.has(n.conclusion ?? '');
  const replaced = (c: ForgeCheck): boolean => {
    if (c.status !== 'COMPLETED' || c.conclusion !== 'CANCELLED') return false;
    const { producer, suiteId, runId } = c;
    if (typeof producer !== 'string' || typeof suiteId !== 'number' || typeof runId !== 'number') return false;
    return checks.some((n) =>
      n !== c &&
      canReplace(n) &&
      n.producer === producer &&
      n.name === c.name &&
      typeof n.suiteId === 'number' && n.suiteId > suiteId &&
      typeof n.runId === 'number' && n.runId > runId &&
      !(startMs(n) < startMs(c)));
  };
  return checks.filter((c) => !replaced(c));
};

export const ciVerdict = (allChecks: ForgeCheck[], options: CiVerdictOptions = {}): CiVerdict => {
  const checks = withoutSupersededCancelled(allChecks);
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
  const skippedGating = gating.filter((c) => c.status === 'COMPLETED' && c.conclusion === 'SKIPPED').map((c) => c.name);
  const missingConfig = (options.requiredChecks ?? []).length === 0 && failing.length === 0 && skippedGating.length > 0;
  if (missingConfig) for (const name of skippedGating) if (!pending.includes(name)) pending.push(name);
  // A set where nothing executed (no gating check, or every one SKIPPED) proves no testing, so it is
  // pending, never a pass.
  const executed = gating.some((c) => c.status === 'COMPLETED' && c.conclusion !== 'SKIPPED');
  const verdict = failing.length > 0 ? 'red' : pending.length > 0 || !executed ? 'pending' : 'green';
  return missingConfig ? { verdict, failing, pending, ignored, missing_config: REQUIRED_CHECKS_KEY } : { verdict, failing, pending, ignored };
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

/** Pending reason for the unconfigured fail-closed case; null when the verdict carries no `missing_config`. */
export const unconfiguredPendingMessage = (checks: ForgeCheck[], options: CiVerdictOptions): string | null => {
  const result = ciVerdict(checks, options);
  if (!result.missing_config) return null;
  const skipped = withoutSupersededCancelled(checks)
    .filter((c) => !isVercelPreviewCheck(c.name) && c.status === 'COMPLETED' && c.conclusion === 'SKIPPED')
    .map((c) => c.name);
  return `ci-verdict: pending, ${REQUIRED_CHECKS_KEY} is not configured and ${skipped.length} gating check(s) were SKIPPED: ${skipped.join(', ')}. ` +
    `Set ${REQUIRED_CHECKS_KEY} to the evidence check(s) to resolve it.`;
};

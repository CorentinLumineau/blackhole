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

/**
 * Accepts a REST or MCP check-runs payload, a combined-status payload, both merged, or ForgeCheck[].
 * `runs` is the head's `actions/runs` payload; it names the workflow behind each check suite so reruns
 * of one producer can supersede each other. Without it (or for a suite it does not name) a run carries
 * no producer and is judged on its own.
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

const runIdOf = (c: ForgeCheck): number => (typeof c.runId === 'number' ? c.runId : NaN);

/** Entries ordered newest first as tiers of entries that tie; one tier holding every entry when they cannot all be ordered. */
const tiersNewestFirst = (group: ForgeCheck[]): ForgeCheck[][] => {
  const tierBy = (entries: ForgeCheck[], key: (c: ForgeCheck) => number): ForgeCheck[][] | null => {
    const values = entries.map(key);
    if (values.some((v) => Number.isNaN(v))) return null;
    return [...new Set(values)].sort((x, y) => y - x).map((v) => entries.filter((_, i) => values[i] === v));
  };
  const byRun = (entries: ForgeCheck[]) => tierBy(entries, runIdOf) ?? [entries];
  const byStart = tierBy(group, startMs);
  return byStart ? byStart.flatMap(byRun) : (tierBy(group, runIdOf) ?? [group]);
};

const isNonExecuting = (c: ForgeCheck): boolean => c.status === 'COMPLETED' && (c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL');

/**
 * Keeps the latest run of each producer's check, so a run a later run replaced (a cancelled re-trigger)
 * no longer judges the head. A check name alone does not identify a producer (two workflows can share a
 * job name, one workflow can run on push and pull_request, a commit status can be named like a check
 * run), so only runs carrying the same `producer` and `name` supersede each other; a run without a
 * producer is always kept. Order is `startedAt`, then `runId`; neither is `completed_at`, which is null
 * for the newest run while it is still going. A time is absent when missing, unparseable or at or
 * before the epoch (the zero time of an unstarted run); with any absent time the group is ordered by
 * `runId`, and a group that still cannot be ordered keeps every run: ordering data is never guessed.
 * A newest run that is only SKIPPED or NEUTRAL proves nothing was fixed, so the nearest older run that
 * actually executed stays too unless it passed.
 */
export const latestPerName = (checks: ForgeCheck[]): ForgeCheck[] => {
  const groups = new Map<string, ForgeCheck[]>();
  const kept = new Set<ForgeCheck>();
  for (const c of checks) {
    if (c.producer === undefined) kept.add(c);
    else groups.set(`${c.producer}\0${c.name}`, [...(groups.get(`${c.producer}\0${c.name}`) ?? []), c]);
  }
  for (const group of groups.values()) {
    const [newest, ...older] = tiersNewestFirst(group);
    for (const c of newest) kept.add(c);
    if (!newest.every(isNonExecuting)) continue;
    for (const tier of older) {
      const executed = tier.filter((c) => !isNonExecuting(c));
      if (executed.length === 0) continue;
      for (const c of executed) if (!(c.status === 'COMPLETED' && c.conclusion === 'SUCCESS')) kept.add(c);
      break;
    }
  }
  return checks.filter((c) => kept.has(c));
};

export const ciVerdict = (allChecks: ForgeCheck[], options: CiVerdictOptions = {}): CiVerdict => {
  const checks = latestPerName(allChecks);
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
  const skipped = latestPerName(checks)
    .filter((c) => !isVercelPreviewCheck(c.name) && c.status === 'COMPLETED' && c.conclusion === 'SKIPPED')
    .map((c) => c.name);
  return `ci-verdict: pending, ${REQUIRED_CHECKS_KEY} is not configured and ${skipped.length} gating check(s) were SKIPPED: ${skipped.join(', ')}. ` +
    `Set ${REQUIRED_CHECKS_KEY} to the evidence check(s) to resolve it.`;
};

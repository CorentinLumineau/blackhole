// Deterministic release policy (ADR-063 M2-M5): pending set from first-parent git history,
// the four cut classes, the freshness predicate and the version rule. Pure functions only: the
// caller supplies git output, run lists and the clock, so every branch is offline-testable.
import {
  CADENCE_THRESHOLD,
  classifyBatch,
  headHasSkipRelease,
  higherCutVersion,
  type MergedPr,
  type SemverBump,
} from './release-cadence.ts';

export const RELEASE_THRESHOLD = CADENCE_THRESHOLD;
export const RELEASE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RELEASE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Paths whose change ships to a consumer; a prefix ending in `/` matches a tree, else an exact file. */
export const SHIPPED_PATHS: readonly string[] = [
  'plugins/',
  'skills/',
  'agents/',
  'rules/',
  'references/',
  'templates/',
  'codex-skills/',
  'codex-agents/',
  'SKILL.md',
  'codex-marketplace.json',
  '.claude-plugin/',
  '.codex-plugin/',
  '.gemini-plugin/',
];

/** A change under these paths cuts at once (ADR-063 M4 immediate class). */
export const IMMEDIATE_PATHS: readonly string[] = ['templates/hooks/'];

/** `git log` format whose records `parseFirstParentLog` reads; pair it with `--name-only`. */
export const FIRST_PARENT_LOG_FORMAT = '%x1e%H%x1f%cI%x1f%s%x1f%b%x1f';

export type PendingCommit = {
  sha: string;
  committedAt: string;
  subject: string;
  body: string;
  paths: string[];
  prNumber: number | null;
  /** The release commit of an earlier cut: never counted, never pending work. */
  isReleaseCommit: boolean;
  immediate: boolean;
  touchesShipped: boolean;
};

const CONVENTIONAL = /^([a-z]+)(?:\(([^)]*)\))?!?:/i;
const PR_REF = /\(#(\d+)\)(?!.*\(#\d+\))/;
const RELEASE_IMMEDIATE_TRAILER = /^Release:\s*immediate\s*$/im;

export function matchesPathRule(file: string, rules: readonly string[]): boolean {
  return rules.some((rule) => (rule.endsWith('/') ? file.startsWith(rule) : file === rule));
}

function isImmediate(subject: string, body: string, paths: string[]): boolean {
  const parsed = CONVENTIONAL.exec(subject);
  const type = parsed?.[1]?.toLowerCase();
  const scope = parsed?.[2]?.toLowerCase();
  return (
    RELEASE_IMMEDIATE_TRAILER.test(body) ||
    scope === 'security' ||
    (type === 'fix' && scope === 'hooks') ||
    paths.some((file) => matchesPathRule(file, IMMEDIATE_PATHS))
  );
}

/** Parse `git log --first-parent --name-only --format=FIRST_PARENT_LOG_FORMAT` output, newest first. */
export function parseFirstParentLog(raw: string): PendingCommit[] {
  const commits: PendingCommit[] = [];
  for (const record of raw.split('\x1e')) {
    if (record.trim() === '') continue;
    const [sha, committedAt, subject, body, names = ''] = record.split('\x1f');
    const paths = names.split('\n').map((line) => line.trim()).filter(Boolean);
    const pr = PR_REF.exec(subject);
    commits.push({
      sha: sha.trim(),
      committedAt,
      subject,
      body: body.trim(),
      paths,
      prNumber: pr ? Number(pr[1]) : null,
      isReleaseCommit: headHasSkipRelease(subject),
      immediate: isImmediate(subject, body, paths),
      touchesShipped: paths.some((file) => matchesPathRule(file, SHIPPED_PATHS)),
    });
  }
  return commits;
}

/** A pending PR counts toward the batch only when it is a PR commit that changes a shipped path. */
function counted(commits: PendingCommit[]): PendingCommit[] {
  return commits.filter((c) => !c.isReleaseCommit && c.prNumber !== null && c.touchesShipped);
}

export type CutClass = 'immediate' | 'batch' | 'age' | 'force' | 'cooldown' | 'none';

export type CutDecision = {
  class: CutClass;
  cut: boolean;
  reason: string;
  /** Release-relevant pending PRs (the batch counter). */
  pending: number;
};

/**
 * Inputs for `decideCut`. `isVerified` must be built from the M2 freshness result
 * (`evaluateFreshness`): a commit is verified only when the newest green main run covers it.
 */
export type CutInput = {
  commits: PendingCommit[];
  now: Date;
  lastTagAt: Date | null;
  force?: boolean;
  /** M2: only an immediate commit already verified by main CI may cut at once. Absent means all are. */
  isVerified?: (sha: string) => boolean;
};

/**
 * Decide whether to cut now. Class precedence, first match wins: nothing pending, `force`, no
 * shipped path changed, `immediate` (only a verified commit), then `batch`/`age` unless the
 * last tag is inside the cooldown (`cooldown`, no cut), else `none`. The caller must pass an
 * `isVerified` built from the M2 freshness result; omitting it treats every commit as verified.
 */
export function decideCut(input: CutInput): CutDecision {
  const open = input.commits.filter((c) => !c.isReleaseCommit);
  const batch = counted(input.commits);
  const pending = batch.length;
  const none = (reason: string): CutDecision => ({ class: 'none', cut: false, reason, pending });

  if (open.length === 0) return none('nothing pending since the latest tag');
  if (input.force) return { class: 'force', cut: true, reason: 'force dispatch', pending };
  if (!open.some((c) => c.touchesShipped)) return none('no shipped path changed');

  const urgent = open.filter((c) => c.immediate && (input.isVerified?.(c.sha) ?? true));
  if (urgent.length > 0) {
    return { class: 'immediate', cut: true, reason: `immediate change ${urgent[0].sha.slice(0, 7)}`, pending };
  }

  const cooling = input.lastTagAt !== null && input.now.getTime() - input.lastTagAt.getTime() < RELEASE_COOLDOWN_MS;
  const oldest = batch.reduce((min, c) => Math.min(min, Date.parse(c.committedAt)), Infinity);
  const batchDue = pending >= RELEASE_THRESHOLD;
  const ageDue = pending >= 1 && input.now.getTime() - oldest >= RELEASE_MAX_AGE_MS;

  if (batchDue || ageDue) {
    if (cooling) return { class: 'cooldown', cut: false, reason: 'last tag is within the cooldown window', pending };
    return batchDue
      ? { class: 'batch', cut: true, reason: `${pending} pending PRs reach the threshold of ${RELEASE_THRESHOLD}`, pending }
      : { class: 'age', cut: true, reason: 'oldest pending PR reached the age limit', pending };
  }
  return none(`${pending} of ${RELEASE_THRESHOLD} pending PRs, none old enough`);
}

export type VerifyRun = {
  status: string;
  conclusion: string | null;
  headSha: string;
};

export type Freshness = { ok: boolean; sha: string | null; reason: string };

/** M2: the newest completed, non-cancelled, non-skipped run must be green and an ancestor of the tip. */
export function evaluateFreshness(
  runsNewestFirst: readonly VerifyRun[],
  isAncestorOfHead: (sha: string) => boolean,
): Freshness {
  const run = runsNewestFirst.find(
    (r) => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped',
  );
  if (!run) return { ok: false, sha: null, reason: 'no completed verify run on main' };
  if (run.conclusion !== 'success') {
    return { ok: false, sha: run.headSha, reason: `newest verify run concluded ${run.conclusion}` };
  }
  if (!isAncestorOfHead(run.headSha)) {
    return { ok: false, sha: run.headSha, reason: 'newest green run is not an ancestor of the tip' };
  }
  return { ok: true, sha: run.headSha, reason: 'newest verify run is green and an ancestor of the tip' };
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * M5: conventional classification over the pending commits, a breaking change in a 0.x repo bumps
 * minor, and the result is never below the version manifest.
 */
export function nextCutVersion(
  tagVersion: string,
  manifestVersion: string,
  commits: PendingCommit[],
): { bump: SemverBump; version: string } {
  const prs: MergedPr[] = commits
    .filter((c) => !c.isReleaseCommit)
    .map((c) => ({ number: c.prNumber ?? 0, title: c.subject, body: c.body, mergedAt: c.committedAt }));
  const classified = classifyBatch(prs, tagVersion);
  const base = SEMVER.exec(tagVersion);
  if (classified.bump === 'major' && base && base[1] === '0') {
    const minor = `0.${Number(base[2]) + 1}.0`;
    return { bump: 'minor', version: higherCutVersion(manifestVersion, minor) };
  }
  return { bump: classified.bump, version: higherCutVersion(manifestVersion, classified.nextVersion) };
}

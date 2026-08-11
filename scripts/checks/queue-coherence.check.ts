import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';

// Issue #570 — queue-coherence.check.ts: mechanical coherence assertions over the live
// `.blackhole/queue.json` (dependency coherence, phase/artifact consistency, in-flight
// coherence). Advisory (WARN) — `ok: true` always, per the config-grant's landing-safety
// requirement: this check will fire on accumulated historical drift, and blocking on it would
// wedge the campaign until the backlog is hand-repaired.
//
// Path resolution deliberately diverges from playbook.check.ts's resolveCampaignPaths, which
// defaults to fixtures/queue.example.json and only reads a live queue.json behind an explicit
// `--campaign-dir` flag `verify.ts`'s `main()` never passes. That's correct for V-PLAN-01
// (fixture schema conformance) but wrong here — #570 exists precisely because nothing checks the
// *live* queue. So this check reads `.blackhole/queue.json` at the repo root directly, with no
// CLI plumbing: absent (fresh checkout, CI, `.blackhole/` is gitignored) → `{ ok: true }` for all
// three checks immediately, same file-absent-SKIP discipline as parity-matrix.check.ts.

type QueueIssue = {
  status?: string;
  phase?: string;
  depends_on?: number[];
  worktree?: string | null;
  pr?: number | null;
  route?: unknown;
};

type QueueIssues = Record<string, QueueIssue>;

// V-QUEUE-01: a `blocked` issue whose every in-queue dependency has already resolved
// (`merged`/`closed`) is stale — the incident shape named in the issue body (#464/#468/#492).
// A `depends_on` entry absent from `issues{}` entirely is treated as unresolved (conservative —
// no forge lookup here, see the file header); at least one dependency must resolve in-queue for
// this to fire, so an all-absent `depends_on` list (nothing to check) is never flagged.
export const findStaleBlockedIssues = (issues: QueueIssues): string[] => {
  const stale: string[] = [];
  for (const [id, issue] of Object.entries(issues)) {
    if (issue.status !== 'blocked') continue;
    const deps = issue.depends_on ?? [];
    if (deps.length === 0) continue;

    const inQueueDeps = deps.filter((d) => issues[String(d)] !== undefined);
    if (inQueueDeps.length === 0) continue;

    const allResolved = inQueueDeps.every((d) => {
      const status = issues[String(d)].status;
      return status === 'merged' || status === 'closed';
    });
    if (allResolved) stale.push(id);
  }
  return stale;
};

// V-QUEUE-02: `phase: implement` requires a worktree-on-disk, an open PR, or a plan artifact on
// disk (the #450/#451 phantom-implement incident shape — none of the three present); `phase:
// plan` requires a `route` object. Other phases are never checked (out of scope for this AC).
export const findPhaseArtifactMismatches = (
  issues: QueueIssues,
  deps: { worktreeExists: (worktree: string) => boolean; planArtifactExists: (issueNumber: string) => boolean },
): string[] => {
  const mismatched: string[] = [];
  for (const [id, issue] of Object.entries(issues)) {
    if (issue.phase === 'implement') {
      const hasWorktree = !!issue.worktree && deps.worktreeExists(issue.worktree);
      const hasPr = issue.pr != null;
      const hasPlan = deps.planArtifactExists(id);
      if (!hasWorktree && !hasPr && !hasPlan) mismatched.push(id);
    } else if (issue.phase === 'plan') {
      if (issue.route === undefined || issue.route === null) mismatched.push(id);
    }
  }
  return mismatched;
};

// V-QUEUE-03: `status: in-flight` naming a worktree path that no longer exists on disk.
// Worker-liveness (does a live worker actually own this worktree) is deliberately not
// duplicated here — that's V-STOP-01's job at stop time, which has the live worker-id list this
// offline check doesn't. This adds the every-turn, worktree-on-disk leg V-STOP-01 doesn't run
// continuously.
export const findOrphanedInFlightWorktrees = (
  issues: QueueIssues,
  worktreeExists: (worktree: string) => boolean,
): string[] =>
  Object.entries(issues)
    .filter(([, issue]) => issue.status === 'in-flight' && !!issue.worktree && !worktreeExists(issue.worktree))
    .map(([id]) => id);

// Wrapper: the one `fs.readFileSync`/`JSON.parse` and the two `fs.existsSync` closures, calling
// the three pure functions above. Exported (rather than only the default-path `checkQueueCoherence`
// entrypoint below) so tests can point it at a temp-dir fixture without touching the real
// `.blackhole/queue.json` (same pattern as playbook.check.ts's validatePlanArtifacts).
export const checkQueueCoherence = (queueFile: string, campaignDir: string): CheckResult[] => {
  if (!fs.existsSync(queueFile)) {
    return [
      { id: 'V-QUEUE-01', ok: true },
      { id: 'V-QUEUE-02', ok: true },
      { id: 'V-QUEUE-03', ok: true },
    ];
  }

  const queue: { issues?: QueueIssues } = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
  const issues = queue.issues ?? {};

  const worktreeExists = (worktree: string): boolean => fs.existsSync(worktree);
  const planArtifactExists = (issueNumber: string): boolean =>
    fs.existsSync(path.join(campaignDir, 'plans', `issue-${issueNumber}.md`));

  const stale = findStaleBlockedIssues(issues);
  const mismatched = findPhaseArtifactMismatches(issues, { worktreeExists, planArtifactExists });
  const orphaned = findOrphanedInFlightWorktrees(issues, worktreeExists);

  return [
    { id: 'V-QUEUE-01', ok: true, ...(stale.length ? { detail: `stale blocked issues (deps already resolved): ${stale.join(', ')}` } : {}) },
    { id: 'V-QUEUE-02', ok: true, ...(mismatched.length ? { detail: `phase/artifact mismatches: ${mismatched.join(', ')}` } : {}) },
    { id: 'V-QUEUE-03', ok: true, ...(orphaned.length ? { detail: `in-flight issues with a missing worktree: ${orphaned.join(', ')}` } : {}) },
  ];
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects beyond reading `.blackhole/`, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] =>
  checkQueueCoherence(path.join(root, '.blackhole', 'queue.json'), path.join(root, '.blackhole'));

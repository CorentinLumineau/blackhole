import { read, type CheckResult } from './check-utils.ts';
import { findMissingGateMarkers } from '../lib/check-common.ts';

// ADR-007 T5/R2' — worker-git-safety.check.ts: matches verify.worker-git-safety.test.ts.

// V-GITSAFE-01: cwd-independent git operations (issue #516) — the 2026-08-10 turn-4 wave
// incident showed the orchestrator's and a worker's session cwd can silently drift into a
// sibling worktree, and a recovery `git push -u` run from the wrong cwd corrupted upstream
// tracking on three campaign branches. Confirmed root cause (by reproduction): `git worktree
// add -b <branch> origin/main` sets that upstream by default on every branch it creates,
// independent of cwd drift — `--no-track` prevents it. This check pins the three-file
// hardening: the orchestrator's own worktree-creation/dispatch playbook (`phase-implement.md`),
// the implementer worker's own mandate (`implementer.md`), and the pre-dispatch sweep
// (`orchestrator-dispatch.md`). It also pins that `push.default` is scoped with `--worktree`
// (never the shared repo config) — a repo-wide leak of that setting into the owner's main
// clone was caught live during this issue's own review.

export const PHASE_IMPLEMENT_REQUIRED_MARKERS = [
  'git worktree add --no-track',
  'config extensions.worktreeConfig true',
  'config --worktree push.default nothing',
  '## Git operations must not depend on inherited cwd (issue #516)',
  'Branch Tracking Sweep (issue #516)',
];

export const IMPLEMENTER_REQUIRED_MARKERS = [
  'Explicit Git Targeting Gate',
  "Explicit refspec on push, never `-u`, never bare",
  'ls-remote origin refs/heads/<branch>',
];

export const ORCHESTRATOR_DISPATCH_REQUIRED_MARKERS = [
  '## Branch Tracking Sweep (issue #516)',
  'refs/heads/blackhole/',
  'does not rest solely on',
];

const checkWorkerGitSafety = (): CheckResult => {
  const phaseImplementMissing = findMissingGateMarkers(
    read('src/references/phase-implement.md'),
    PHASE_IMPLEMENT_REQUIRED_MARKERS,
  );
  const implementerMissing = findMissingGateMarkers(
    read('src/agents/implementer.md'),
    IMPLEMENTER_REQUIRED_MARKERS,
  );
  const orchestratorDispatchMissing = findMissingGateMarkers(
    read('src/references/orchestrator-dispatch.md'),
    ORCHESTRATOR_DISPATCH_REQUIRED_MARKERS,
  );

  const errors = [
    ...phaseImplementMissing.map((m) => `phase-implement.md missing "${m}"`),
    ...implementerMissing.map((m) => `implementer.md missing "${m}"`),
    ...orchestratorDispatchMissing.map((m) => `orchestrator-dispatch.md missing "${m}"`),
  ];

  if (errors.length) return { id: 'V-GITSAFE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-GITSAFE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkWorkerGitSafety()];

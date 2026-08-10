import { describe, expect, test } from 'bun:test';
import {
  PHASE_IMPLEMENT_REQUIRED_MARKERS,
  IMPLEMENTER_REQUIRED_MARKERS,
  ORCHESTRATOR_DISPATCH_REQUIRED_MARKERS,
  runChecks,
} from './checks/worker-git-safety.check.ts';
import { expectMarkersPresent, expectMarkersMissing } from './lib/marker-fixture-test.ts';

// Regression guard for issue #516: worker/orchestrator git operations must not depend on the
// inherited process cwd. Modeled on verify.single-writer.test.ts's required-markers-present
// shape (three files instead of two, one aggregate CheckResult).

const PHASE_IMPLEMENT_FIXTURE_FIXED = `
- [ ] git -C <scratchpad>/wt-<issue> config push.default nothing (issue #516)
- [ ] Branch Tracking Sweep clean before this wave's dispatch → orchestrator-dispatch.md § Branch Tracking Sweep (issue #516)

## Git operations must not depend on inherited cwd (issue #516)

The protection no longer rests solely on \`push.default=simple\`.
`;

const PHASE_IMPLEMENT_FIXTURE_STALE = `
## Checklist

- [ ] git worktree add <scratchpad>/wt-<issue> -b blackhole/issue-<issue> origin/main (V-BRANCH-03)
- [ ] install dependencies in worktree (e.g. \`npm install\`, \`bun install\`, etc.)
`;

const IMPLEMENTER_FIXTURE_FIXED = `
### Explicit Git Targeting Gate (unconditional, issue #516)

*   **Explicit refspec on push, never \`-u\`, never bare**: \`git -C <path> push origin
    <branch>:<branch>\`.
*   **Post-push verification**: run \`git -C <path> ls-remote origin refs/heads/<branch>\` and
    compare its SHA against \`git -C <path> rev-parse HEAD\`.
`;

const IMPLEMENTER_FIXTURE_STALE = `
*   Commit, push, and open a PR with \`Closes #N\` or \`Fixes #N\` in the PR body (\`V-GIT-01\`).
`;

const ORCHESTRATOR_DISPATCH_FIXTURE_FIXED = `
## Branch Tracking Sweep (issue #516)

Before spawning any wave of workers, sweep every local \`blackhole/issue-*\` branch:

\`\`\`bash
git for-each-ref --format='%(refname:short)|%(upstream:short)' refs/heads/blackhole/
\`\`\`

This sweep is the check that the protection against pushing to \`main\` does not rest solely on
\`push.default=simple\` (issue #516 AC).
`;

const ORCHESTRATOR_DISPATCH_FIXTURE_STALE = `
## Kaizen hunt dispatch

ADR-006's proactive counterpart to § Continuous Discovery above.
`;

describe('PHASE_IMPLEMENT_REQUIRED_MARKERS', () => {
  test('fixed phase-implement.md fixture has all markers present', () => {
    expectMarkersPresent(PHASE_IMPLEMENT_FIXTURE_FIXED, PHASE_IMPLEMENT_REQUIRED_MARKERS);
  });

  test('stale phase-implement.md fixture (pre-fix, cwd-dependent) is missing all markers', () => {
    expectMarkersMissing(PHASE_IMPLEMENT_FIXTURE_STALE, PHASE_IMPLEMENT_REQUIRED_MARKERS);
  });
});

describe('IMPLEMENTER_REQUIRED_MARKERS', () => {
  test('fixed implementer.md fixture has all markers present', () => {
    expectMarkersPresent(IMPLEMENTER_FIXTURE_FIXED, IMPLEMENTER_REQUIRED_MARKERS);
  });

  test('stale implementer.md fixture (pre-fix, no explicit targeting gate) is missing all markers', () => {
    expectMarkersMissing(IMPLEMENTER_FIXTURE_STALE, IMPLEMENTER_REQUIRED_MARKERS);
  });
});

describe('ORCHESTRATOR_DISPATCH_REQUIRED_MARKERS', () => {
  test('fixed orchestrator-dispatch.md fixture has all markers present', () => {
    expectMarkersPresent(ORCHESTRATOR_DISPATCH_FIXTURE_FIXED, ORCHESTRATOR_DISPATCH_REQUIRED_MARKERS);
  });

  test('stale orchestrator-dispatch.md fixture (pre-fix, no sweep) is missing all markers', () => {
    expectMarkersMissing(ORCHESTRATOR_DISPATCH_FIXTURE_STALE, ORCHESTRATOR_DISPATCH_REQUIRED_MARKERS);
  });
});

// The fixture tests above pin the marker contract; these exercise the check's own wiring — the
// file paths it reads and the id it returns. A typo'd path or a renamed id would pass every
// fixture test while silently checking nothing.
describe('worker-git-safety runChecks() against the real src/ files', () => {
  test('returns exactly one V-GITSAFE-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-GITSAFE-01');
  });

  test('passes against the current tree', () => {
    const [result] = runChecks();
    // On failure, surface which marker/file is missing rather than a bare `false`.
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});

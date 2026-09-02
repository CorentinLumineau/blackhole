---
type: review
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
issue: 747
---

# Review: `blackhole/issue-747` (b7f3618)

**Verdict: LGTM** — 0 BLOCK, 2 WARN at merge-readiness. Neither WARN is a merge blocker per
`review-core.md` § LGTM definition (the gate is zero unresolved BLOCK rows; WARN is flag-and-fix-
or-defer, never blocking).

Diff: PR #753, branch `blackhole/issue-747`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 2 BLOCK/WARN row(s) for issue #747 |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `.github/workflows/verify.yml:39` | V-DOC-06 | **WARN** | Workflow comment embeds "(issue #747)" archaeology. Seventh PR this turn for this rule (#734, #735, #740, #750, #745, #755, #753). Deferred to #736 for one normalization pass rather than seven isolated trims; the preceding sentence carries the root cause and must survive. |
| 2 | `.github/workflows/verify.yml:42` | V-DOC-01 | **WARN** | The Run-test-suite-before-Run-build ordering is load-bearing but undocumented. `scripts/verify.hooks.test.ts:18` reads the git-tracked bundle trees on disk with no self-invoked build, so it can only catch a stale committed mirror while it runs before a build regenerates one. Moving the step after Run build — the tidier-looking order — would silently turn that test into a tautology that still passes green. Needs an invariant comment at the step; not archaeology, so no issue number in it. Still open — not yet deferred or fixed. |

## What this PR closes

CI ran `bun install`, `bun run build`, `bun run verify` and `bun run install:verify` — and never
`bun test`. The ~1560-test suite executed nowhere in CI. The implementer, the reviewer (explicitly
told not to run tests on a memory-constrained workstation) and CI formed three layers with no
floor under them, so a change breaking a test outside its own Touch-Paths could pass every gate.
That was not hypothetical: PR #742 merged green and left main red, caught only because an
unrelated worker ran the suite as voluntary diligence. This PR adds a `Run test suite` step to
`.github/workflows/verify.yml`, putting a floor under all three layers.

## CI red-trial (the AC proof method)

The plan proposed proving the AC with a local flip-run-revert; the orchestrator overrode that,
because a local run cannot prove the step runs in CI and turns the check red — the exact
assumption whose failure created this issue.

1. Baseline: run [33618470429](https://github.com/CorentinLumineau/blackhole/actions/runs/33618470429) — green, new `Run test suite` step passes (1570/0).
2. Red-trial: commit `935059f9` flipped one assertion in `scripts/lib/fs.test.ts` — run [33618585096](https://github.com/CorentinLumineau/blackhole/actions/runs/33618585096) went red at the new `Run test suite` step, confirming the step actually gates the check.
3. Revert: commit `1dee2c86` reverted the flip — run [33618656543](https://github.com/CorentinLumineau/blackhole/actions/runs/33618656543) went green again.

The intermediate flip commit is sanctioned trial evidence, not a violation of the issue's
"Out: changing any test" scope — `git diff origin/main...HEAD -- '*.test.ts'` is empty on the
final head, confirmed again after this artifact's rebase onto current main.

## The 30 failures the first real CI run surfaced

`ubuntu-latest` has no global git identity, so `withLinkedWorktree`'s `git commit --allow-empty`
failed silently (`spawnSync` result unchecked) and cascaded into 30 unrelated assertion failures
in `hooks-validate-file.test.ts` / `hooks-validate-bash.test.ts`. Fixed by adding a
`git config --global` step to `verify.yml` — the environment — and explicitly not by skipping or
weakening the 30 tests, which is the shortcut this issue exists to prevent. The unchecked-
`spawnSync` root cause is filed separately as #756.

## Step-placement question

"Run test suite" sits before "Run build" in `verify.yml`. Build-dependent tests call
`runFullBuildOnce()` (`scripts/lib/check-common.ts:42-48`), which spawns `bun run build` inside
the test process itself and memoizes the result — so those tests are self-sufficient regardless
of the outer step order. Finding #2 above stays open because that invariant lives only in this
review's reasoning, not in a comment at the step — a future reorder to the "tidier" Run-build-then-
test sequence would silently turn `scripts/verify.hooks.test.ts:18`'s on-disk bundle check into a
tautology (it reads committed bundle trees with no self-invoked build of its own).

## Local/CI test-file-count discrepancy — investigated and dismissed

96 test files locally on this branch vs. 98 in CI was raised as a possible environment
difference and dismissed on evidence: this branch's base `2fe253e9` genuinely has 96 test files,
and main has 98 — the two `carry-staged-artifacts` suites from #715 merged (via #745) after this
branch was cut. `pull_request` CI checks out the merge ref, so CI sees both. No issue filed; no
further investigation needed.

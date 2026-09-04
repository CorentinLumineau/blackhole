---
type: review
summary: "Review artifact for issue #756 (LGTM)"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
issue: 756
---

# Review: `blackhole/issue-756` (9d880d3)

**Verdict: LGTM** — 0 BLOCK, 1 WARN at merge-readiness.

Diff: PR #789, branch `blackhole/issue-756`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 2 BLOCK/WARN row(s) for issue #756, 1 deferred |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `scripts/hooks-validate-bash.test.ts:726` | V-INT-03 | **WARN** | [turn 18, impl-756, self-reported] A near-duplicate local runGit now exists at hooks-validate-bash.test.ts:726-736 alongside the new exported one in test-fixtures.ts. Deliberately out of scope: the issue body fences that file as Out, and deduplicating it would widen Touch-Paths without an orchestrator Scope Amendment. The implementer flagged it as a follow-up rather than silently widening scope, which is the correct handling — the local copy also lacks the two additions the new shared helper has (encoding utf-8 and a result.error check), so a future dedup is a real improvement and not merely cosmetic. Kept open in the ledger for a future wave. |
| 2 | `scripts/lib/test-fixtures.test.ts:1` | V-TEST-05 | **NOTE** | [turn 18, TOOLCHAIN TRAP recorded for reuse, not a defect of this PR] The plan discriminating test was designed around an env-sandboxed identity-less git commit, mutating process.env to strip the author identity. That trigger is NON-FUNCTIONAL on Bun 1.3.14: spawnSync called WITHOUT an explicit env option ignores live process.env mutations, so the sandboxing has no effect and the intended failure never occurs. The implementer detected this, switched to the plan own named fallback (a cwd outside a git repo, status 128, by deleting .git mid-fixture), verified the replacement reproduces the exact cascading-ENOENT symptom named in the issue Objective against unmodified main, and REPORTED the substitution rather than silently weakening the assertion — which the brief explicitly required. Recorded here because the underlying Bun behaviour will bite any future test that tries to sandbox a subprocess by mutating process.env: pass env explicitly to spawnSync or the mutation is invisible to the child. |

### Deferred (not counted toward verdict)

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/lib/test-fixtures.ts:133` | V-DOC-06 | WARN | [turn 18, review-756] Incident archaeology in prose source comments: the (#756/#747: a masked git commit failure surfaced only as an unrelated downstream fs.realpathSync ENOENT) clause inside runGit JSDoc, repeated at test-fixtures.test.ts:60 and :79 as plain // comments. The reviewer drew the distinction the rule actually makes rather than flagging every issue number it found: test-fixtures.test.ts:90 describe('...(#756/#747)') is EXEMPT, because a regression test may carry its issue number in the function or describe name, and hooks-validate-bash.test.ts establishes that precedent throughout at :61, :328 and :854. Only the prose comments are archaeology. Thirteenth consecutive PR to fire V-DOC-06. | #779 |

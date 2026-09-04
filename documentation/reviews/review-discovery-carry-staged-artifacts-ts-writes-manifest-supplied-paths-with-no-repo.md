---
type: review
summary: "Review artifact for issue #752 (LGTM)"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
issue: 752
---

# Review: `blackhole/issue-752` (f1d719d)

**Verdict: LGTM** — 0 BLOCK, 0 WARN at merge-readiness.

Diff: PR #783, branch `blackhole/issue-752`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 0 BLOCK/WARN row(s) for issue #752, 4 deferred |

## Findings

_No BLOCK/WARN findings at merge-readiness._


### Deferred (not counted toward verdict)

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/lib/carry-staged-artifacts.ts:218` | V-SEC-01 | BLOCK | [turn 18, raised by impl-752 as Accepted Risk, ESCALATED to BLOCK after empirical probing] PR #783 containment gate bounds target_path at repoRoot but does not constrain where INSIDE the repo an entry writes, and several in-repo targets are executed by the campaign itself right after the carry step. Probed with real carryManifest on temp fixtures: package.json was fully overwritten with attacker content, and implementer.md runs bun test / bun run verify immediately after carry, so this is arbitrary code execution in the NORMAL flow with no CI, no commit and no reviewer required. A .github/workflows/verify.yml overwrite also carried, giving CI execution before any review gate settles since CI runs on push. .git/hooks/pre-commit threw ENOTDIR in the worktree shape (where .git is a gitdir FILE) but was written successfully when repoRoot is a plain clone; that vector additionally needs an executable bit, which writeFileSync does not set (no chmod or mode argument anywhere in the carry code), so it is file-overwrite rather than execution unless a future edit adds one. Nothing upstream constrains target_path: staging-schema.check.ts has zero references to it and blackhole-state.md § Staging only says targets are usually under documentation/, which is advisory prose, not a gate. NOT a defect of PR #783, whose scope correctly excluded narrowing per #752 AC bullet 5; this is the follow-on that boundary leaves open. Orchestrator scored gain 9 / effort 3 = Priority 72. Worker self-corrected its own V-code from V-SEC-05, which does not exist in the blackhole table, to V-SEC-01. \| turn 18 INDEPENDENTLY CONFIRMED by review-752 (security mode, premium tier) — V-SEC-07 adversarial validation satisfied, two separate agents reached this finding by different routes. The reviewer found a STRONGER vector than either the orchestrator or impl-752: scripts/verify.ts:4-20 glob-discovers scripts/checks/*.check.ts, dynamically imports each and calls runChecks(), and implementer.md step 6 runs the carry at bullet 1 with bun run verify at bullet 3 in the SAME session — so target_path scripts/checks/zz-pwn.check.ts is arbitrary local code execution before commit, push or review, needing no traversal primitive whatsoever. Reviewer drove the PR own containment helpers verbatim to confirm the gate permits it. Additional confirmed variants: package.json (overwrites the verify script), scripts/**/*.test.ts via bun test, .claude/hooks/*.js, and .github/workflows/verify.yml whose runs-on expression can be set to [self-hosted, mba] to relocate execution onto the maintainer machine on a same-repo pull_request carrying full secrets and a writable GITHUB_TOKEN. Reviewer also established why no existing control catches it: validateEntries (:66-94) checks field presence and the target_kind enum only; staging-schema.check.ts never references target_path; sensitiveFiles[] holds no matching pattern so the V-SEC-11 staging gate passes it to git add; the PreToolUse Write/Edit hook cannot observe fs.writeFileSync inside a bun subprocess; and decideCopyMode returns verbatim for produced_by planner so payload bytes are attacker-controlled. Canonical line reference is :271 rather than the :218 recorded above. Reviewer classified the plan Threat Model entry (Information Disclosure / Medium / Accepted Risk) as a MISCLASSIFICATION rather than merely a scope choice, since reachable impact is Tampering / Elevation of Privilege — the risk was accepted against the wrong impact. | #784 |
| 2 | `scripts/lib/carry-staged-artifacts.ts:233` | V-PAT-03 | WARN | [turn 18, secondary defect found by impl-752 while probing] The ENOTDIR case from mkdirSync throws UNCAUGHT, aborting the entire carry rather than skipping the offending entry. This contradicts the skip-not-throw failure mode PR #783 deliberately established for adversarial entry content, where a violating entry joins skipped[] and the rest of the manifest still carries. One malformed or hostile entry can therefore deny the whole carry — a denial-of-service on the carry step, and an inconsistency in the module own error contract rather than a missing feature. Folded into #784 AC3 rather than filed separately, since the fix touches the same guard block. | #784 |
| 3 | `scripts/lib/carry-staged-artifacts.ts:233` | V-DOC-06 | WARN | [turn 18, review-752, confidence 70 — reviewer flagged its own low confidence and said verify before acting] Issue-number archaeology in source comments: Path containment (issue #752) in the carryManifest JSDoc at :233, plus a plan-artifact citation in a test comment at carry-staged-artifacts.test.ts:406. The reviewer argued BOTH SIDES rather than filing reflexively: both match the file own established untouched convention (Two-root resolution (issue #760) already sits in the same file), so V-INT-01 pulls the other way, and the test comment is load-bearing because it stops a future developer flipping a correct path.join assertion — only the bare (issue #752) token is severable, never the explanation. Tenth consecutive PR to fire V-DOC-06, which is itself the signal that the convention question needs settling rather than the finding needing re-filing each time; that is exactly what #779 exists to decide. | #779 |
| 4 | `scripts/lib/carry-staged-artifacts.ts:266` | V-SEC-01 | WARN | [turn 18, review-752, suppressed as a finding under the Suggestion Proportionality Gate but recorded because it constrains the #784 fix] The containment gate compares RESOLVED paths (nearest-existing-ancestor realpath on both sides) but the subsequent fs.mkdirSync and fs.writeFileSync at :266 and :279 operate on the UNRESOLVED path — a check-then-use gap of the TOCTOU class. Unreachable today: the carry loop holds no symlink-creating primitive, so no manifest entry can prepare a swap for a later entry to traverse, which is why the reviewer correctly declined to file it against this PR. Recorded as a binding constraint on any future narrowing: the fix must compare and write through the SAME resolved path rather than re-deriving it, or the gap becomes live the moment anything in that loop can create a filesystem link. | #784 |

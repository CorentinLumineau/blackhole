---
type: review
summary: "Review artifact for issue #774 (LGTM)"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
issue: 774
---

# Review: `blackhole/issue-774` (53c64c1)

**Verdict: LGTM** — 0 BLOCK, 1 WARN at merge-readiness.

Diff: PR #786, branch `blackhole/issue-774`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 1 BLOCK/WARN row(s) for issue #774, 5 deferred |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `templates/hooks/pretooluse/patterns/bash-patterns.json:1` | V-TEST-05 | **WARN** | [turn 18, impl-774, below the Pareto gate so logged not filed] The rm-no-preserve-root rule is unreachable for its own canonical form: the validator returns the FIRST matching rule in array order, and the canonical command satisfies rm-rf-root first. Safety is unaffected — the command is still denied at block tier — but the rule own observability is dead, so a hook event for that form will never carry that pattern_id and any future log analysis keyed on it silently sees zero hits. The implementer characterization test asserts the OBSERVED id with an inline comment explaining the ordering, so the test pins real behaviour rather than encoding the plan assumption. bash-patterns.json untouched by that PR. gain 3 / effort 2 = Priority 27, below the 30 gate. Kept open in the ledger for a future wave rather than dropped. |

### Deferred (not counted toward verdict)

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/hooks-validate-bash.test.ts:1260` | V-DOC-06 | WARN | [turn 18, review-774, confidence 88] Added block comment in the test file embeds both V-DOC-06 signatures — an issue number in the comment body and change-history prose of the previously-this-only-checked-Y form. Reviewer recorded the counter-argument rather than filing reflexively: 14 pre-existing issue-citing comments in this test file and 9 in the guard source mean V-INT-01 pulls the other way. Notably the guard SOURCE is clean — impl-774 stripped the plan own citation from the new docstring — so the finding is confined to the test file. Twelfth consecutive PR to fire V-DOC-06; the recurrence itself is the argument that #779 needs to settle the convention rather than each PR re-litigating it. | #779 |
| 2 | `templates/hooks/pretooluse/utils/worktree-removal-guard.js:1` | V-TEST-09 | WARN | [turn 18, impl-774, SPLIT by the orchestrator] Coverage is unmeasurable for this file: it executes only inside a subprocess spawned by runPreToolUseHook, so bun test --coverage never instruments it and no line/function delta exists on either side of the change. The implementer reported the gate as UNMEASURABLE rather than passing, and declined to dress up a 0 -> 18 end-to-end behavioural case increase as a coverage-percentage claim — correct, and the reason the problem is visible at all, since the default outcome is silence. Tree-wide: every file under templates/hooks/** shares the blind spot, so a BLOCK-severity gate silently degrades to a no-op across the whole subtree. ORCHESTRATOR SPLIT the worker single gain 4 / effort 6 = Priority 20 score into two concerns, because they have very different cost/benefit: (a) actually instrumenting hook modules stays at Priority 20, below the gate, logged here and NOT filed; (b) stopping workers from reporting an unmeasurable gate as passing scores gain 6 / effort 2 = Priority 54 and was filed as #787. Gain on (b) is 6 rather than 4 because the benefit is not more coverage signal but the campaign ceasing to assert that a BLOCK gate passed when it was never evaluated. Same defect class as #782, where V-AUTO-02 cannot fire because it diffs against a manifest that was never written. | #787 |
| 3 | `templates/hooks/pretooluse/utils/worktree-removal-guard.js:195` | V-PARETO-02 | WARN | [turn 18, review-774, security mode premium] RESIDUAL FAIL-OPEN of the same class as #774, pre-existing and untouched by this PR: the guard recognises the executable only as the bare literal token git. Executed against the branch own module and independently reproduced by the orchestrator — backslash-escaped \git, double-quoted, single-quoted, quoted path-qualified, empty-string-split g""it, command substitution and env-var indirection ALL yield 0 invocations, so evaluateWorktreeRemoval returns null and removal proceeds with no unpushed-commit check. Cheapest bypass is ONE CHARACTER. Attack scenario per V-SEC-06: a worker holding committed-but-unpushed history issues the backslash-escaped spelling, bash strips the backslash and runs git, the guard finds nothing, commits are destroyed — exactly F-00117 loss shape reached by a spelling change. Two mechanisms produce it: :103 rejects backslash- and quote-preceded matches outright, and :195 tokens[0] !== git drops matches the new predicate does admit. Orchestrator addition: #781 produces SPURIOUS refusals on fully-pushed branches (reproduced twice this session), which actively trains callers to invent a spelling that gets past the guard — the false-refusal defect and this bypass compound each other. gain 8 / effort 3 = Priority 64. Filed as #788 with the reviewer measured table and a revised two-piece fix design. | #788 |
| 4 | `templates/hooks/pretooluse/utils/worktree-removal-guard.js:115` | V-PARETO-02 | WARN | [turn 18, review-774] The new docstring asserts a universal that is false for a common path shape: it claims a git that is merely an interior path segment is admitted but cannot form an invocation. True only for an INTERIOR segment. When git is the LAST segment — /srv/git, ~/git, /home/u/git, all ubiquitous — the clause tail begins with the invocation and one IS formed: measured inv=2 for a trailing segment versus inv=1 for an interior one, confirmed independently by the orchestrator. Not a bypass and not a spurious deny, since the duplicate carries identical argTokens and the ANY-unsafe fold can only tighten, but it is a load-bearing safety rationale a future editor will read as permission to skip the tokens[0] check, and the new suite pins ONLY the interior case so nothing would catch that edit. NOTE this is the case both the orchestrator and impl-774 missed: the orchestrator required a test for path-segment false positives, impl-774 correctly rebutted for the interior shape, the orchestrator accepted the rebuttal, and neither tested the trailing shape. gain 3 / effort 1. Folded into #788 rather than filed separately since the remedy touches the same docstring and test file. | #788 |
| 5 | `templates/hooks/pretooluse/utils/worktree-removal-guard.js:121` | V-DRY-03 | WARN | [turn 18, review-774, confidence 95] The shell-word-boundary character class is now duplicated between isCommandWordStart at :103 and the new isPathQualifiedGitWordStart at :121. Two predicates that must agree on what a boundary is now encode it twice, so adding a boundary character to one and not the other makes them silently disagree — and #788 fix will do exactly that, widening the predecessor set to backslash and quote characters. Remedy: extract a named SHELL_WORD_BOUNDARY_RE and share it. Applies to all 4 generated dist copies. Sequenced into #788 because that fix touches these same two predicates and would otherwise have to duplicate the widening. | #788 |

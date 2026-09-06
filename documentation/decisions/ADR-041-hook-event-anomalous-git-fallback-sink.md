---
type: adr
summary: "recordEvent gains a CLAUDE_PROJECT_DIR-derived fallback sink for the anomalous branch of mainCloneRoot's new routine/anomalous git-failure discrimination (mirrors #864/PR #888's hasGitMarkerInAncestry pattern), with an unconditional distinguishing stderr line naming the sink tier used; Option B (fail-closed) rejected by both blind critics as CRITICAL — it can convert a PreToolUse deny into an allow; critic B's CRITICAL on Option C (CLAUDE_PROJECT_DIR may resolve to a worker's worktree, not the main clone) accepted as a residual risk by owner ruling, mitigated but not eliminated by the unconditional-stderr amendment"
status: accepted
review_trigger: "on #893 hardening CLAUDE_PROJECT_DIR resolution, or on a new git-shelling resolver adopting the routine/anomalous discrimination pattern"
created: 2026-09-06
last_updated: 2026-09-06
related:
  - documentation/decisions/ADR-029-bash-write-target-worktree-containment.md
  - documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md
---

# ADR-041: Discriminate anomalous git failures in `mainCloneRoot` and add a `CLAUDE_PROJECT_DIR` fallback sink for hook-event records

## Status

Accepted — 2026-09-06 (owner ruling, campaign design-approval gate; issue #889). The
deterministic `scripts/design-aggregate.ts` verdict was `blocked`; see § Gate for the verdict,
the scorer split, and the terms on which the ruling resolved it.

## Requirements Framing

`templates/hooks/pretooluse/utils/hook-event-log.js:79`'s `mainCloneRoot(cwd)` runs
`git rev-parse --git-common-dir` in a bare `try/catch` and returns `null` on **any** failure.
`recordEvent` (line 343) uses it to resolve the durable event sink
`<main-clone>/.blackhole/hook-events/`; on `null` it logs `no git context — event not recorded`
and drops the record. Those records are the sole input to the orchestrator's `V-HOOK-01/02/03`
triage (`orchestrator-runtime.md` § Triage step 1b → `findings-ledger.json`); a dropped record
means an issue can advance past implement as though no hook ever fired.

Two facts settle the diagnosis:

1. **Exit code and stderr cannot discriminate.** `git rev-parse --git-common-dir` over a repo
   whose `.git/HEAD` is missing and over a directory with no repository at all both emit
   `fatal: not a git repository (or any of the parent directories): .git`, exit 128 — git's
   `fatal()` bucket collapses both. Issue #864 / PR #888 established this for the sibling
   `allWorktreeRoots` resolver and fixed it by consulting a positive filesystem fact instead:
   `hasGitMarkerInAncestry(cwd)` (line 116), which walks ancestors for a `.git` entry. Absent ⇒
   routine, return `null`. Present ⇒ git is broken over a repository that is really there ⇒
   anomalous, propagate the throw.
2. **The mechanism is pure reuse.** `hasGitMarkerInAncestry` and `mainCloneRoot` are top-level
   consts in the same module; `allWorktreeRoots` already calls the former. No export, no
   circular reference — `V-INT-02` clean.

The requirement is narrow: given the anomalous case can now be detected, decide what
`recordEvent` does with it. `denyAndRecord(event)` calls `recordEvent(event)` and **then**
`emit()`s the PreToolUse deny (exit 2); `failClosed(...)` — the handler for a validator crash, a
malformed payload, or a pattern-load failure — itself routes through `denyAndRecord` →
`recordEvent`. `scripts/lib/build/claude-native-settings.ts`'s generated wrapper captures the
validator's exit code: 0 and 2 pass through verbatim; every other exit code is treated as
"validator could not run" and the tool call is **allowed** (fail-open). A throw escaping
`recordEvent` on the deny path therefore does not merely lose an audit record — it escapes
`denyAndRecord` before `emit()` runs, is routed to `failClosed` → `denyAndRecord` →
`recordEvent` a second time, throws again from inside the catch block, exits 1, and the wrapper
converts the intended **deny into an allow**. This is not hypothetical: issue #893
(`F-00079`, `V-HOOK-03`) records a real `validate-bash-command` invocation that exited 1 before
producing a decision, with seven more records of the same shape from 2026-08-12.

## Decision

Adopt **Option C, with the unconditional-stderr amendment**, as ruled by the owner with critic
B's CRITICAL finding explicitly in view.

1. `mainCloneRoot` mirrors `allWorktreeRoots`'s discrimination exactly: `catch (error) { if
   (!hasGitMarkerInAncestry(cwd)) return null; throw error; }`.
2. `recordEvent` wraps its `mainCloneRoot(cwd)` call in a local `try/catch` and never propagates
   a throw. On the anomalous branch, before giving up, it falls back to
   `process.env.CLAUDE_PROJECT_DIR` (accepted only when `path.isAbsolute()` and an existing
   directory) and writes to `<CLAUDE_PROJECT_DIR>/.blackhole/hook-events/` — the same directory
   `claude-native-settings.ts`'s wrapper already writes its own `hook-exec-failure` records to,
   with no git call at all, and the same directory the orchestrator already polls. Sink
   precedence: `BLACKHOLE_HOOK_EVENT_DIR` → `mainCloneRoot(cwd)` → `CLAUDE_PROJECT_DIR`
   (anomalous branch only) → loud drop. The routine "no git context" branch is unchanged —
   the fallback fires only on the anomalous branch.
3. **The amendment**: on the anomalous branch, `recordEvent` **always** writes a stderr line
   distinguishable from today's routine message, naming which sink tier it used
   (`fallback` or `dropped`) — whether or not the fallback succeeded. A silent fallback success
   is a defect, not a pass. This is part of the decision, not an optional follow-on: it is what
   makes Option C strictly dominate Option A on observability instead of trading against it.

`recordEvent` never throws on any branch — this is the load-bearing invariant that keeps a
throw from ever reaching `denyAndRecord`/`failClosed` and converting a deny into an allow.

## Alternatives Considered

**Option A — Loud local catch, sink unchanged (rejected).** `recordEvent` catches the anomalous
throw locally, writes a distinguishable stderr line, and returns — the event file is still not
written anywhere. Simplest, and never causes harm, but the load-bearing risk stays in place: its
only remedy travels through the worker's own transcript, which the module's docstring already
declares untrustworthy for exactly this purpose. Both blind critics confirmed, independently and
in stronger terms than the primary: Triage globs `.blackhole/hook-events/*.json` files, not hook
subprocess stderr, so on the anomalous branch Option A is exactly as invisible to Triage as
today's silent drop — only a human tailing logs mid-flight benefits. Critic B additionally found
that Option A's loudness is reliable only for BLOCK-tier events; `warnAndRecord` exits 0 and its
stderr is not guaranteed to surface anywhere durable, so Option A reverts to silence for
WARN-tier events.

**Option B — Fail closed (rejected, CRITICAL by both blind critics).** `recordEvent` does not
catch; the throw propagates to the validator's top-level catch-all → `failClosed` → deny,
matching `validate-file-changes.js`'s declared fail-closed posture for `allWorktreeRoots`
(ADR-029). As literally stated this is not a complete option: `failClosed`'s own `recordEvent`
call throws again from inside the catch block, producing the exit-1 → wrapper-allow path
described above — the naive form inverts the module's own fail-safe-defaults invariant into
fail-*open*, the opposite of its intent. A corrected form would have to restructure so the
fail-closed path's own `recordEvent` cannot re-throw, i.e. it absorbs part of Option A anyway,
and even then leaves a fragile dual-mode contract ("`recordEvent` must throw when called
directly but must not throw when called from inside `failClosed`") that no type or naming
convention enforces (critic B). On the `warnAndRecord` path it also converts an allow into a
deny — a DoS risk if git becomes permanently unreadable (e.g. `git` missing from PATH) campaign-
wide. Both critics independently returned a `discriminating` + `CRITICAL` finding against B; no
scorer picked it as winner under any weighting.

**A fourth shape — deriving the main-clone root from the filesystem by parsing the `.git`
marker directly** (directory ⇒ its parent; `gitdir:` file ⇒ parse plus the `commondir` file) —
was considered and dropped before scoring. It covers the case `CLAUDE_PROJECT_DIR` cannot, but
reimplements git's own worktree resolution inside a fallback whose whole premise is that git is
broken (`V-KISS-01`/`V-YAGNI-01`), for a case `CLAUDE_PROJECT_DIR` already covers wherever these
hooks actually run today (all three deployment trees are Claude Code plugin bundles).

## Options + Trade-off Matrix

Decision type `architecture-choice` (`design-rubric.md`). Fixed columns and weights: Risk 30,
Maintainability 25, Complexity 20, Reversibility 15, Consistency-with-existing-pattern 10.

| Option | Risk (30) | Maintainability (25) | Complexity (20) | Reversibility (15) | Consistency (10) | Weighted |
|--------|-----------|----------------------|-----------------|--------------------|------------------|----------|
| A | 2 | 4 | 5 | 5 | 3 | 3.65 |
| B | 1 | 2 | 3 | 4 | 3 | 2.30 |
| **C (accepted)** | 4 | 4 | 3 | 4 | 5 | **3.90** |

Both blind critics scored all three independently, blind to the primary's provisional choice:

| Scorer | A | B | C | Winner | Margin |
|--------|---|---|---|--------|--------|
| primary | 3.65 | 2.30 | 3.90 | Option C | 6.41% |
| critic_a | 3.80 | 1.75 | 4.05 | Option C | 6.17% |
| critic_b | 4.20 | 2.05 | 3.60 | Option A | 14.29% |

## Adversarial Evaluation

All three scorers agree Option B is dead (see § Alternatives Considered). Both critics also
independently confirmed the primary's central objection to Option A: it is loud only on the
transcript channel the module's docstring already declares untrustworthy, and only reliably so
for BLOCK-tier events.

**Where critic B diverged — the reason this design blocked on `design-aggregate.ts`.** Critic B
returned a `discriminating` + `CRITICAL` finding on Option C that neither the primary nor critic
A raised:

> The `CLAUDE_PROJECT_DIR` fallback assumes that env var resolves to the same directory the
> orchestrator polls. In a per-worker linked-worktree topology, `CLAUDE_PROJECT_DIR` may instead
> point at the worker's own worktree root. The fallback record then lands at
> `<worktree>/.blackhole/hook-events/` — a location Triage never inspects, and one that
> `blackhole-protocol.md`'s Worktree & Branch Hygiene rules routinely delete once the worktree is
> released. That converts the anomalous case into a **quiet false success** rather than Option
> A's loud, at-least-visible drop.

This finding is correct on its facts and is **accepted as a residual risk**, not dismissed and
not engineered around with a topology guard (e.g. gating the fallback on `<dir>/.blackhole/
hook-events/` already existing was considered by the owner and explicitly declined — adding it
would silently narrow the fallback's coverage on exactly the deployments where it is needed
most, and the module's own docstring already accepts a comparable un-closed gap: a worker with
Bash access can delete its own event file before Triage ingests it). Two facts bound the risk
without dissolving it:

1. The wrapper at `claude-native-settings.ts` already writes to exactly
   `$CLAUDE_PROJECT_DIR/.blackhole/hook-events` unconditionally, with no git check, for every
   hook invocation in this campaign today (critic B's own `domain-inherent` finding). Option C
   extends an already-load-bearing trust boundary to a second code path; it does not invent one.
2. Under this campaign's actual topology, workers are subagents of the orchestrator's own
   session, so `CLAUDE_PROJECT_DIR` is the session project root — the main clone. The failure
   critic B describes requires a worker launched as a *separate* `claude` process with its cwd
   in a worktree.

The observability regression critic B identified is real and independent of topology: as
originally specified, C printed nothing when the fallback write succeeded, so an operator lost
the signal A always gave. **The unconditional-stderr amendment is the accepted mitigation**: the
anomalous branch always emits the distinguishing line naming the sink tier used, so a fallback
write is never a *silent* success even where it lands somewhere Triage cannot see. The residual
that survives the amendment — the record itself may still be written and then deleted with a
released worktree — is accepted, is identical to the wrapper's own pre-existing exposure, and is
tracked as the overlap with issue #893 (see § Consequences).

Critic A's only finding against C was a `MINOR`, downgraded by critic A itself on the same
"second consumer of an existing trust boundary" reasoning: the fallback is guarded solely by
absolute-and-existing-directory, so a stale env var could route a record to a valid-looking
wrong directory.

**Domain-inherent findings (informative, non-discriminating).** Both critics flagged the same
two: none of the three options close the module's documented adversarial-tamper gap (a worker
with Bash access can delete its own event file before Triage ingests it), and all three touch
`templates/hooks/**` so `V-PLUGIN-01`'s version-bump gate (ADR-030) applies regardless of which
option wins.

## Component Decomposition

N/A — single-component design. The decision changes two functions inside one file
(`hook-event-log.js`: `mainCloneRoot`, `recordEvent`), introduces no new module, and moves no
boundary between responsibilities.

## Design Principles Validation

| Axis | Score | Justification |
|------|-------|----------------|
| SRP | ✓ | `mainCloneRoot` keeps one job (resolve the root); deciding what a failure *means* stays with the caller, where the stakes differ. |
| DIP | ✓ | The sink is resolved through an ordered precedence of injected inputs (env override, git, env fallback) rather than a single hard dependency on git. |
| DRY | ✓ | Reuses `hasGitMarkerInAncestry` (#864's discriminator) and `CLAUDE_PROJECT_DIR` (the wrapper's existing sink) — no new mechanism introduced. |
| KISS | ~ | The three-tier precedence is the most complex of the three options, though each tier is a few lines. |
| YAGNI | ✓ | The dropped fourth option (parsing `.git` markers by hand) was rejected precisely on this axis; no capability is added without a demonstrated failure. |
| Pattern — fail-safe defaults | ✓ | Preserves the module's stated invariant ("recording is best-effort; the decision never is"). Option B was rejected precisely for inverting it. |

## Refactoring Impact Analysis

`mainCloneRoot`'s contract changes from "null on any failure" to "null on routine absence,
throws on anomalous failure". Consumers, from a repo-wide grep:

| Consumer | Classification | Note |
|----------|----------------|------|
| `hook-event-log.js` `allWorktreeRoots` (`if (!mainClone) return null`) | TRANSPARENT | Practically unreachable: `git worktree list --porcelain` succeeded on the line above, so repo discovery works and `rev-parse --git-common-dir` cannot then fail except on an interleaving that breaks git between two consecutive subprocesses. On that interleaving the throw propagates to `validate-file-changes.js`'s existing catch, which already fails closed by declared posture (ADR-029). |
| `hook-event-log.js` `recordEvent` | TRANSPARENT | Updated in the same diff. Routine no-git-context branch stays byte-identical. |
| `hook-event-log.js` `module.exports.mainCloneRoot` | TRANSPARENT | Repo-wide grep finds no consumer outside this module; the two test references are comments. |
| `plugins/blackhole/hooks/utils/hook-event-log.js`, `plugins/blackhole-claude/hooks/utils/hook-event-log.js` | TRANSPARENT | Build outputs regenerated by `bun run build`; never hand-edited. |
| `scripts/hooks-validate-file.test.ts` | TRANSPARENT | Pins `BLACKHOLE_HOOK_EVENT_DIR`, bypassing `mainCloneRoot` entirely — tier 1 of the precedence is unchanged. |

No BREAKING consumer. The `allWorktreeRoots` row deserves the explicit reachability argument
rather than a bare classification, because the *outcome* there does change (fail-open cwd-bound
containment → fail-closed deny) even though no call site needs editing; it is TRANSPARENT
because reaching it requires git to break between two consecutive calls, and because the
posture it lands on is the one `validate-file-changes.js` already declares for this exact class.

## Assumption Audit

| # | Assumption | Mark | Note |
|---|-----------|------|------|
| 1 | Exit code / stderr cannot distinguish corrupt from absent | ✓ | Re-verified empirically: both emit `fatal: not a git repository`, exit 128. |
| 2 | `hasGitMarkerInAncestry` is safely callable from `mainCloneRoot` | ✓ | Same-module top-level consts; referenced inside a function body, resolved at call time. |
| 3 | `CLAUDE_PROJECT_DIR` is set wherever these hooks run | ✓ | All three deployment trees are Claude Code plugin bundles, and the generated wrapper already depends on the variable. |
| 4 | `CLAUDE_PROJECT_DIR` resolves to the main clone, not a worktree | ~ | Critic B's CRITICAL, accepted as residual risk (see § Adversarial Evaluation and § Consequences). True for subagent workers in this campaign's topology; false for a worker launched as a separate `claude` process in a worktree. |
| 5 | The anomalous case is reachable in practice | ~ | Realistic triggers: `git` missing from PATH, malformed `.git/config`, permission loss on `.git`, resource exhaustion — not a hand-deleted `HEAD`. Each is plausible; none is common. |
| 6 | Losing the *record* is a lesser harm than losing the *decision* | ✓ | The record feeds after-the-fact accounting; the decision is the enforcement. Every option keeps `emit()` reachable, and this is why Option B is rejected. |
| 7 | Nothing else consumes the exported `mainCloneRoot` | ✓ | Repo-wide grep; the only hits outside the module are comments in `scripts/hooks-validate-file.test.ts`. |

## Gate

`autonomy.design_autonomy` is `true`, so `scripts/design-aggregate.ts` was invoked with the
primary's weighted matrix, both blind critics' raw JSON, and the Refactoring Impact rows:

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance", "disagreement"],
  "scorer_results": [
    { "scorer": "primary",  "winner": "Option C", "margin": 6.41 },
    { "scorer": "critic_a", "winner": "Option C", "margin": 6.17 },
    { "scorer": "critic_b", "winner": "Option A", "margin": 14.29 }
  ]
}
```

Two independent blocks: no scorer cleared the 30-point `design_dominance_delta`, and the critics
disagreed on the winner.

**Resolved by owner ruling, 2026-09-06**, via the campaign design-approval gate, with critic B's
CRITICAL explicitly in view — the owner was shown it directly, alongside a variant that would
have guarded the fallback on `<dir>/.blackhole/hook-events/` already existing, and selected
**plain Option C plus the unconditional-stderr amendment** without that guard. The ruling is not
a finding that the aggregate script erred, and it does not overrule critic B's dissent as
wrong — the dissent is recorded above and in § Consequences as an accepted, owner-acknowledged
residual risk, mitigated (not eliminated) by the amendment.

**Cross-Cutting Heuristic (ADR-012 E3, Trigger A)**: 1/3 — Breadth ✗ (the change is confined to
two functions in one module, `hook-event-log.js`; it extends an already-accepted pattern from
ADR-029 to a second call site rather than establishing a rule spanning independent subsystems),
Enforcement stakes ✓ (violating the never-throw invariant recreates the exact deny→allow
conversion mechanism `V-HOOK-03` exists to catch), Foreclosure ✗ (it does not rule out a category
of future approaches — ADR-029 already foreclosed "swallow git failures to null uniformly" for
this module; this decision applies that foreclosure to a second function and adds a specific,
narrow fallback sink, rather than establishing a new one). Score below the 2/3 promotion
threshold — **no `ARCHITECTURE.md` § Active Constraints entry is staged for this ADR.**

## Consequences

**Positive**: closes the `V-HOOK-01/02/03` audit-drop gap for the anomalous-git-failure case
without ever risking a deny→allow conversion; reuses two already-established mechanisms
(`hasGitMarkerInAncestry`'s discrimination, the wrapper's `CLAUDE_PROJECT_DIR` sink) rather than
inventing a third; the unconditional-stderr amendment means the fallback can never regress
observability relative to the simpler Option A.

**Negative / accepted residual risk**: in a topology where a worker's `CLAUDE_PROJECT_DIR`
resolves to its own worktree rather than the main clone, the fallback write lands somewhere
Triage never polls and that worktree cleanup later deletes — critic B's CRITICAL, accepted by
the owner rather than engineered around with an existence guard, on the reasoning that (a) the
wrapper already carries this identical exposure unconditionally today, and (b) this campaign's
current topology runs workers as subagents of the orchestrator's own session, where
`CLAUDE_PROJECT_DIR` is the main clone. The amendment prevents this from being a *silent* false
success — the anomalous-branch stderr line always fires — but does not prevent the record itself
from eventually being lost if the worktree is released before anyone reads the stderr. Neither
this decision's mechanism nor #893 alone closes that residual; see the overlap note below.

**Overlap with issue #893.** #893 asks that a fail-open hook execution be visible *in-session*
by reusing an existing signal mechanism (plugin-drift / doc-health). This decision makes more
audit records exist; #893 makes existing records noticed. The two are complementary, not
conflicting, and neither blocks the other. The one shared surface is `CLAUDE_PROJECT_DIR` as a
sink — if #893's implementation ends up hardening that resolution (e.g. distinguishing a
worktree-scoped value from a main-clone value), this decision's fallback inherits the fix for
free with no further change here. No dependency edge is created between the two issues; either
may land first.

**Operational**: `mainCloneRoot`'s docstring gains the routine/anomalous split, pointing at
`allWorktreeRoots`'s own docstring for the "git's `fatal()` bucket collapses both" rationale by
reference rather than restatement (`V-DOC-05`); `recordEvent`'s docstring gains the three-tier
sink precedence and the unconditional-stderr contract. `V-PLUGIN-01` (ADR-030) applies: the same
diff must bump `package.json`'s version. Full task breakdown and per-task TDD acceptance
criteria: `.blackhole/plans/issue-889.md` § Task Breakdown.

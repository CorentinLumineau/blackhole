---
status: accepted
---

# ADR-029: Extend assigned-worktree write containment to Bash file-write commands

## Status

Accepted

## Context

Issue #804: an implementer worker dispatched with an assigned worktree began editing files in
the shared root checkout instead — the campaign owner's own working directory, at the time
carrying 29 dirty files, 5 in `AD` state (staged-added content that exists only in the git
index; a routine `git checkout .` / `git reset --hard` / stash-and-drop would have destroyed it
unrecoverably, with no reflog entry). The worker caught itself before committing; nothing
structural would have.

Root-cause investigation (design note: `.blackhole/plans/issue-804-design.md`) found the
premise "no location-assertion mechanism exists" does not hold. Issue #620 already shipped
`BLACKHOLE_ASSIGNED_WORKTREE`, exported as the first shell command at every `implementer` spawn
and enforced by `validate-file-changes.js` for the `Write`/`Edit` tools — a target outside the
assigned worktree is denied (`outside-assigned-worktree`). That mechanism did not fire for #804
because the worker did not use `Write`/`Edit`; it used `Bash` (`sed -i`, heredocs, `cat >`),
exactly the pattern this campaign's own harness guidance steers workers toward. Reading
`validate-bash-command.js` in full confirms it has **no** worktree-containment check of any
kind — only static destructive-command patterns and the unrelated `evaluateWorktreeRemoval`
check (`git worktree remove` safety). The confirmed root cause is a real, live gap: #620's
containment covers two of three write surfaces and misses the one workers default to.

Design Track evaluation (ADR-010 D4) drafted three options, ran the mandatory blind-critic
adversarial pass, and invoked `scripts/design-aggregate.ts`:

```
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance"],
  "scorer_results": [
    { "scorer": "primary",  "winner": "Option A", "margin": 14.81 },
    { "scorer": "critic_a", "winner": "Option A", "margin": 14.81 },
    { "scorer": "critic_b", "winner": "Option A", "margin": 9.88 }
  ]
}
```

All three scorers (primary + two independent blind critics) unanimously pick the same option
with zero disagreement, zero critical finding on the winner, and zero breaking-consumer
classification — the sole block reason is that the margin (9.9%-14.8%) does not clear the
configured `autonomy.design_dominance_delta` (30%). Per ADR-010 D4 the planner does not
self-certify past this; a human (or, under this campaign's `autonomy.mode: full` grant —
`.blackhole/config.json`, "Agent decides design approvals... without a gate until the backlog
drains. Owner is reported to, not asked.") makes the call explicitly.

## Decision

Adopt **Option A**: extend the existing #620 assigned-worktree containment mechanism to also
cover `Bash` file-write commands, via a new pure evaluator module
`templates/hooks/pretooluse/utils/bash-write-target-guard.js`
(`evaluateBashWriteTargets(command, cwd)`), wired into `validate-bash-command.js` alongside the
existing static/dynamic checks — same shape as `worktree-removal-guard.js`. It extracts common
file-write-target shapes (`>`, `>>`, `&>`, `tee [-a]`, `sed -i[.suffix]`, `cp`, `mv`, heredoc
targets), reusing `readAssignedWorktreeRoot`/`isUnderRoot` (never re-deriving worktree
resolution) and `computeMaskedSpans` (skip comment/echo-sink/heredoc-body false positives). A
resolvable target outside the assigned root → `block` (`bash-outside-assigned-worktree`); a
write-shaped-but-unresolvable command (`python3 -c`, `perl -i`, `awk`, `dd`, `rsync`, ...) →
`warn` and record (`bash-write-target-unresolvable`), never a silent allow.

**This decision overrides `design-aggregate.ts`'s `blocked` verdict.** Justification for the
override: the block reason is a pure margin shortfall (9.9%-14.8% vs. a 30% threshold) with
zero disagreement among scorers, zero critical finding, and zero breaking consumer — the
weakest possible form of `blocked`. Approved under this campaign's standing `autonomy.mode:
full` grant (design approvals decided by the orchestrating agent, owner reported to rather than
asked, until the backlog drains).

**Secondary, non-bundled layer**: also add a WARN-only Phase 0 dirty-checkout signal — at
orchestrator turn start, `git status --porcelain` on the main clone (already
`.gitignore`-excluding `.blackhole/`), surfacing a dashboard WARN with the dirty-file count when
non-empty, never blocking dispatch. Both blind critics independently found this valuable but
explicitly *not* load-bearing for closing #804's root cause (it only narrows the exposure
window, it doesn't close the mechanism gap) — kept as a small, separately-justified addition,
not scored against Options A/B/C.

## Alternatives Considered

- **Option B (Option A + bundled dirty-checkout surfacing scored together)** — rejected as a
  scored alternative: both blind critics independently flagged that bundling the WARN-only
  visibility layer into the same trade-off as the mechanical fix dilutes the analysis (it does
  not itself prevent #804's failure mode — a worker can still write before a human reads the
  dashboard, and it overlaps issue #792's territory). Adopted instead as an unscored secondary
  addition (see Decision).
- **Option C — prompt-only worker self-assertion** (mandate `git rev-parse --show-toplevel`
  comparison before every write, generalizing the existing git-specific Explicit Git Targeting
  Gate) — disqualified by both blind critics independently, tagged `discriminating`/`CRITICAL`:
  it repeats the exact prompt-only failure shape issue #782 already demonstrated does not
  generalize, against a root cause this investigation confirmed is mechanically closable.
  Weighted score lowest of the three (3.10 vs. Option A's 4.05) on Risk in particular (1/5 —
  a prose-only obligation with no mechanical enforcement, over a repo that has now twice shown
  prose-only write/manifest obligations erode under restatement discipline: #516, #782).
- **Spawning workers with their worktree as `cwd` directly** — confirmed not implementable
  today: the `Agent` tool's `isolation: "worktree"` has no branch/base-ref control or
  re-targeting across spawns, and `EnterWorktree`/`ExitWorktree` are scoped to the current
  session or a launch-pinned subagent, not an arbitrary later spawn. Out of scope for this
  decision; revisit if the harness gains this capability.
- **Orchestrator running from its own base-ref worktree** (issue #792's remedy) — settled as a
  distinct, non-overlapping problem: #792 is a *read*-staleness issue (orchestrator reads stale
  facts from a shared cwd); #804 is a *write*-safety issue (a worker's own writes land in the
  wrong checkout). Fixing #792 would not guarantee a worker lands in its own assigned worktree
  (a property of how the worker process is spawned and what tool it writes through). This ADR
  does not adopt that remedy; #792 is evaluated independently on its own merits.

## Consequences

**Positive**: closes a confirmed, live mechanism gap using the same pattern the repo already
trusts for two of three write surfaces (`Write`/`Edit`); adds test coverage (10 TDD cases,
including a heredoc-body false-positive guard and an explicit fail-open-parity case) directly
targeting the exact shape of the #804 incident; zero `BREAKING` consumers (confirmed by grep —
no existing export's signature changes, this is a pure addition).

**Negative / accepted risk**: command-string parsing of Bash write targets cannot enumerate
every write idiom (`python3 -c`, `perl -i`, `awk '{print > f}'`, `dd`, `rsync`, arbitrary
scripting) — mitigated, not eliminated, by the WARN-and-record tier for unresolvable cases
(never a silent allow). No measurement yet exists of how often implementers reach for these
unresolvable idioms; if a future audit of `.blackhole/hook-events/` shows frequent
`bash-write-target-unresolvable` WARNs concentrated on write-shaped commands, that is the
trigger to widen coverage — not a sign the WARN tier was wrong at design time. This design
depends on #620's existing contract (env var exported as the first shell command at every
spawn) continuing to be honored; if that export is ever skipped, both the Write/Edit and the
new Bash check silently fall back to today's broader `allWorktreeRoots` containment — a
pre-existing dependency, not a regression this ADR introduces.

**Operational**: one new ~100-150 line util module (`bash-write-target-guard.js`), one wiring
edit to `validate-bash-command.js`, doc updates to `hook-schemas.md`'s `pattern_id` enum and
`orchestrator-dispatch.md`'s #620 section, and one non-blocking bullet in `orchestrator.md`'s
Git & Worktree Hygiene list for the secondary WARN layer. Full task breakdown, TDD test list,
and execution stop conditions: `.blackhole/plans/issue-804-design.md` § Proposed Implementation.

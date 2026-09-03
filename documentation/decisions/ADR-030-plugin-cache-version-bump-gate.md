---
status: accepted
---

# ADR-030: Reviewer version-bump BLOCK gate plus advisory plugin-cache drift signal

## Status

Accepted

## Context

Issue #800: the PreToolUse guard that actually enforces during a live session is the
**installed plugin cache copy**
(`~/.claude/plugins/cache/blackhole-marketplace/blackhole/<version>/...`), not the repo's build
output — and Claude Code's plugin cache is version-keyed, not content-addressed (confirmed
against the harness's own documentation). Three merged security fixes to
`worktree-removal-guard.js` (#761, #774, #777) were empirically absent from the installed copy
(0/5, 0/3, 0/3 named-symbol occurrences; installed `mtime` predates all three merge commits),
while both the installed copy and the repo build reported the identical version string
(`0.21.0`) — nothing signals the divergence, and three more guard fixes were queued behind this
issue at filing time.

Design Track evaluation (`.blackhole/plans/issue-800.md`) drafted three options and invoked
`scripts/design-aggregate.ts`:

```
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance", "disagreement", "breaking-consumer"],
  "scorer_results": [
    { "scorer": "primary",  "winner": "Option C", "margin": 17.05 },
    { "scorer": "critic_a", "winner": "Option C", "margin": 5.95 },
    { "scorer": "critic_b", "winner": "Option A", "margin": 9.64 }
  ]
}
```

Two of three scorers (primary, critic_a) pick Option C; critic_b's own scoring puts Option A
ahead, driven specifically by scoring Option C's Complexity lower on a glob-accuracy-over-time
concern (addressed, not eliminated, in the design note's Refactoring Impact Analysis — the
trigger glob is scoped to the whole `templates/hooks/**` subtree, not narrowed, precisely so a
future in-tree reorganization stays covered). `design-aggregate.ts` additionally classifies
Option C's Refactoring Impact Analysis as declaring a genuine `BREAKING` consumer (every future
`templates/hooks/**`-touching PR gains a new mandatory obligation), which the script treats as
an automatic block regardless of scoring margin, by design (ADR-010 D4's "no confidence bypass"
default for a `BREAKING` classification).

**Both blind critics independently and unanimously rejected Option B** (a `scripts/checks/*`
verify module that fails whenever no plugin cache is present or content differs) as
CRITICAL/discriminating: CI never has a populated plugin cache, so under this repo's binary
`CheckResult{id, ok, detail}` contract (no tri-state), Option B would permanently red the entire
`verify` gate on every PR regardless of content — worse than the silent-no-op trap it was
proposed to avoid, since a permanently-failing check trains operators to ignore `verify`
failures entirely. No scorer picked Option B; the three-way disagreement is narrower than it
first appears — it is "which of A or C is better," not "is B viable."

## Decision

Adopt **Option C**: a composite of two independent mechanisms.

1. **`reviewer.md` diff-content BLOCK gate (new V-code `V-PLUGIN-01`)**: a PR whose diff touches
   `templates/hooks/**` without also changing `package.json`'s `version` field in the same diff
   is blocked. Reads the actual `package.json` version field via JSON parse — never a
   text-pattern match on the diff — so it is CI-safe by construction (diff-content only, never
   reads installed/local plugin-cache state) and cannot be spoofed by an unrelated version-like
   string elsewhere in the diff.
2. **Advisory session-start content-hash signal** (`.blackhole/plugin-drift.json`), mirroring
   `scripts/doc-health-signal.ts`'s existence-gated/atomic-write idiom: when the installed
   plugin cache exists, hash its `hooks/` tree and compare against the repo's own build target,
   surfacing a mismatch on the `bun run status` dashboard. This covers the residual gap
   mechanism 1 cannot see — a PR correctly bumps the version, but nobody ever runs the manual
   republish+reinstall step afterward.

**This decision overrides `design-aggregate.ts`'s `blocked` verdict**, including its
`breaking-consumer` reason. Justification for the override: the declared `BREAKING` consumer is
"every future PR touching `templates/hooks/**` must also bump `package.json`'s version" — a
small, mechanical, single-line, self-contained obligation (verified empirically: version bumps
have historically occurred only at release-boundary commits, never inside a feature/bugfix PR,
so this is a genuinely new but narrow constraint), not a behavioral or API break affecting any
runtime consumer. Two of three scorers independently favor Option C on its merits; critic_b's
dissent is a real, non-frivolous Complexity concern that the design's Refactoring Impact
Analysis already addresses (glob scoped to the whole subtree) without fully eliminating it.
Given this campaign has already lost three merged security fixes to exactly this gap in a
single turn, with three more guard changes queued behind this issue at filing time, the small
recurring friction is judged worth the structural fix. Approved under this campaign's standing
`autonomy.mode: full` grant (design approvals decided by the orchestrating agent, owner reported
to rather than asked, until the backlog drains) — this is exactly the class of decision that
grant exists to unblock without stalling the campaign on a mechanical dominance/breaking-change
gate when the underlying analysis is sound and independently cross-checked by two of three
scorers.

## Alternatives Considered

- **Option A — advisory content-hash signal only, no gate** (critic_b's own pick, 4.15 weighted
  vs. C's 3.75 on critic_b's scoring) — rejected as the sole mechanism: both blind critics
  independently found it insufficient alone. Advisory-only visibility does not prevent the
  root-cause recurrence pattern (a hooks PR merging without a version bump); it only surfaces
  drift after the fact, to a human who happens to be running the campaign with a populated cache
  and reading the per-turn report — close to the exact failure mode that let three fixes go
  undetected in the original incident. Retained as mechanism 2 of the chosen Option C, not
  discarded.
- **Option B — `verify`-check that fails on cache absence or content mismatch** — rejected
  unanimously and independently by both blind critics as CRITICAL: under this repo's binary
  `CheckResult` contract (no skip/unknown state) and CI's structurally-always-absent plugin
  cache, this check would be permanently red on every PR regardless of content — a worse trap
  than the one it was meant to close, and no steelman for adopting it as designed survives that
  mechanical fact.
- **A new `bun run release bump-patch` subcommand** — considered and rejected on KISS/YAGNI
  grounds during the design's Refactoring Impact Analysis, once `bun run build` was confirmed to
  already regenerate all 5 version-carrying manifests from `package.json`'s version with no
  separate tooling needed (`scripts/release.ts`'s `prepareRelease`).

## Consequences

**Positive**: closes the actual recurrence mechanism (an unbumped version merging unnoticed)
rather than only reporting on its consequence after the fact; CI-safe by construction (mechanism
1 never reads installed/local state); reuses two already-established repo patterns (advisory
session-signal per `doc-health-signal.ts`, diff-content reviewer BLOCK per existing Touch-Paths/
Threat-Model/API-contract-drift audits) rather than inventing a third detection shape.

**Negative / accepted friction**: every future PR touching `templates/hooks/**` gains one
mechanical extra step — bump `package.json`'s version, rerun `bun run build` — enforced as a
BLOCK. This is real, recurring, and forever, in exchange for closing the recurrence path that
let three fixes go inert in a single campaign turn. The trigger glob (`templates/hooks/**`,
scoped to the whole subtree rather than a narrower path) mitigates but does not eliminate the
risk that a hook source file relocated entirely outside `templates/hooks/` in the future would
evade the gate — no such location exists today (`V-YAGNI-01`: not solved speculatively).
Tampering with the installed `~/.claude/plugins/cache/` directory directly (outside any PR) is
out of this design's boundary — protected only by normal OS file permissions; the content-hash
signal would surface it on the next campaign turn but cannot prevent it. Neither mechanism can
force the actual manual republish+reinstall step to happen, nor fix the underlying Claude Code
platform behavior (version-keyed, not content-addressed cache) — both are properties of a
platform this repo does not control.

**Operational**: new `reviewer.md` § "Plugin Cache Version-Bump Audit (`V-PLUGIN-01`)" section
plus a `blackhole-vcodes.md` table row; new `scripts/lib/plugin-drift.ts`
(`computePluginDrift`, injected fs/paths for testability) and thin CLI wrapper
`scripts/plugin-drift-signal.ts`; a `campaign-status.ts` dashboard warning line; documentation of
the refresh mechanism itself (`blackhole-protocol.md` § Branch & Worktree Hygiene,
`templates/hooks/pretooluse/README.md`); a new turn-start step in `orchestrator-runtime.md`
invoking the signal script. Re-running #774's 8-case probe through the actual hook boundary
(not the module directly) is explicitly deferred to a later phase, gated on a human running the
documented refresh path first — not part of this ADR's delivered scope. Full task breakdown and
per-task TDD acceptance criteria: `.blackhole/plans/issue-800.md` § Task Breakdown.

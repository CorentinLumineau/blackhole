---
type: adr
summary: "{{INCLUDE}} expansion is gated inside expandIncludes on a declared INCLUDE_MARKER_SITES file allowlist, so a marker is a directive only at declared sites and inert prose everywhere else in all three entry paths (read(), vcode-citation's direct call, processFile's build call); path-prefix gating in read() and call-site opt-in both rejected as guarding one of three doors with open-ended safe-sets; design-aggregate.ts blocked on dominance/disagreement/breaking-consumer with scorers split 2-1, resolved by owner ruling that accepts the build-primitive verification surface as a known cost"
status: accepted
review_trigger: "on ADR-034 amendment or a new agent adopting the include seam"
created: 2026-09-06
last_updated: 2026-09-06
related:
  - documentation/decisions/ADR-034-audit-module-seam.md
  - documentation/reference/check-utils-blast-radius.md
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
---

# ADR-039: Declared `{{INCLUDE}}` marker sites — a marker is a directive only where declared

## Status

Accepted — 2026-09-06 (owner ruling, campaign gate; issue #882). The deterministic
`scripts/design-aggregate.ts` verdict was `blocked`; see § Gate for the verdict, the scorer
split, and the terms on which the ruling resolved it.

## Requirements Framing

`scripts/checks/check-utils.ts:15-16`'s `read()` applied `expandIncludes()`
(`scripts/lib/build/content.ts:34`) to every file it was handed. `expandIncludes` replaces each
`{{INCLUDE:<realdir>/*}}` match by inlining every `.md` file under `src/<realdir>`. Nothing
distinguished a marker written as a **directive** from one written as **prose about the
directive**.

This fired in production. PR #872's rebase onto #877 combined two individually harmless changes:
`main` carried a literal marker in a `scripts/lib/build/facts.ts` doc comment, and #872 added the
unconditional `expandIncludes()` call to `read()` (commit `afc62f9f`). `content-gates.check.ts`
resolves a `scripts/lib/build/*.ts` glob and calls `read()` on every match, so `facts.ts`
expanded its own comment — LOC 286 → 783, foreign section headers injected into the report, a
false `V-CONTENTGATE-01` failure.

That instance was closed by rewording the comment. The workaround was still load-bearing at
`scripts/lib/build/facts.ts:51` when this decision was taken: *"quoted without `{{...}}` here
since `check-utils.ts`'s `read()` would expand a literal one and corrupt this file's own LOC"*.
A comment that exists to stop a primitive from misfiring is the defect, stated in prose.

The requirement: expansion happens where a marker is a directive and nowhere else, enforced
mechanically rather than by comment-writing discipline across the repo, with
`V-CONTENTGATE-01` still measuring real file LOC.

## Decision

Gate expansion inside `expandIncludes` itself on a declared file allowlist.

1. `scripts/lib/build/facts.ts` gains `INCLUDE_MARKER_SITES: string[]` in its `§ facts` block —
   repo-relative POSIX paths of the files where a marker is a directive. At acceptance:
   `src/agents/reviewer.md`, `src/agents/implementer.md`.
2. `expandIncludes(content, srcPath, …)` returns `content` unchanged unless `srcPath` resolves to
   a declared site, comparing paths with the
   `path.relative(root, p).split(path.sep).join('/')` idiom `isBuildInputOnlyPath` already uses.
3. A new bidirectional check leg (`V-INCLUDE-02`) extends `build-input-dirs.check.ts` in the same
   Leg A / Leg B shape `V-INCLUDE-01` already ships: Leg A — every declared site exists and
   contains at least one marker; Leg B — every marker found by a live scan of the source tree
   sits at a declared site. Neither leg derives from the other.

No call site of `read()` changes. The gate holds in all three entry paths into the primitive,
not only the one that fired.

### Why the boundary is drawn at files, not paths or callers

`read()` is **one of three** entry paths into `expandIncludes`. The others are
`scripts/checks/vcode-citation.check.ts:142` (direct call on citation-resolved files) and
`scripts/lib/build/content.ts:200` (`processFile`, the live build compiling every source file
into every target tree), plus a local reimplementation at `scripts/router-local-analyze.test.ts:18`.
Any guard installed at `read()` guards one door of three.

The campaign has paid for the underlying lesson twice: PRs #854 and #880 each burned 4-7 review
iterations because their first design enumerated the **dangerous** cases and every enumeration
had a next unlisted member; both closed only by inverting to enumerate the **safe** cases. The
governing question here is therefore which option's safe-set is closed.

| Boundary | Enumerates | Closed? |
|---|---|---|
| Path prefix | Two **directories** whose files may expand | No — every file now or ever under those trees, and that is exactly where prose *about* the marker gets written |
| Call site | Callers that ask for expansion | Partly — 7 today, growing with every new content check, and it guards one of three paths |
| **Declared site** | Two **files** where a marker is a directive | Yes — the set grows only by deliberate seam adoption, and both directions are scannable |

## Alternatives Considered

**Path-prefix gating inside `read()` (rejected).** Expand only for paths under `src/agents/**` or
`src/references/**`. One guard clause, zero call sites, trivially reverted, and it does fix the
incident that fired. Rejected because its safe-set is open-ended in the one tree where marker
prose is most likely to be written — `src/references/blackhole-vcodes.md:121` already documents
the marker and is safe only via the `<>` exclusion in `INCLUDE_MARKER`, not via any path rule —
and because it leaves the `vcode-citation` and build entry paths unchanged. Choosing it would
re-accept, one level up, the framing the issue was filed to reject: that fixing the path which
fired closes the class.

**Explicit opt-in at the call site (rejected).** Revert `read()` to a plain read; request
expansion by name via the pre-existing `readComposedAgentDoc()`; migrate the three dependent
checks. This is the option with the best claim on readability — `readComposedAgentDoc(...)` says
what it returns, where `read('src/agents/reviewer.md')` under the accepted decision silently
returns composed content — and it is the only option that deletes the double expansion at
`check-common.ts:26`. Rejected because it guards one of three entry paths, is the only option
with BREAKING production consumers (three shipping checks), and without its optional companion
check it trades silent over-expansion for silent under-expansion: a future plain `read()` of a
shell returns un-composed content, the same wrong-content shape inverted.

**Enforcing the `<dir>` placeholder convention (rejected as framed).** The issue offered this as
an optional third element. It is a blocklist over prose style — the shape #854 and #880 each
paid for. Replaced by `V-INCLUDE-02`'s allowlist over marker *sites*, which is decidable.

## Options + Trade-off Matrix

Decision type `refactor-strategy`; columns and weights looked up from `design-rubric.md`, not
chosen per-decision. Scores are the primary's; both blind critics' matrices are in
`.blackhole/plans/issue-882-design.md`.

| Option | Effort (25) | Complexity (20) | Risk (20) | Reversibility (20) | Consistency (15) | Weighted |
|--------|------------|-----------------|-----------|--------------------|------------------|----------|
| A — path-prefix in `read()` | 5 | 3.5 | 2.5 | 5 | 2.5 | 3.83 |
| B — call-site opt-in | 3 | 3.5 | 2.5 | 4 | 4 | 3.35 |
| **C — declared marker sites (accepted)** | 3.5 | 4 | 4 | 4 | 5 | **4.03** |

## Adversarial Evaluation

Two blind `planner` critics scored all three options against the same fixed rubric, blind to the
primary's provisional choice, each inspecting the repo independently.

Both found, unprompted, that `expandIncludes` has call paths bypassing `read()` entirely — one
naming `vcode-citation.check.ts:142` and `router-local-analyze.test.ts:18`, the other naming
`content.ts:200`'s build path and independently discovering that `read()` already reaches a
`documentation/` file today (`tree-registry.check.ts:61` on `documentation/architecture.md`,
whose line 64 carries a marker illustration inert only via the bracket convention). Both tagged
the declared-set-plus-bidirectional-scan design as a near-exact extension of the shipped
`BUILD_INPUT_ONLY_DIRS` / `build-input-dirs.check.ts` idiom rather than a new enforcement shape.
One raised **CRITICAL discriminating** findings against both rejected options on the bypass
grounds.

The critics **split on the winner**. One scored the accepted option's Risk at 4.5 for closing all
three entry paths. The other scored it 2, and Effort 2, precisely because the gate lands inside
the build primitive — making path-prefix gating its winner at a 21.1% margin. Same evidence,
opposite risk posture on "guard the shared primitive" versus "guard the caller".

That dissent changed the design rather than merely scoring it: it prompted running
`bun test scripts/build.test.ts` under a patched worktree, which surfaced the six broken fixture
tests recorded below — a BREAKING consumer neither the issue nor the primary's first pass had
found.

## Component Decomposition

N/A — single-component design. One guard inside one existing function; no new boundary between
responsibilities. The check leg extends an existing module rather than adding a component.

## Design Principles Validation

| Axis | Score | Justification |
|------|-------|---------------|
| SRP | ✓ | `expandIncludes` gets one job — expand markers **at declared sites** — instead of two implicit ones split across it and `read()` |
| DIP | ~ | The guard reads a declared fact rather than hardcoding paths, so policy is injected. The fixture seam is where this is currently unmet |
| DRY | ✓ | Uses the declared-fact / independent-scan pair `facts.ts` already applies five times over; adds no third way to express "where includes are live" |
| KISS | ~ | Not the smallest change — path-prefix gating is. It is the smallest change that means one thing in every entry path. The fixture seam is genuine added complexity |
| YAGNI | ~ | The strongest standing objection: two of the three hazards closed have not fired. Counter: the one that did cost a false CI failure and a workaround comment still in the tree |
| Pattern | ✓ | Both blind critics independently classified it as an extension of the shipped `V-INCLUDE-01` Leg A/Leg B idiom |

## Refactoring Impact Analysis

Every row executed against a patched detached worktree, not reasoned: `bun run verify` 92/92 and
`bun test scripts/build.test.ts` 73/79.

| Consumer | Classification | Evidence |
|----------|---------------|----------|
| `scripts/checks/check-utils.ts:16` (`read`) | TRANSPARENT | 92/92 verify green, zero call-site edits |
| `scripts/lib/check-common.ts:26` (`readComposedAgentDoc`) | TRANSPARENT | Still expands for the two declared shells; its double expansion becomes a provable no-op |
| `scripts/checks/vcode-citation.check.ts:142` | TRANSPARENT | Site gate makes non-shell files inert — the intended fix |
| `scripts/lib/build/content.ts:200` (`processFile`) | TRANSPARENT | Full build + byte-parity ran inside the same verify pass |
| `scripts/router-local-analyze.test.ts:18` | TRANSPARENT | Reads `src/agents/reviewer.md`, a declared site |
| `scripts/build.test.ts` (ADR-034 T1/T6 fixtures) | **BREAKING** | 6 of 79 tests fail: fixture shells are not declared sites. Mitigation is a named plan task, not a footnote |

For contrast: under the rejected call-site-opt-in option,
`companion-docs.check.ts:22`, `test-integrity.check.ts:36` and `v-test09-hooks-claim.check.ts:55`
are BREAKING (verified: `bun run verify` 89/92 with a non-expanding `read()`).

## Assumption Audit

| # | Assumption | Mark | Note |
|---|-----------|------|------|
| 1 | Exactly two real marker sites exist in the source tree | ✓ | Full-tree grep |
| 2 | Site-gating is transparent to every verify check | ✓ | 92/92, zero call-site edits |
| 3 | Site-gating is transparent to the build | ✓ | Byte-parity checks ran inside that verify pass |
| 4 | Site-gating is transparent to the test suite | ✗ | **Incorrect** — six failing fixtures; the `breaking-consumer` block reason |
| 5 | The marker-site set grows only on deliberate seam adoption | ~ | True at acceptance (2 sites since ADR-034), but ADR-034's direction is more agents adopting the seam. `V-INCLUDE-02` is what makes growth loud rather than silent |
| 6 | The declared file list and `BUILD_INPUT_ONLY_DIRS` will not drift apart | ◐ | Two registries describe where includes are live, at different granularities. Cross-referenced in the doc comment; not mechanically joined |

## Gate

`scripts/design-aggregate.ts` returned:

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance", "disagreement", "breaking-consumer"],
  "scorer_results": [
    { "scorer": "primary",  "winner": "Option C", "margin": 4.97 },
    { "scorer": "critic_a", "winner": "Option C", "margin": 7.65 },
    { "scorer": "critic_b", "winner": "Option A", "margin": 21.11 }
  ]
}
```

Three independent blocks: no scorer cleared the 30-point `design_dominance_delta`; the critics
disagreed on the winner; and the recommended option carried a verified BREAKING consumer.

**Resolved by owner ruling, 2026-09-06**, via the campaign gate, with the dissent explicitly in
view. The ruling is not a finding that the aggregate script erred, and it does not overrule the
dissent as wrong — see § Consequences.

**Cross-Cutting Heuristic (ADR-012 E3, Trigger A)**: 3/3 — Breadth ✓ (governs the check layer,
the citation scanner and the build), Enforcement stakes ✓ (a misfire corrupts measured content
behind a green build), Foreclosure ✓ (rules out path-based and convention-based scoping
categorically). Qualifies for an `ARCHITECTURE.md` § Active Constraints entry on acceptance.

## Consequences

**Accepted cost, stated as the dissenting critic stated it.** The second blind critic ranked this
option last, reasoning: *"Because the change sits inside the primitive the live build pipeline
depends on, correctness verification requires a full build + byte-parity pass across every
compiled target, not just the check suite — materially larger verification surface and blast
radius than A or B's check-only changes."* That instinct was vindicated within minutes: running
the test suite under the patch produced the six broken fixtures. The owner accepted this cost in
exchange for a safe-set closed by construction that holds in all three entry paths. It is a known
liability, not a settled question — the implementation plan carries its mitigation as a named
task with acceptance criteria, and the mitigation may not be met by loosening or skipping the
affected tests (`V-TEST-10`).

**The fixture seam is the least-designed part of this decision.** The T1 unit leg can take an
injected site list, matching the `extraSources = []` convention already on this function. The T6
end-to-end leg shells out to `bun run build` and cannot receive a function parameter, so it needs
an environment or fixture-registration seam that does not exist today. A test fixture path must
never enter the committed `INCLUDE_MARKER_SITES` value — that would make `V-INCLUDE-02`
unfalsifiable (`V-UNFALSIFIABLE-01`).

**The `readComposedAgentDoc` double expansion survives as a provable no-op.** `check-common.ts:26`
calls `expandIncludes(read(rel), …)` where `read()` already expanded. Under this decision it
remains a no-op **by construction**, not by luck: after the first pass, a declared site's content
contains no marker, so the second pass matches nothing. It is recorded here rather than deleted
because deleting it is a separate judgment about which of two helpers should own composition —
the rejected call-site option's territory. A future reader must not read the duplication as
evidence that either call is wrong.

**Adjacent SSOT.** `INCLUDE_MARKER_SITES` (files) and `BUILD_INPUT_ONLY_DIRS` (directories) both
describe where `{{INCLUDE}}` is intentionally live, at different granularities, in separate
registries free to drift. They are cross-referenced in the declaring doc comment. Revisit if a
third registry on this axis is ever proposed.

**What becomes possible.** A doc comment, reference table, plan document or ADR may quote a
marker with a real directory name without a workaround, anywhere in the repo. The
`facts.ts` quoting workaround is removed as part of the implementing change.

**What becomes harder.** An agent adopting the include seam must register its shell in
`INCLUDE_MARKER_SITES`. Forgetting is caught loudly by `V-INCLUDE-02` Leg B rather than silently
producing an agent with no body — which is the intended trade, and the reason the check leg is
part of the decision rather than a follow-up.

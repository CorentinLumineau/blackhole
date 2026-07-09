---
tracking_initiative: none
status: accepted
scope: orchestration
---

# ADR-005: PR Merge-Gate and Dependency-Ordering

## Overview

Today, blackhole's orchestrator merges a PR the moment it reaches LGTM
(`phase-loop.md` § Merge protocol: `gh pr merge --squash`, unconditional). There is
no way to hold an approved PR from merging, and no way to declare that one PR must
land before another — `depends_on` only gates when implementation may *start*, not
when a PR may *merge*. This blocks a specific campaign shape the user wants to run:
scope a campaign to a tag/milestone, let every in-scope PR reach LGTM, self-review
the whole batch, then merge in a controlled, dependency-respecting order.

This ADR adds two new `queue.json` fields (`merge_hold`, `merge_after`), one new
campaign-level `merge_mode` toggle, and a dedicated `merge-gate.md` reference doc
that owns the eligibility algorithm — kept out of `phase-loop.md` to avoid step
bloat. Campaign scoping reuses the existing `scope_milestone` / `scope_labels`
mechanism unchanged.

**Source-of-truth note**: per `ARCHITECTURE.md` § Project Structure (Golden rule),
`src/` is the only hand-edited source tree — `.claude/`, `.cursor/`, `codex-*`,
`.gemini-plugin/`, and the flat `skills/`/`agents/`/`references/`/`rules/` mirrors
are all compiled artifacts of `scripts/build.ts` and are silently overwritten (CI
rejects drift). Every file referenced below as `references/X.md` or `agents/X.md`
means `src/references/X.md` / `src/agents/X.md` — never the compiled `.claude/...`
copy. `bun run build` (and `bun run verify`) must run after any `src/` edit.

## Architecture

### Component Diagram

```
[config.json merge_mode] --\
                             >-- read by --> [merge-gate.md: mergeEligible()] --consulted by--> [phase-loop.md merge step] --on violation/drift--> [findings-ledger.json: V-MERGE-01/02]
[queue.json merge_hold,    /
 merge_after]      -- read/write by forge-sync (drift reconciliation, cycle detection) --/
```

### Data Flow

1. Orchestrator enters Phase 5 Loop; forge-sync runs first (existing, every turn).
2. forge-sync additionally: (a) checks cross-graph cycles across `merge_after` ∪
   `depends_on`, blocking + flagging any found; (b) for issues with `merge_hold: true`
   or unresolved `merge_after`, checks `gh pr view --json state,mergedAt` to catch
   external merges (drift), logging `V-MERGE-02` if found.
3. For each LGTM'd issue, `phase-loop.md`'s merge step calls
   `merge-gate.md`'s `mergeEligible(issue)` before `gh pr merge`.
4. `mergeEligible` returns false if `merge_hold: true`, or any `merge_after` entry
   has `status` other than `merged`/`closed`, or (`merge_mode: gated-batch`) the
   issue's in-scope siblings haven't all reached LGTM yet.
5. Ineligible-but-attempted merges (should never happen if step 0 is followed, but
   audited) log `V-MERGE-01` to the ledger; genuine external bypasses log
   `V-MERGE-02` — both via the `merged_by` marker (see Components below).
6. **`merge_mode: gated-batch` only**: once step 4's Condition 3 is satisfied for
   every in-scope issue, `phase-loop.md`'s merge trigger invokes `merge-gate.md`
   § 4 instead of processing issues individually — sequential, topologically
   ordered, one `gh pr merge` + persist per issue (review finding, fixed: this
   trigger point was originally undocumented, making § 4 unreachable).

## Components

### `queue.json` fields (`merge_hold`, `merge_after`, `milestone`, `labels`)
- **Responsibility**: pure per-issue state — no logic.
- **Interface**: `merge_hold: boolean` (default `false`); `merge_after: number[]`
  (default `[]`), distinct from `depends_on`. Also `milestone: string | null` and
  `labels: string[]` — forge-synced cache fields (review discovery: `merge-gate.md`
  § 1 Condition 3 needs a forge-shaped issue to scope-match against; `queue.json`
  carried neither field before this fix, which made gated-batch's sibling-LGTM wait
  silently vacuous for any scoped campaign) added so Condition 3 can scope-match
  without a live `gh` call mid-merge-loop.
- **Dependencies**: `milestone`/`labels` are populated by `forge-sync.md` § 5
  every turn — not user-editable, not written back to the forge.

### `config.json` field (`merge_mode`)
- **Responsibility**: campaign-level policy switch.
- **Interface**: `merge_mode: "immediate" | "gated-batch"` (default `"immediate"`,
  preserves current behavior exactly).
- **Dependencies**: none.

### `src/references/merge-gate.md` (new reference doc)
- **Responsibility**: owns the entire merge-eligibility algorithm — hold check,
  `merge_after` resolution, cross-graph cycle detection, forge-drift reconciliation
  (with `V-MERGE-01`/`V-MERGE-02` attribution via the `merged_by: blackhole`
  causal marker — present means an internal step-0 violation, BLOCK; absent
  means an external bypass, WARN — deliberately not `status: in-flight`, which
  review iteration 2 found to be bidirectionally unreliable for this purpose),
  gated-batch scope wait (with `closed`/`merged` sibling exclusion, mirroring
  `merge_after`'s deadlock fix). Single place this logic lives.
- **Interface**: `mergeEligible(issue) -> bool`, consulted as a hard **step 0** in
  `phase-loop.md` § Merge protocol (review finding: a bare checklist-line
  citation, one heading away from the actual `gh pr merge` call, left the
  precondition uncited if that section were read/delegated on its own — fixed by
  making step 0 self-contained wherever § Merge protocol is cited); cycle-detection
  and drift-reconciliation steps consulted by `forge-sync.md`.
- **Dependencies**: `queue.json` fields (including `milestone`/`labels`),
  `config.json.merge_mode`, existing `scope_milestone`/`scope_labels`/
  `issueMatchesScope` (unchanged, reused as-is via a shape-adapter — see
  `merge-gate.md` § 1 Condition 3).

### `src/references/phase-loop.md` merge step (existing, minimally touched)
- **Responsibility**: unchanged merge execution mechanics (HEAD check, CI check,
  build, `gh pr merge`). Gains exactly one delegated precondition.
- **Interface**: `LGTM AND mergeEligible(issue) -> merge`.
- **Dependencies**: `merge-gate.md`.

### `findings-ledger.json` entries (`V-MERGE-01`, `V-MERGE-02`)
- **Responsibility**: audit trail only — never the enforcement mechanism itself.
  Enforcement lives entirely in `queue.json` state + `merge-gate.md` logic.
- **Interface**: standard ledger finding shape, following the existing non-file:line
  precedent already set by `V-BRANCH-*`/`V-GIT-01`.
- **Dependencies**: none (consumed by audits/reporting only).

### Campaign Launch Configuration Gate
- **Responsibility**: gives the user a quick interactive form to set campaign
  `scope` (all issues | specific label(s) | specific milestone) and `merge_mode`
  (immediate | gated-batch) at the moment they actually matter, instead of
  requiring hand-edits to `.blackhole/config.json`. This is the UX surface that
  makes `merge_mode` (and the existing `scope_labels`/`scope_milestone` fields)
  discoverable — without it, a user would need to already know these fields
  exist to opt into gated-batch merging.
- **Interface**: `AskQuestion`-driven prompt in `coordinator.md`'s bootstrap
  preflight, using the coordinator's existing interactive-gate convention (the
  same one already used for Chat Feedback Intake triage and blocker
  resolution). Confirmed answers are written into `.blackhole/config.json`'s
  `scope_labels`/`scope_milestone`/`merge_mode` fields (existing fields from
  this ADR and the pre-existing scoping mechanism — no new config keys).
  Fires on exactly three conditions:
  1. **True first bootstrap** — `.blackhole/config.json` does not yet exist.
  2. **Post-"Campaign complete"** — after `phase-loop.md`'s Campaign complete
     report, if the user confirms "Start a new campaign?".
  3. **Explicit mid-campaign reconfiguration** — the user asks to "reconfigure
     scope" or "change merge mode" via Chat Feedback Intake.
  Does **not** fire on routine resume (none of the three trigger conditions
  hold) — resuming an in-progress campaign reads the existing
  `.blackhole/config.json` as-is, unchanged.
- **Dependencies**: `config.json`'s `scope_milestone`/`scope_labels` (existing,
  reused unchanged) and `merge_mode` (this ADR); `coordinator.md`'s existing
  `AskQuestion` convention and Chat Feedback Intake Protocol; `phase-loop.md`'s
  Campaign complete section (source of trigger condition 2). Does not touch
  `merge-gate.md` — this gate only *sets* scope/`merge_mode`, it never
  evaluates eligibility.

## Design Principles Validation

### SOLID
- [x] **Single Responsibility**: `merge-gate.md` owns eligibility exclusively; state
  fields carry no logic; `phase-loop.md` keeps merge mechanics only.
- [x] **Open/Closed**: `merge_mode` is a data-driven switch inside `merge-gate.md` —
  adding a third mode extends the dispatch table, doesn't modify the other two.
- [ ] **Liskov Substitution**: N/A — no class hierarchy in this markdown-skill
  architecture.
- [x] **Interface Segregation**: `mergeEligible()` is the only surface `phase-loop.md`
  consumes; cycle/drift checks are a separate surface consumed only by `forge-sync.md`.
- [x] **Dependency Inversion**: `phase-loop.md` depends on the `mergeEligible()`
  abstraction, never reaches into raw `merge_hold`/`merge_after` fields directly.

### DRY
- [x] **No duplicated responsibilities**: `merge_after` is deliberately distinct from
  `depends_on` (different lifecycle phase — implementation-start gate vs. merge-time
  gate); not accidental duplication.
- [x] **Reuses existing mechanisms**: `scope_milestone`/`scope_labels`/
  `issueMatchesScope` reused unchanged; `merge_after` resolution reuses the exact
  `merged OR closed` satisfaction rule `depends_on` already uses.
- [ ] **Known, accepted trade-off**: this design does NOT reuse git-pr's
  `pr-dependency-ordering.md` topological-sort logic — a deliberate cost of choosing
  the queue-native approach over the git-pr-delegation alternative (see Trade-offs).
  Revisit if a second consumer of issue-DAG merge ordering emerges.

### KISS
- [x] **Minimum viable architecture**: two new fields, one new config toggle, one new
  reference doc, one new precondition line, two new V-codes. No new abstraction
  layers beyond what each requirement demands.

### YAGNI
- [x] **No speculative components**: every element serves one of the four stated
  requirements (hold, ordering, batch gate, scope reuse). Explicitly rejected
  generalizing a shared skill (git-pr) for a hypothetical second DAG-source consumer.

### Design Patterns
- [ ] **Creational**: N/A — no object instantiation in this skill-markdown architecture.
- [x] **Structural**: `merge-gate.md` acts as a **Facade** over the merge-eligibility
  decision, hiding hold-check + resolution + cycle-check + batch-wait behind one
  `mergeEligible()` call.
- [x] **Behavioral**: `merge_mode` is a **Strategy** selecting between two
  eligibility-timing strategies (immediate vs. gated-batch) within `merge-gate.md`.
- [x] **No forced patterns**: both patterns are the natural shape of the extracted
  logic, not imposed.

### Other Principles
- [x] **Separation of Concerns**: five clear domains — state (queue.json), policy
  (config.json), logic (merge-gate.md), orchestration (phase-loop.md), audit
  (findings-ledger.json).
- [ ] **Composition over Inheritance**: N/A (no OOP), but `phase-loop.md` composes in
  the eligibility check rather than duplicating gate logic inline.
- [x] **Law of Demeter**: `phase-loop.md` talks only to `mergeEligible()`, never to
  raw queue fields.
- [x] **Fail Fast**: cycle detection and drift reconciliation happen at the
  forge-sync boundary (every turn), not discovered deep in the merge step.

## Trade-offs

| Decision | Option A (chosen): Queue-native | Option B: Delegate to git-pr | Option C: Ledger-driven synthetic finding |
|----------|----------------------------------|-------------------------------|---------------------------------------------|
| Where does eligibility state live | New `queue.json` fields, blackhole-owned | Externally-supplied DAG fed into shared `git-pr merge` mode | Synthetic `V-MERGE-01` findings in `findings-ledger.json` |
| Blast radius | Contained to blackhole plugin | Couples blackhole velocity to git-pr's own multi-consumer change-approval process | Contained to blackhole plugin |
| DRY | Duplicates git-pr's topological-sort logic (accepted cost) | Reuses git-pr's existing ordering logic | Reuses existing `blocked_count===0` LGTM gate, but conflates code-quality and scheduling semantics |
| UX fit for "a flag to not merge" | Direct — `merge_hold: true` | Direct, but routed through a second skill's interface | Poor — requires locating/editing a ledger entry, forced file:line sentinel hacks |
| Choice + Why | **Chosen.** Adversarial review (3 parallel critics) found Option B's SRP/ISP conflation and governance coupling, and Option C's ledger dedup-key mismatch and UX regression, both worse than Option A's one accepted, documented DRY cost. | Rejected — real DRY win but disproportionate coupling/governance risk for a single-project feature. | Rejected — schema mismatch (dedup key has no file:line to anchor to) and UX regression against the user's literal ask. |

## Refactoring Impact

### Changed Interfaces

| Component (all under `src/`) | Change Type | Current Consumers | Impact |
|-------------------------------|------------|--------------------|--------|
| `references/queue-dag.md` schema | Additive fields (`merge_hold`, `merge_after`) | `agents/orchestrator.md` (reads by pointer, not embedded), `references/forge-sync.md` | TRANSPARENT — safe defaults preserve current behavior |
| `references/phase-loop.md` merge protocol | One new delegated precondition | `agents/orchestrator.md` (executes Phase 5 by pointer) | TRANSPARENT — default `merge_mode: immediate` + empty `merge_after` + `merge_hold: false` means the precondition always passes for campaigns that don't opt in |
| `references/config-template.md` | Additive field (`merge_mode`) | Bootstrap ("copy template to runtime if missing fields") | TRANSPARENT — additive, safe default |
| `references/blackhole-vcodes.md` | Two new rows (`V-MERGE-01`, `V-MERGE-02`) | Compiled by `scripts/build.ts` into every platform target's `references/` dir AND `.claude/rules/blackhole-vcodes.md` (confirmed: this project rule already appears verbatim in every agent's context via that compiled path) — single source, no other file needs a manual copy | TRANSPARENT |
| `references/findings-ledger.md` schema | New finding kind, no schema change (follows existing `V-BRANCH-*`/`V-GIT-01` non-file:line precedent) | audits, `scripts/review-aggregate.ts` | TRANSPARENT |

**No refactoring impact beyond the additive changes above** — no BREAKING or
DEPRECATION consumers were found. `agents/orchestrator.md` needs one new pointer
added to its Phase 5 section referencing `merge-gate.md`'s `mergeEligible` check (an
addition, not a modification of existing behavior). **Every change lands in `src/`
only; `bun run build` (+ `bun run verify`) regenerates all compiled platform targets
— never hand-edit `.claude/`, `.cursor/`, `codex-*`, or the flat `skills/`/`agents/`/
`references/`/`rules/` mirrors.**

## Key Assumptions

| Marker | Assumption |
|--------|------------|
| ✓ Validated | `merge_after` resolves on `status: merged` OR `status: closed`, mirroring the exact rule `depends_on` already uses (`queue-dag.md` Step 2) — this is the direct fix for the predecessor-closed deadlock the adversarial critics raised, not a new invention. |
| ✓ Validated | Campaign scoping for gated-batch reuses `scope_milestone`/`scope_labels`/`issueMatchesScope` unchanged — this mechanism already exists and needs no new design. |
| ~ Contestable | `merge_after` is a field distinct from `depends_on`, not a reuse of `depends_on` with a new merge-time-only flag. Rejected the reuse option because `depends_on` already has other consumers (wave computation, forge-sync bidirectional write-back from issue body) whose "gate implementation start" semantics must not silently change meaning for in-flight campaigns. |
| ◐ Blind spot | Whether `merge_after` edges should sync bidirectionally with forge issue bodies the way `depends_on` does (`forge-sync.md` §6.5) is unresolved — treated as a campaign-local (queue.json-only) concept for v1, not forge-visible. Flag for follow-up if users want merge order visible on the issue itself. |
| ⚡ Oversimplified | Gated-batch scope is treated as re-evaluated every orchestrator turn (same as today's wave computation), not frozen at batch start — so an issue entering/leaving scope mid-wait is picked up naturally rather than needing special-case handling. This should be stated explicitly in `merge-gate.md`, not left implicit. |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cross-graph cycle (`merge_after` ∪ `depends_on`) undetected until merge-time deadlock | Medium | Cycle detection runs at the forge-sync boundary every turn; any cycle sets both issues `blocked` with note `merge-order cycle with #N` and surfaces via the existing AskQuestion user gate — fails fast, not silently. |
| Merge-order predecessor closed (wontfix/duplicate) instead of merged, dependent stuck forever | Medium | `merge_after` uses the same `merged OR closed` satisfaction rule as `depends_on` — no new deadlock class. |
| Forge drift — PR merged manually outside blackhole while held | Low-Medium | forge-sync reconciliation checks `gh pr view --json state,mergedAt` for held/gated issues every turn; logs `V-MERGE-02` for audit visibility rather than silently going stale. |
| Gated-batch partial failure mid-sequence | Medium | Batch mode still executes merges **one PR at a time** (not a single atomic multi-PR call); `queue.json` is persisted after each individual merge, so a mid-batch failure leaves a resumable state for the next orchestrator turn — no special rollback logic needed. |
| DRY cost — duplicated topological-sort concept vs. git-pr | Low (accepted) | Documented as a deliberate trade-off in this ADR; revisit via a future ADR if a second consumer of issue-DAG-based merge ordering emerges elsewhere in the ecosystem. |
| **[Review finding, fixed]** Gated-batch Condition 3 silently vacuous — `issueMatchesScope` expects a forge-shaped issue (`milestone.title`, `labels[].name`); `queue.json` carried neither, so `siblings` was always `[]` and the sibling-LGTM wait never gated anything for any scoped campaign | Critical (was) | `forge-sync.md` § 5 now syncs `milestone`/`labels` onto every `queue.json` issue every turn; `merge-gate.md` § 1 Condition 3 uses a documented shape-adapter (`asForgeIssue`) against the now-real data. |
| **[Review finding, fixed]** `mergeEligible()` precondition stated only as a checklist line one heading away from `phase-loop.md` § Merge protocol's actual `gh pr merge` call — a bypass path if that section were read/delegated on its own | High (was) | `mergeEligible(issue)` is now a hard **step 0** inside § Merge protocol itself, binding wherever that section is cited. |
| **[Review finding, fixed]** `merge_mode: gated-batch` + unscoped ("all open issues") campaign made Condition 3 wait on every open issue repo-wide forever — an externally-triggerable merge-throughput DoS (any unrelated issue filed blocks all merges indefinitely) | Medium→High (was) | Campaign Launch Configuration Gate now warns and requires explicit confirmation before accepting `gated-batch` + unscoped together; recommends a label/milestone scope instead. |
| **[Review finding, fixed]** `V-MERGE-01` (BLOCK) was added to `blackhole-vcodes.md` with no detection/logging logic anywhere — an orphaned, unreachable V-code | High (was) | `merge-gate.md` § 3 attributes every merged-while-ineligible detection using the `merged_by` marker (see below), not raw `status`. |
| **[Review finding, fixed]** Cycle-detection's "surfaced via AskQuestion" claim wasn't backed by `coordinator.md`'s actual blocker-detection trigger (`notes` substring match didn't include cycle notes) | Medium (was) | `coordinator.md` § Resolving Blockers now matches `merge-order cycle with #N` alongside the existing `awaiting-user`/`awaiting-plan` triggers, with an explicit edge-breaking resolution flow. |
| **[Review iteration 2 finding, fixed]** `V-MERGE-01`/`V-MERGE-02` attribution based on `status == in-flight` was bidirectionally unreliable — `in-flight` reflects concurrent worker activity (implement/review), not who called `gh pr merge`; a real internal violation could self-mask (status flips to `merged` in the same turn) and a routine external bypass while an issue happened to be in-flight for unrelated reasons would be misattributed as an internal BLOCK | High (was) | `phase-loop.md` § Merge protocol step 4 now writes a `merged_by: blackhole` marker in queue.json's per-issue schema (`queue-dag.md`) in the same atomic write as `status: merged` — the sole, causally-accurate signal `merge-gate.md` § 3 uses for attribution. |
| **[Review iteration 2 finding, fixed]** Gated-batch+unscoped DoS fix (row above) only covered the Bootstrap-preflight trigger path; the other two documented trigger conditions (post-"Campaign complete" restart, mid-campaign reconfigure) both re-fire the gate at a point where `config.json` already exists, but the gate's own literal text said to skip entirely whenever the file exists — silently bypassing the validation warning on 2 of 3 paths | High (was) | `coordinator.md` § Bootstrap preflight now states all three trigger conditions inline and changes the skip rule to "skip only on routine resume, i.e. when none of the three conditions hold" — consistent with every path that re-fires it. |
| **[Review iteration 2 finding, fixed]** Condition 3's sibling-LGTM wait had no `closed`/`merged` exclusion — a single in-scope issue closed as wontfix/duplicate (an ordinary campaign event, not an attack) permanently deadlocked the entire gated-batch scope's merges, even under a properly-scoped campaign | High (was) | Condition 3 now excludes `closed`/`merged` siblings from the `all(isLgtm(...))` requirement, mirroring Condition 2's existing `merged OR closed` rule. |
| **[Review iteration 3 finding, fixed]** `forge-sync.md` § 5.5 inline-restated the discredited `status`-based V-MERGE attribution rule verbatim, contradicting `merge-gate.md` § 3's fixed `merged_by`-based rule and breaching the "cite by pointer, never duplicate" contract; `blackhole-vcodes.md`'s V-MERGE-01/02 rows were correspondingly stale and conflated § 2 (cycle detection, logs no V-code) with § 3 (the sole trigger for both codes) | High (was) | `forge-sync.md` § 5.5 now cites `merge-gate.md` § 3 as a pure pointer, no inline rule restatement; `blackhole-vcodes.md`'s two rows rewritten to describe the current `merged_by`-based attribution accurately. |
| **[Review iteration 4 finding, fixed]** `merge-gate.md` § 4 (gated-batch sequential merge execution — the actual mechanism delivering "merge in a controlled, dependency-respecting order") had no invocation point in `phase-loop.md` or `orchestrator.md` — fully specified but unreachable, the same defect class as the earlier orphaned `V-MERGE-01` | High (was) | `phase-loop.md` § Merge protocol now has an explicit trigger paragraph: `merge_mode: gated-batch` invokes § 4 (instead of per-issue processing) once Condition 3 is satisfied for the whole in-scope set; `merge-gate.md`'s "Consulted by" list updated to include this trigger. |

## Implementation Order

All edits land in `src/` (never the compiled `.claude/`/`.cursor/`/`codex-*`/flat
mirrors); run `bun run build` + `bun run verify` after each step or at the end of
the batch.

1. `src/references/queue-dag.md` — add `merge_hold`, `merge_after` fields
   (foundation, no behavior change) + update the fixture at
   `fixtures/queue.example.json` to match.
2. `src/references/config-template.md` — add `merge_mode` field (foundation, no
   behavior change).
3. `src/references/merge-gate.md` — new reference doc implementing
   `mergeEligible()`, cycle detection, forge-drift reconciliation, gated-batch
   scope wait.
4. `src/references/phase-loop.md` — wire the one new precondition into the merge
   step.
5. `src/references/blackhole-vcodes.md` — add `V-MERGE-01` (BLOCK) and
   `V-MERGE-02` (WARN) rows.
6. `src/agents/orchestrator.md` — add pointer to `merge-gate.md` in the Phase 5
   section.
7. `src/references/forge-sync.md` — add the cycle-detection and
   drift-reconciliation steps, consulting `merge-gate.md`.
8. `bun run build` (+ `--gemini` if that target is in scope) and `bun run verify`
   — regenerate and validate every compiled platform target; `bun test` for the
   co-located `*.test.ts` suites (`build.test.ts`, `verify.test.ts`, and any new
   coverage for `merge-gate.md` consumers if the campaign has schema-validation
   scripts under `scripts/`).

No existing consumers require migration — all changes are additive per the
Refactoring Impact analysis above.

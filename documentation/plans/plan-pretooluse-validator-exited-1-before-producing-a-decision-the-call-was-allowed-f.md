---
type: plan
summary: "Standard-track plan for issue #893 — turn-start ingestion of PreToolUse fail-open hook events into the findings ledger with owner-ruled per-class (vcode, pattern_id, worktree) identity, occurrence counting, open-only dedup, occurrences/last_seen_at rendering with severity+recency sort, archive-then-delete of consumed events, and a diagnosable error-tier detail — resolves ADR-042's design-approval gate (A′, owner ruling)"
status: current
review_trigger: "on ADR-042 amendment, or on ledger dedup-key changes"
created: 2026-09-06
last_updated: 2026-09-06
related: [documentation/investigations/hook-event-fail-open-visibility.md, documentation/decisions/ADR-042-hook-event-finding-cardinality-and-visibility.md]
---

# Plan - Issue #893

**Design-approval gate resolved.** `scripts/design-aggregate.ts` returned `status: "blocked"`
(`dominance`, `disagreement`, `breaking-consumer`; three scorers, three different winners over
Options A/C/D). The owner was shown the R-003 executive summary's question — is 219 fail-opens
of one guard one finding with a count, or 219 findings? — and ruled **A′ (per-class identity,
with a count)**, the three critic-found fixes plus the AC1 leg named explicitly as part of the
choice. This plan implements **A′** as ruled; see `ADR-042-hook-event-finding-cardinality-and-visibility.md`
(staged at `.blackhole/staged/893/`) for the full resolving record. No contingency remains.

## Objective

Make a PreToolUse validator fail-open (`V-HOOK-03`, BLOCK) visible in-session within one
orchestrator turn, without the fix appending 342 BLOCK-severity rows into a 97-row ledger whose
dashboard renders only 10.

Constraints: the orchestrator remains the sole ledger writer (`blackhole-state.md` § Single-writer
invariant); `V-HOOK-01`/`V-HOOK-03` severities are unchanged (no V-code semantics change is
proposed); the doc-health/plugin-drift precedents supply cadence and existence-gating only —
their advisory-only property does not transfer, because this path mutates the ledger.

## Touch-Paths

- `scripts/lib/hook-event-triage.ts`
- `scripts/lib/hook-event-triage.test.ts`
- `scripts/lib/campaign-status/dashboard.ts`
- `scripts/lib/campaign-status/types.ts`
- `scripts/lib/build/claude-native-settings.ts`
- `src/references/orchestrator-runtime.md`
- `src/references/hook-schemas.md`
- `src/references/findings-ledger.md`
- `src/references/blackhole-state.md`
- plus all generated dist trees per `scripts/lib/build/targets.ts`
- **`package.json` is NOT a Touch-Path.** Verified against `origin/main`:
  `templates/hooks/pretooluse/hooks.json` (the shipped plugin's actual wrapper) carries no
  fail-open capture logic at all — it is a bare `bun run ${CLAUDE_PLUGIN_ROOT}/hooks/validate-bash-command.js`.
  Task 7's wrapper enrichment is confined to `scripts/lib/build/claude-native-settings.ts` and
  the generated root `.claude/settings.json`, neither of which is under `templates/hooks/**`.
  `V-PLUGIN-01` (ADR-030) is therefore inert for this plan — no version bump required.

New test file created by this plan (declared here, deliberately not under Critical Files):
`scripts/lib/campaign-status/dashboard.test.ts`.

## Documentation Impact

- `src/references/orchestrator-runtime.md` § Session resume & recovery — gains ingest step 6;
  § Triage step 1b — per-event-append prose corrected to aggregated-identity prose.
- `src/references/hook-schemas.md` § Orchestrator consumption — same correction.
- `src/references/findings-ledger.md` § Schema / Field rules — gains `occurrences` and
  `last_seen_at` rows.
- `src/references/blackhole-state.md` § Paths — gains the `archive/hook-events-<ts>/` row.
- `documentation/decisions/ADR-042-hook-event-finding-cardinality-and-visibility.md` +
  `documentation/decisions/INDEX.md` — staged at `.blackhole/staged/893/` alongside this plan
  (design-approval gate now resolved); the implementer's carry-step commits both into the PR
  (`implementer.md` § Carry Staged Artifacts, ADR-021 D2).
- No new file is created directly under `documentation/` by the *code* changes in this plan
  (Tasks 1-10) — only the already-staged ADR/INDEX-row pair is carried — so
  `doc-governance.md`'s search-before-write obligation for a fresh code-adjacent doc is
  satisfied vacuously.

## Critical Files

- `scripts/lib/hook-event-triage.ts` — the sole classifier between non-agent hook records and
  the ledger; a defect here silently loses BLOCK findings.
- `scripts/lib/campaign-status/dashboard.ts` — the campaign's only human read surface for open
  findings.
- `scripts/lib/build/claude-native-settings.ts` — generates the PreToolUse wrapper; a defect
  here disables the safety gate itself rather than merely its reporting.
- `scripts/campaign-status.ts` — the `bun run status` entrypoint that composes the dashboard.

## Codebase Conventions

No `plans/issue-893-analysis.md` exists (the investigator ran `investigate`, not `analyze`), so
these were discovered independently against `origin/main`.

| Concern | Established pattern | Touchpoint |
|---|---|---|
| Turn-start signal refresh | Existence-gated `bun run scripts/<name>-signal.ts`, atomic tmp+rename, one console line | `doc-health-signal.ts`, `plugin-drift-signal.ts` |
| Dashboard warning render | Pure `render*Warning(signal \| null): string`, returns `''` when silent, called from `campaign-status.ts` `main()` | `campaign-status.ts:42` `renderPluginDriftWarning` |
| Ledger write | Snapshot to `archive/`, write `.tmp`, `state-write-guard.ts --entity-key findings`, atomic `mv`, bump `refreshed_at` | `blackhole-state.md` § Write protocol |
| Archive naming | `.blackhole/archive/<artifact>-<timestamp>.json` for rotated ledger/queue snapshots | `blackhole-state.md` § Paths |
| Pure core + I/O wrapper | Exported pure function taking parsed input, thin `main()` doing fs | `hook-event-triage.ts`, `doc-health.check.ts` |
| Test style | `bun:test` `describe`/`test`, `withTempDir` from `test-fixtures.ts`, `toMatchObject` on row shape | `hook-event-triage.test.ts` |
| Optional ledger field | Additive optional key; `ledger-schema.check.ts` validates only *present* known keys and never rejects unknown ones | `ledger-schema.check.ts:35`, `verification_mode` precedent (ADR-036) |

## Database/API Schema Changes

`.blackhole/findings-ledger.json` `findings[]` row, additive only. No key is removed, renamed,
or has its type changed.

| Field | Before | After | Breaking? |
|---|---|---|---|
| `occurrences` | absent | `number` (optional; present on hook-derived rows only, `>= 1`) | No — optional, and `findLedgerSchemaDrift` never rejects unknown keys |
| `last_seen_at` | absent | ISO-8601 string (optional; hook-derived rows only) | No — same |
| `file` (hook-derived rows only) | `.blackhole/hook-events/<generated-filename>.json` | `.blackhole/hook-events/<pattern_id>/<worktree-key>` | **Yes, semantically** — the value is now a synthetic identity, not a path. Non-hook rows are untouched. `worktree-key` is `resolveWorktreePath(event.worktree)` (the same resolver already used for `issue_ref` matching) or the literal `no-worktree` when absent — per the owner's ruled identity, `(vcode, pattern_id, worktree)`, not `(hook, pattern_id)`. `pattern_id` is `"hook-exec-failure"` for every `error`-tier event regardless of which of the two hooks produced it (accepted consequence — `summary` still names the originating `hook`). |

Behavioral contract change in `ingestHookEvents`, stated as a baseline:

| Behavior | Before | After |
|---|---|---|
| Dedup candidate statuses | `open` **or** `deferred` (`isDedupCandidate:49`) | `open` only, for hook-derived rows |
| Repeat of an existing row | file deleted, no ledger change | `occurrences += 1`, `last_seen_at` bumped, source archived |
| Consumed event file | `fs.unlinkSync` | moved to `.blackhole/archive/hook-events-<ts>/` |
| `event.detail` | never read | carried into the row |
| Call sites | Triage 1b only | Triage 1b **and** turn-start step 6 |

## Threat Model

Triggered by `route.security_review_required: true`. The asset is the PreToolUse safety gate's
own accountability record — the only artifact proving whether a destructive call was gated.

| STRIDE | Threat | Severity | Mitigation status |
|---|---|---|---|
| Spoofing | A worker with Bash access to the main clone forges a benign-looking event file, or overwrites a real one, before ingest | Medium | **Accepted Risk** — pre-existing and explicitly documented (`hook-schemas.md` § Orchestrator consumption: globbing before validating the return "narrows that window; it does not close it"). Task 4's archive-then-delete slightly *narrows* it further by preserving the consumed artifact; nothing in this plan widens it. |
| Tampering | A worker deletes its own event file to hide a refusal | High | **Accepted Risk** — identical to the pre-existing exposure above; unchanged by this plan. Out of scope, and named as such rather than silently inherited. |
| Repudiation | A fail-open occurs and no durable record survives — the reported defect | High | **Mitigated** — Task 4 archives every consumed event instead of deleting it, and Task 1 guarantees each is represented by a ledger row carrying an occurrence count. This is strictly more durable than today's `unlinkSync`. |
| Information Disclosure | Carrying `event.detail` into the ledger leaks a command string or path | Medium | **Mitigated** — `detail` is capped at 300 chars and credential-redacted at write time by the producing hook (`hook-schemas.md` § schema table); this plan copies an already-redacted field and adds no new capture. Task 6 must not add stdin replay. |
| Denial of Service | The visibility fix floods the ledger/dashboard, drowning real findings — the collision this design resolves | High | **Mitigated** — semantic identity collapses 392 events to ~12 rows (measured 30:1); Task 3's bounded, sorted render caps the read cost regardless of row count. |
| Elevation of Privilege | The ingest path gains write access beyond the ledger, or a non-orchestrator process writes it | Medium | **Mitigated** — `ingestHookEvents` stays a pure function returning a new ledger value; both call sites run in the orchestrator, the sole permitted writer (`blackhole-state.md` § Single-writer invariant). No worker gains a write path. |

## Dependency Blast-Radius

14 affected consumers (≥3), enumerated by grep against `origin/main`. Full table with per-row
notes: `.blackhole/plans/issue-893-design.md` § 6 — summarized here rather than restated.

| Consumer | Classification | Note |
|---|---|---|
| `scripts/lib/hook-event-triage.test.ts:56` | BREAKING | Asserts the old filename-derived `file` value |
| `scripts/lib/hook-event-triage.test.ts:88` | BREAKING | Dedup fixture built entirely on filename identity |
| `scripts/lib/campaign-status/dashboard.ts:106` | BREAKING | Renders an incremented counter identically to a first occurrence unless updated |
| `scripts/lib/hook-event-triage.ts:49` (`isDedupCandidate`) | BREAKING | Admits `deferred`; a deferred collapsed row becomes a permanent silent sink |
| `scripts/checks/ledger-schema.check.ts:35` | TRANSPARENT | Validates only present known keys |
| `scripts/lib/campaign-status/queue.ts:3` | TRANSPARENT | Counts rows; row-count semantics unchanged |
| `scripts/lib/promote-review-artifact.ts` | TRANSPARENT | Reads existing fields only |
| `scripts/triage-deferred-findings.ts` | TRANSPARENT | Operates on `status`/`deferred_to_issue` |
| `scripts/migrate-ledger-schema.ts` | TRANSPARENT | Migrates `pr` → `pr_ref` |
| `scripts/checks/deferred-reconciliation.check.ts` | TRANSPARENT | Reads deferred rows' targets |
| `src/references/orchestrator-runtime.md:82` (×7 trees) | DEPRECATION | Per-event-append prose no longer holds |
| `src/references/hook-schemas.md:147` (×7 trees) | DEPRECATION | Same |
| `src/references/findings-ledger.md` field table | DEPRECATION | Gains two rows |
| `.blackhole/findings-ledger.json` `F-00079` | DEPRECATION | Legacy row survives beside a new aggregated row |

## Execution Strategy & Stop Conditions

- **Owner ruling is resolved — A′, per-class identity with a count.** No further gate before
  Task 1; `ADR-042-hook-event-finding-cardinality-and-visibility.md` (staged) is the record.
- **Red-before-green is the deliverable, not a formality (AC4).** Every test in Task 2 must be
  shown failing against `plan_base_commit` (`d55cd59a`) **for the stated reason**, not merely
  failing to compile — a test that passes unmodified against current `main` does not
  discriminate this change from a no-op and must be rewritten before Task 3 begins
  (`V-TEST-11`, `V-UNFALSIFIABLE-01`). If any Task 2 test passes before its corresponding
  implementation task lands, stop and revert.
- **The three guards ship together or not at all.** Tasks 1 (semantic identity), 2 (`open`-only
  dedup) and 3 (render + sort) are one atomic unit: if any one is dropped or deferred during
  implementation, abort the whole change and revert, because identity-collapse without the
  render guard reproduces #893 inside its own fix (both blind critics, CRITICAL).
- **No destructive first run.** Task 4's archive-then-delete must land before either call site
  runs against the live 392-file backlog. If an ingest executes against
  `.blackhole/hook-events/` before archiving is in place, stop and restore from
  `.blackhole/archive/`.
- **Ledger write is guarded, not hand-rolled.** Every ledger mutation goes through
  `state-write-guard.ts --entity-key findings`; if the guard exits non-zero, abort the install
  and leave the live ledger untouched.
- **Turn-start failure has a declared disposition.** The new step 6 must specify its behavior
  on throw. If a design review cannot agree on that disposition, halt Task 5 and escalate
  rather than shipping a step with no error contract (turn-start steps 2-5 have none today).
- **Scope fence.** Task 7's wrapper enrichment is confined to
  `scripts/lib/build/claude-native-settings.ts` and the generated `.claude/settings.json` —
  verified outside `templates/hooks/**` (see § Touch-Paths). If implementation drifts into
  editing anything under `templates/hooks/**`, stop and add the `V-PLUGIN-01` `package.json`
  version bump to the same diff before continuing.
- **Out of scope, file separately, do not absorb**: reducing the *probability* of a fail-open
  (adapting the hook's `timeout: 5`, retry-on-exec-failure). If an implementer finds itself
  changing the timeout, halt and file.

## Task Breakdown

1. **TDD Baseline Verification**: Run `bun test` and `bun run verify` before touching any file. — **AC**: baseline counts for both commands quoted verbatim in the completion evidence; any pre-existing failure named before proceeding.
2. **Write Failing Tests**: Author tests in `scripts/lib/hook-event-triage.test.ts` for (a) two events sharing `(vcode, pattern_id, worktree)` producing one row with `occurrences: 2` — **run this exact fixture against the current `main` first and confirm it fails by producing two separate rows** (discriminates identity, not merely presence: today's filename-keyed identity guarantees no collision, so this fixture is red on `main` for the reason the fix targets, not by accident); (b) a repeat against a `status: "deferred"` hook row producing a new **open** row rather than a silent bump — confirm this is red on `main` too, since today's `isDedupCandidate` admits `deferred` and would silently swallow the repeat; (c) a consumed event landing in `.blackhole/archive/hook-events-<ts>/` rather than being unlinked — red on `main` because `unlinkSync` leaves no archive directory at all; and in a new `scripts/lib/campaign-status/dashboard.test.ts` for (d) `renderLedgerOpenSection` emitting `occurrences` and `last_seen_at` — red on `main` because the function's return never references either key; (e) open findings sorted BLOCK-before-WARN then most-recent-first — red on `main` because the function performs no sort at all (verify by asserting on an input where append order and severity order disagree). — **AC**: all five tests exist and fail for the stated reason on the pre-change tree (`git stash` to `plan_base_commit` and re-run if needed to confirm), with the failure output quoted (`V-TEST-01/02`, `V-UNFALSIFIABLE-01`).
3. **Semantic finding identity**: In `ingestHookEvents`, set the candidate's `file` to `.blackhole/hook-events/<pattern_id>/<worktree-key>` (`worktree-key` = `resolveWorktreePath(event.worktree)` or `no-worktree`) — the owner-ruled `(vcode, pattern_id, worktree)` identity, not `(hook, pattern_id)`; on a dedup hit, increment `occurrences` and bump `last_seen_at` on the matched row instead of discarding the event. — **AC**: test 2(a) passes; running the ingest against a fixture replaying the 392-event tally (227 error / 115 block / 50 warn, per the design note's measured tier split) yields ≤ 15 rows, and the summed `occurrences` across those rows equals the input event count exactly (392) — this is the mechanical form of the owner's ruled test: **archived-event-count equals the sum of `occurrences` across the rows produced from them**, not merely "a test exists".
4. **`open`-only dedup for hook rows**: Narrow the dedup-candidate set so a hook-derived row with `status: "deferred"` is not a dedup target. — **AC**: test 2(b) passes; a fail-open arriving after its class row was deferred produces a new row with `status: "open"`.
5. **Bounded, sorted, occurrence-aware render**: Update `renderLedgerOpenSection` to emit `occurrences` and `last_seen_at` when present, and to sort open findings by severity (BLOCK first) then `last_seen_at`/`created_at` descending before slicing. — **AC**: tests 2(d) and 2(e) pass; with 350 synthetic open rows the rendered section still shows every BLOCK-severity row's `vcode` within the first 10 lines.
6. **Archive-then-delete**: Replace `fs.unlinkSync` with a move into `.blackhole/archive/hook-events-<ts>/`, performed before the ledger value is returned. — **AC**: test 2(c) passes; after an ingest run the archive directory's file count equals the pre-run event count.
7. **Carry `event.detail` into the row**: Include the already-redacted `detail` in the ledger row (or its summary) so a collapsed row is diagnosable, and enrich the wrapper's `error`-tier `detail` in `scripts/lib/build/claude-native-settings.ts` with a stderr tail and a timeout-vs-crash discriminator — **no stdin replay**. — **AC**: a regenerated wrapper's `hook-exec-failure` record carries a `detail` distinguishable from the current literal `"process exit code 1"`, demonstrated on a forced non-zero validator exit; and a ledger row produced from a `block`-tier event contains that event's target path.
8. **Wire the turn-start trigger**: Add step 6 to `src/references/orchestrator-runtime.md` § Session resume & recovery invoking the ingest, existence-gated on the script being present, with an explicit disposition on throw. — **AC**: the new step names its existence gate and its on-throw behavior in its own text; `bun run build` regenerates all dist copies and `bun run verify` reports no `V-DRY`/`V-GATE` regression.
9. **Update prose and schema docs**: Correct the per-event-append prose in `src/references/orchestrator-runtime.md` § Triage 1b and `src/references/hook-schemas.md` § Orchestrator consumption; add `occurrences`/`last_seen_at` to `src/references/findings-ledger.md`'s field table and the archive path to `src/references/blackhole-state.md` § Paths. — **AC**: no source file under `src/references/` still describes a one-row-per-event append; `bun run build` leaves no stale dist copy (`git status --porcelain` clean after build).
10. **Verify Integrity**: Run `bun test` and `bun run verify` clean, and re-run the ingest against a copy of the live backlog fixture. — **AC**: full suite green and `verify` clean, both quoted; no BLOCK-severity check regressed against Task 1's baseline.

## Sprint Contract

Each task above carries its own machine-verifiable `— **AC**:`; those are the binding
conditions. The blanket "all tests and linters pass" applies only as the definition of done for
work with no narrower AC. Two additions bind the whole sprint: the summed `occurrences` across
all hook-derived rows must equal the ingested event count (never-drop, Task 3's AC), and Tasks
3-5 must land in one commit or not at all (§ Execution Strategy).

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS |
| `ac_facts_literal_bump` | PASS |

`design_gate: approved` (frontmatter) — the design-approval gate is resolved (A′, owner ruling
2026-09-06; `ADR-042-hook-event-finding-cardinality-and-visibility.md`, staged). This plan is
ready for dispatch.

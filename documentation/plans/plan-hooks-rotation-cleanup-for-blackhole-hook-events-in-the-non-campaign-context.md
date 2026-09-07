---
type: plan
summary: "Sentinel-gated, age-only archive rotation for .blackhole/hook-events/ in the non-campaign context (issue #970), reusing hook-event-triage.ts's archive-not-delete shape"
status: current
review_trigger: "on file change"
created: 2026-09-07
last_updated: 2026-09-07
---


# Plan - Issue #970

## Objective

Give `.blackhole/hook-events/` an automatic, self-triggered rotation mechanism for the
**non-campaign context** — the interactive, no-`.blackhole/config.json` session where nothing
today ever reads or prunes it (issue #870's `defer` tier writes there unconditionally; Triage
only runs inside a live campaign). The ruled design is **owner-reshaped Option 2**: a daily,
sentinel-gated, age-only sweep that **archives** eligible files into
`.blackhole/archive/hook-events-rotated-<ts>/` — never deletes — reusing
`hook-event-triage.ts`'s existing `archiveConsumedFiles` rename-to-archive **shape** (the literal
function cannot be imported across the runtime boundary: `templates/hooks/pretooluse/**` ships
verbatim as CommonJS `.js` with no build/TS step, while `archiveConsumedFiles` lives in
`scripts/lib/*.ts`). This design decision is final (`.blackhole/plans/issue-970-design.md` §
"Gate — blind-critic verdict and owner ruling (turn 19)") — this plan implements it and does not
re-litigate it.

The six binding constraints from the owner ruling, each carried into at least one task AC below
(cross-reference table before § Task Breakdown):

1. Archive, never delete (reuse the rename-to-archive shape).
2. The archive is what makes the non-atomic `.blackhole/config.json`-absence gate's TOCTOU race
   benign — never optimize it back into a delete.
3. One tunable only: the age/retention window. No second knob (no hard file/size cap).
4. Sentinel-gated (O(1) mtime check), never a per-write `readdir`+sort.
5. Persist the sentinel only after the sweep completes (crash mid-sweep self-heals).
6. Frame the problem, code comments, and retention default around directory **entry count**
   (`readdir`/glob cost), never disk-byte growth.

## Touch-Paths

- `templates/hooks/pretooluse/utils/hook-event-log.js` — extract `hasNoCampaignConfig(mainClone)`,
  hoist `rotationRoot`, wire the guarded `rotateHookEvents(dir)` call after the existing
  `fs.writeFileSync`.
- `templates/hooks/pretooluse/utils/hook-event-rotation.js` — **new** module: `rotateHookEvents`,
  the sentinel read/write helpers, the age-cutoff sweep.
- `templates/hooks/pretooluse/utils/sibling-plugin-guard.js` — replace its inline
  `.blackhole/config.json` stat try/catch with a call to the extracted `hasNoCampaignConfig`.
- plus all generated dist trees per `scripts/lib/build/trees.ts`'s `copyHooksDir` call sites
  (`plugins/blackhole/hooks/`, `plugins/blackhole-claude/hooks/`, `.agents/build/hooks/`) — do not
  hand-enumerate; `copyHooksDir` is the SSOT for which trees this source compiles to.
- `scripts/hooks-validate-bash.test.ts`, `scripts/hooks-validate-file.test.ts` — no logic
  changes expected, but both suites' ~200 combined `withTempGitRepo`/`withLinkedWorktree` call
  sites (that don't call `writeCampaignConfig`) now transparently exercise the new rotation gate
  on every `recordEvent` — regression-run, not edited, unless a specific assertion needs it.
- `scripts/hook-event-rotation.test.ts` — **new** direct-import unit test for the new module.
- `src/references/hook-schemas.md` — document the rotation mechanism (Documentation Impact,
  below).
- `.claude/skills/blackhole/references/config-template.md` — register the new
  `BLACKHOLE_HOOK_EVENT_RETENTION_DAYS` env-var override for discoverability (see note below;
  this is **not** a `.blackhole/config.json` key, so it does not itself trigger `V-CONFIG-02`).
- `package.json` — version bump (V-PLUGIN-01, this diff touches `templates/hooks/**`).

## Documentation Impact

`src/references/hook-schemas.md` — add a short subsection under its existing
"## PreToolUse hook events (`.blackhole/hook-events/`, #447)" heading (search-before-write
confirmed: this is the sole existing canonical doc for this subsystem's on-disk behavior; no
new file created) describing: the rotation trigger (non-campaign context only, sentinel-gated,
once/24h), the archive destination (`.blackhole/archive/hook-events-rotated-<ts>/`, never
delete), the `BLACKHOLE_HOOK_EVENT_RETENTION_DAYS` env var and its default, and the entry-count
(not disk-byte) framing (owner-ruling constraint 6).

`.claude/skills/blackhole/references/config-template.md` — add a short
"### Environment Variable Overrides" subsection (none exists today; the file currently documents
only `.blackhole/config.json` keys) registering `BLACKHOLE_HOOK_EVENT_RETENTION_DAYS` alone —
**not** every pre-existing `BLACKHOLE_*` hook env var (`BLACKHOLE_HOOK_EVENT_DIR`,
`BLACKHOLE_ASSIGNED_WORKTREE`, `BLACKHOLE_SCRATCHPAD_DIR`, `BLACKHOLE_CLAUDE_HOME`), which are
pre-existing, undocumented-here debt outside this issue's scope (`V-SCOPE-01`). Note explicitly
in that subsection why this tunable is an env var and not a `.blackhole/config.json` field: the
rotation gate only ever runs when that file is **absent** — a config.json-sourced setting would
be definitionally unreadable in the one context this mechanism executes in.

## Critical Files

- `templates/hooks/pretooluse/utils/hook-event-log.js` — the PreToolUse hooks' sole durable-record
  write path (`recordEvent`); a mistake here risks silently losing V-HOOK-01/02 evidence for a
  live campaign.
- `templates/hooks/pretooluse/utils/sibling-plugin-guard.js` — the fail-closed ownership-detection
  guard whose stat pattern is being extracted and reused; a regression here re-opens issue #870's
  defer-vs-stay-active safety property.

## Codebase Conventions

| Touchpoint | Convention | Source |
|---|---|---|
| Archive-not-delete lifecycle for `.blackhole/hook-events/*.json` | Rename consumed/eligible files into a fresh `.blackhole/archive/hook-events-<variant>-<Date.now()>/` directory; never `fs.unlinkSync`. | `scripts/lib/hook-event-triage.ts`'s `archiveConsumedFiles` (ADR-042 item 4) — **shape** reused, not the literal function (see Objective's runtime-boundary note) |
| `.blackhole/config.json`-absence check | `fs.statSync` the file; `ENOENT` → absent; any other error → ambiguous, fail closed toward the safer default for that call site. | `sibling-plugin-guard.js`'s pre-existing inline try/catch — extracted this issue into `hasNoCampaignConfig(mainClone)`, exported from `hook-event-log.js` |
| One small, independently-callable guard module per file under `utils/`, no class, no shared state | `hook-event-rotation.js` follows this shape exactly. | `sibling-plugin-guard.js`, `git-main-clone-guard.js`, `worktree-removal-guard.js`, `bash-write-target-guard.js` |
| Env-var override naming | `BLACKHOLE_<PURPOSE>` | `BLACKHOLE_HOOK_EVENT_DIR`, `BLACKHOLE_ASSIGNED_WORKTREE`, `BLACKHOLE_SCRATCHPAD_DIR`, `BLACKHOLE_CLAUDE_HOME` |
| Best-effort recording, decision path never affected | Any new failure mode inside `recordEvent`'s write path is caught locally and logged to stderr; it never propagates to alter the validator's allow/deny decision. | `hook-event-log.js` module docstring; `recordEvent`'s existing outer `try/catch` around `fs.mkdirSync`/`fs.writeFileSync` |
| Subprocess-driven behavioral test harness for `templates/hooks/pretooluse/**` | `runPreToolUseHook` (`scripts/lib/test-fixtures.ts`) spawns the real script against a temp git repo; `readHookEvents` does an **unfiltered** `readdirSync` + `readJsonFile` over `.blackhole/hook-events/` (no `.json`-suffix filter) — any new non-JSON file placed *inside* that directory breaks every existing assertion built on it. | `scripts/lib/test-fixtures.ts:307-313` (`readHookEvents`); confirmed live this plan (binding constraint on sentinel placement, see Task Breakdown) |
| Direct-import unit test for a `scripts/lib/*.ts` module, alongside the existing subprocess suites | `scripts/lib/hook-event-triage.test.ts` imports `archiveConsumedFiles`/`ingestHookEvents` directly rather than only exercising them through a CLI subprocess. | `scripts/lib/hook-event-triage.test.ts:5` |

## Database/API Schema Changes

N/A — no database or public API schema changes. The `.blackhole/hook-events/<event-id>.json`
event schema (`src/references/hook-schemas.md`) is unchanged: rotation moves whole files, it
never reads or rewrites their contents.

## Threat Model

Triggered: `route.security_review_required: TRUE` at confidence 75 in the design note's Routing
context (§1), citing "file I/O operations on cleanup carry risk of over-deletion or leaving
sensitive data."

| Threat | Description | Severity | Mitigation status |
|---|---|---|---|
| Spoofing | N/A — no identity/auth boundary in this mechanism; it only moves files the calling process already has filesystem permission to write. | Low | Mitigated (not applicable) |
| Tampering | A rotation bug could move a still-needed event file out of `.blackhole/hook-events/` before a future Triage run ingests it (over-deletion risk named in the design's routing context). | High | Mitigated — archive-not-delete (constraint 1) makes any such move recoverable and inspectable at `.blackhole/archive/hook-events-rotated-<ts>/`, never a permanent loss; the gate itself only ever fires when `.blackhole/config.json` is absent, which is mutually exclusive with Triage's own precondition (design note §6) |
| Repudiation | An archived-but-unconsumed event file remains a durable, timestamped record on disk (never destroyed), preserving the same audit trail a live event file would have offered. | Low | Mitigated |
| Information Disclosure | Archived files may still carry the `error` tier's pre-existing, documented unredacted-detail gap (`hook-schemas.md`) — unchanged by this issue, since rotation never rewrites content, only relocates whole files within the same `.blackhole/` trust boundary (already gitignored, no new exposed surface). | Medium | Mitigated (pre-existing gap, not widened; no new disclosure surface introduced) |
| Denial of Service | Unbounded directory-entry growth in `.blackhole/hook-events/` degrades `readdir`/glob cost for any future consumer (Triage, once a campaign eventually starts on this machine) — this is the problem this issue exists to solve, framed around entry count per owner-ruling constraint 6, never disk bytes. | Medium | Mitigated by the age-based sweep (Task Breakdown, below) |
| Elevation of Privilege | N/A — rotation writes only within `.blackhole/`, a directory the calling process already has full read/write access to; no privilege boundary is crossed. | Low | Mitigated (not applicable) |

## Dependency Blast-Radius

Reuses the design note's own grep-based `recordEvent(` consumer scan (§6) rather than
re-deriving it — same method, same classifications, re-confirmed live this plan against current
line numbers (`V-INT-02`/`V-DRY-01`). 7 affected consumers (≥3 — section required):

| Consumer | Classification | Note |
|---|---|---|
| `hook-event-log.js:521` — `denyAndRecord` (`tier: 'block'`) | TRANSPARENT | No signature change; the new rotation call is internal to `recordEvent`, in its own nested `try/catch`, best-effort exactly like the existing `fs.mkdirSync`/`fs.writeFileSync` pair. |
| `hook-event-log.js:540` — `warnAndRecord` (`tier: 'warn'`) | TRANSPARENT | Same as above. |
| `validate-bash-command.js:50` — direct `recordEvent` call (`tier: 'defer'`, #870) | TRANSPARENT | This is the specific call site issue #970 was filed about; it gets the fix automatically by funneling through `recordEvent`, no separate insertion needed. |
| `validate-file-changes.js:62` — direct `recordEvent` call (`tier: 'defer'`, #870) | TRANSPARENT | Same as above. |
| `sibling-plugin-guard.js`'s inline `.blackhole/config.json` stat check | TRANSPARENT (behavior-preserving extraction) | Becomes a call to the shared `hasNoCampaignConfig`; identical fail-closed semantics and return contract — existing `hooks-validate-*.test.ts` defer-tier assertions must stay green unmodified. |
| `scripts/lib/test-fixtures.ts`'s `runPreToolUseHook` (all ~200 combined existing call sites in `hooks-validate-bash.test.ts`/`hooks-validate-file.test.ts` that omit `eventDir`/`writeCampaignConfig`) | TRANSPARENT, but now **exercises** the new gate (not merely unaffected by it) | These call sites never set `BLACKHOLE_HOOK_EVENT_DIR` and never call `writeCampaignConfig`, so `hasNoCampaignConfig` resolves true and `rotateHookEvents` runs on every one of them — with nothing old enough to archive, this must remain a no-op precisely because `readHookEvents` (`test-fixtures.ts:307-313`) does an unfiltered `readdirSync` over `.blackhole/hook-events/`: the sentinel MUST live outside that directory (Task Breakdown enforces this placement). |
| `orchestrator-runtime.md` § Triage step 1b / § Session resume step 6 (`ingestHookEvents`) | TRANSPARENT (by construction) | Both only ever run inside an active campaign (`.blackhole/config.json` present); rotation only ever runs when that file is absent. Structurally mutually exclusive, not merely usually non-overlapping. |

## Execution Strategy & Stop Conditions

- Run test files scoped first (`bun test scripts/hook-event-rotation.test.ts`, then
  `scripts/hooks-validate-bash.test.ts`, then `scripts/hooks-validate-file.test.ts`), one at a
  time; run the full `bun test` suite only once, at the end, per this workstation's
  resource-frugal doctrine — **if** `free -m`'s `MemAvailable` is below 3500 MB or
  `load1 ÷ nproc` is above 1.0 immediately before a scoped run, **then** halt and wait rather than
  starting it.
- **If** any of the ~200 existing `hooks-validate-bash.test.ts`/`hooks-validate-file.test.ts`
  assertions that build on `readHookEvents(repo)` start failing after the rotation wiring lands,
  **then** abort the wiring task immediately and re-verify the sentinel file's path is a sibling
  of (never inside) `.blackhole/hook-events/` before re-attempting — this is the single most
  likely regression given `readHookEvents`'s unfiltered `readdirSync` (Codebase Conventions,
  above).
- **If** `rotateHookEvents` throws for any reason during the wiring task's manual smoke check,
  **then** revert the `recordEvent` call site back to no rotation call and re-diagnose before
  re-attempting — a rotation exception must never be observed to alter a validator's
  allow/deny decision (Threat Model — Tampering row's mitigation depends on this holding).
- **If** the live `package.json` version at implement time is not strictly greater than the
  `origin/main` value at implement time, **then** halt and re-read `origin/main`'s `package.json`
  before bumping — never hand-copy the `0.21.13` value captured during planning, which may have
  already moved (issue #769's literal-frozen-number-pair hazard, same category).

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test scripts/hooks-validate-bash.test.ts
  scripts/hooks-validate-file.test.ts` to confirm both suites pass before any change. —
  **AC**: baseline run output quoted (pass count, 0 failures) in the completion evidence.

- [ ] **Write failing test — `hasNoCampaignConfig` extraction**: add a direct-import test
  (new `describe` block in a suitable location, or a new small test file) asserting
  `hook-event-log.js` exports a `hasNoCampaignConfig(mainClone)` function returning `true` only
  when `<mainClone>/.blackhole/config.json` is absent (`ENOENT`), and `false` when present or on
  any other stat error (ambiguous → fail closed). — **AC**: test fails with
  `hasNoCampaignConfig is not a function` (or equivalent "not exported yet") before
  implementation.

- [ ] **Write failing tests — `hook-event-rotation.js` (new module, `scripts/hook-event-rotation.test.ts`)**:
  cover, each as its own test: (a) a file older than the retention window is moved into
  `.blackhole/archive/hook-events-rotated-<ts>/` and no longer present at its original path; (b)
  a file newer than the retention window is left in place; (c) calling `rotateHookEvents` twice
  in quick succession only sweeps once (sentinel gates the second call — assert via a spy/counter
  on `fs.readdirSync` call count, or by pre-seeding a stale file and confirming it survives the
  second call because the sentinel is now fresh); (d) `BLACKHOLE_HOOK_EVENT_RETENTION_DAYS` set
  to a small integer changes the cutoff (a file just inside vs. just outside that window is
  archived/kept accordingly); (e) an invalid retention env var value (non-numeric, `0`, negative)
  falls back to the 14-day default rather than throwing; (f) the sentinel file is **not** written
  until after the sweep loop completes — assert by injecting a `fs.renameSync` that throws on the
  first call and confirming the sentinel file's mtime is unchanged (constraint 5); (g) the
  sentinel file's own path resolves **outside** `<eventsDir>` (constraint enforced by the
  Codebase Conventions row above — assert `path.dirname(sentinelPath) !== eventsDir`). —
  **AC**: all 7 sub-tests exist and fail (module/export not found) before implementation.

- [ ] **Write failing test — `recordEvent` gate wiring**: extend
  `scripts/hooks-validate-bash.test.ts` (or a small new integration test) with a case that: seeds
  a temp git repo with **no** `.blackhole/config.json`, pre-creates an event file in
  `.blackhole/hook-events/` with an mtime older than the default retention window (via
  `fs.utimesSync`), triggers a second `recordEvent`-causing hook call (e.g. another denied Bash
  command), and asserts the pre-created stale file has moved into
  `.blackhole/archive/hook-events-rotated-*/` while the newly-recorded event remains in
  `.blackhole/hook-events/`. A second case seeds the same fixture **with**
  `writeCampaignConfig(repo, {})` present and asserts the stale file is **untouched** (rotation
  never fires when campaign config is present). — **AC**: both cases fail (no archived file
  produced) before implementation.

- [ ] **Implement `hasNoCampaignConfig` extraction**: add `hasNoCampaignConfig(mainClone)` to
  `hook-event-log.js` (same fail-closed stat pattern `sibling-plugin-guard.js` already has —
  `ENOENT` → `true`, any other outcome → `false`), export it, and replace
  `sibling-plugin-guard.js`'s inline try/catch with a call to it via
  `require('./hook-event-log')`. — **AC**: the new `hasNoCampaignConfig` test passes; every
  existing `sibling-plugin-guard`-exercising assertion in `hooks-validate-bash.test.ts`/
  `hooks-validate-file.test.ts` (defer-tier tests) stays green unmodified.

- [ ] **Implement `hook-event-rotation.js`**: new module exporting `rotateHookEvents(eventsDir)`.
  Internals: a sentinel file at `path.join(path.dirname(eventsDir), 'hook-events-rotation-sentinel')`
  (a sibling of the hook-events directory itself, never inside it — binding placement constraint,
  Codebase Conventions row above); an O(1) `fs.statSync` mtime check against a hardcoded 24h
  interval to decide whether to sweep at all (constraint 4 — no `readdir` on a fresh sentinel);
  when stale (or sentinel absent/unreadable), read `BLACKHOLE_HOOK_EVENT_RETENTION_DAYS`
  (positive integer, default 14, silently falling back on any invalid value), `readdirSync` the
  `.json` files in `eventsDir`, `fs.statSync` each for mtime, and `fs.renameSync` every file older
  than the cutoff into a lazily-created `.blackhole/archive/hook-events-rotated-<Date.now()>/`
  (mirrors `archiveConsumedFiles`'s shape: `mkdirSync` only when there is at least one file to
  move — constraint 1); per-file rename failures (a concurrent Triage run winning a race) are
  caught and skipped, never aborting the whole sweep; the sentinel is written **only** after the
  sweep loop finishes, unconditionally (even when zero files were eligible) — constraint 5. No
  hard file/size cap of any kind (constraint 3). Code comments frame the mechanism around
  directory entry count, not disk bytes (constraint 6). — **AC**: all 7 sub-tests from the
  prior task pass.

- [ ] **Wire `recordEvent`**: in `hook-event-log.js`, hoist a `rotationRoot` variable (`null` by
  default) that is set to `destRoot` **only** on the ordinary main-clone-resolution branch (never
  on the `BLACKHOLE_HOOK_EVENT_DIR` override branch, never on the anomalous-git-failure
  `CLAUDE_PROJECT_DIR` fallback branch); after the existing `fs.writeFileSync` succeeds, when
  `rotationRoot` is non-null, call `hasNoCampaignConfig(rotationRoot)` and — only if `true` —
  call `rotateHookEvents(dir)`, both wrapped in their own nested `try/catch` (a single
  `console.error` line on failure, mirroring the existing write-failure log line) so a rotation
  exception can never escape into `recordEvent`'s outer catch or alter the caller's allow/deny
  decision. — **AC**: the `recordEvent` gate-wiring test (both cases) passes; `bun test
  scripts/hooks-validate-bash.test.ts scripts/hooks-validate-file.test.ts` still reports the same
  pass count as the TDD Baseline Verification task (zero regressions across the ~200 call sites
  that now transparently traverse the new gate).

- [ ] **Document the mechanism**: add the rotation subsection to
  `src/references/hook-schemas.md` (trigger, archive destination, env var + default, entry-count
  framing) and the "### Environment Variable Overrides" subsection to
  `.claude/skills/blackhole/references/config-template.md` registering
  `BLACKHOLE_HOOK_EVENT_RETENTION_DAYS` with the env-var-not-config-key rationale. — **AC**: both
  docs updated; `grep -q "BLACKHOLE_HOOK_EVENT_RETENTION_DAYS"
  src/references/hook-schemas.md .claude/skills/blackhole/references/config-template.md` matches
  in both files.

- [ ] **Version bump (`V-PLUGIN-01`)**: at implement time, read the live `package.json` `version`
  field (re-derive, never hand-copy this plan's `0.21.13`-observed value — Execution Strategy,
  above) and bump its patch segment by 1 in the same diff that touches `templates/hooks/**`. —
  **AC**: `package.json`'s `version` in the diff is strictly greater (semver patch bump) than
  whatever `origin/main`'s `package.json` `version` resolves to at implement time.

- [ ] **Verify Integrity**: run `bun run scripts/verify.ts` and the full `bun test` suite once,
  per the Execution Strategy's resource-frugal ordering. — **AC**: `bun run scripts/verify.ts`
  exits 0; full `bun test` reports 0 failures; both outputs quoted in the completion evidence.

## Sprint Contract

Per-task acceptance criteria are declared inline above (`— **AC**: ...`) and are the binding
definition of done for each task; "all tests and linters pass" (the final Verify Integrity task)
is the definition of done only for that task itself, not a substitute for the narrower ACs above
it.

Constraint → AC cross-reference (every owner-ruling constraint traced to at least one task AC):

| # | Constraint | Carried by |
|---|---|---|
| 1 | Archive, never delete | "Implement `hook-event-rotation.js`" AC (mkdirSync/renameSync into archive dir); "Write failing tests — `hook-event-rotation.js`" sub-test (a) |
| 2 | Archive is what makes the TOCTOU race benign | Threat Model — Tampering row's mitigation; Objective's constraint list |
| 3 | One tunable only (no hard cap) | "Implement `hook-event-rotation.js`" AC ("No hard file/size cap of any kind") |
| 4 | Sentinel-gated, not per-write | "Write failing tests — `hook-event-rotation.js`" sub-test (c); "Implement `hook-event-rotation.js`" AC (O(1) mtime check) |
| 5 | Persist sentinel only after sweep completes | "Write failing tests — `hook-event-rotation.js`" sub-test (f); "Implement `hook-event-rotation.js`" AC |
| 6 | Frame around entry count, not disk bytes | "Implement `hook-event-rotation.js`" AC (code-comment framing); "Document the mechanism" task |

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no schema change (§ Database/API Schema Changes) |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS |

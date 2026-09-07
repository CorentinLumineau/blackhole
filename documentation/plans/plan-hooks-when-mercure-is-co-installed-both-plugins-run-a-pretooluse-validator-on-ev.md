---
type: plan
summary: "Standard-track implementation plan for issue #870 Option A-prime — blackhole's two PreToolUse validators exit early when a sibling mercure plugin is registered and no .blackhole/config.json is present, recording a human-greppable-only defer event"
status: current
review_trigger: "on ADR-030 amendment or on mercure shipping its own counterpart defer change"
created: 2026-09-07
last_updated: 2026-09-07
related: [.blackhole/plans/issue-870-design.md]
---


# Plan - Issue #870

## Objective

Issue #870: when both blackhole and mercure are installed as Claude Code plugins, every Bash /
Write / Edit call runs **two** independently-versioned PreToolUse validators with drifted deny
lists (194/122 differing lines on the Bash gate, 441/166 on the Write|Edit gate). The design
note at `.blackhole/plans/issue-870-design.md` ran the Design Track twice; round 2's
`design-aggregate.ts` verdict was `status: blocked` (dominance + disagreement across primary and
two blind critics), and the owner ruled at turn 19 to proceed with **Option A-prime** anyway,
with two binding corrections over the plain Option A the primary and critic A preferred. This
plan is the Standard-track implementation plan for that ruled option. It does **not** re-open
the option choice — Options A (plain), B, and C are decided against; only A-prime is in scope.

**What Option A-prime is**: `templates/hooks/pretooluse/validate-bash-command.js` and
`validate-file-changes.js` each gain a small ownership-detection guard, run as the very first
check (before any pattern loading). When (1) a sibling `mercure` plugin is registered in
`~/.claude/plugins/installed_plugins.json`, (2) the calling repo resolves to a real git main
clone, and (3) that main clone has no `.blackhole/config.json` — i.e. an interactive,
non-campaign session — blackhole records a **human-greppable-only** hook event (own
`pattern_id`, own `tier`, deliberately never folded under `V-HOOK-02`) and exits silently,
ceding the call to mercure's own, independently-registered hook. Any detection ambiguity
(unreadable/malformed `installed_plugins.json`, no git context, an anomalous `mainCloneRoot`
throw) fails closed toward **not** deferring — blackhole stays active.

**Out of scope for this plan** (per the design note's turn-19 ruling and its own Blast Radius
section — do not absorb):
- Option B (converging `bash-patterns.json`/`file-patterns.json` into one shared file) —
  eliminated in round 2, unanimously last, CRITICAL findings from both blind critics: not
  unilaterally deliverable from this repo.
- Health-based (vs. registration-based) sibling detection — round-2 finding 4, logged as a
  follow-up, not closed by this plan.
- Rotation/cleanup for `.blackhole/hook-events/` in the non-campaign context — logged as a
  follow-up, not closed by this plan.
- Authoring the ADR the issue's own "Fix direction" text asks for ("record the decision as an
  ADR amendment to ADR-030 or a new ADR"). That is Design Track Gate work
  (`resume_context: design_approved` branch, `planner.md` §4.8), a separate planner spawn with
  its own `design-aggregate.ts`-gated staging flow — not this Standard-track implementation
  plan's job. **Flagging this explicitly so it is not silently dropped**: the orchestrator should
  dispatch that spawn separately: it is not created by this plan and this plan's Touch-Paths
  contain no `documentation/decisions/` file.
- Mercure's own counterpart change (deferring to blackhole when `.blackhole/config.json` *is*
  present) — filed as a separate issue on mercure's own forge, outside this repo entirely.

## Touch-Paths

- `templates/hooks/pretooluse/utils/sibling-plugin-guard.js` — new file. Exports
  `shouldDeferToMercure(cwd)`.
- `templates/hooks/pretooluse/validate-bash-command.js` — one new `require` + one new early-exit
  call site, inserted after `cwd` resolution and before `loadBashPatterns()`.
- `templates/hooks/pretooluse/validate-file-changes.js` — one new `require` + one new early-exit
  call site, inserted after `cwd` resolution and before `loadFilePatterns()`.
- `scripts/lib/test-fixtures.ts` — `runPreToolUseHook` gains one more optional trailing
  parameter, threaded as `BLACKHOLE_CLAUDE_HOME`, so a test can point the new guard's
  `installed_plugins.json` read at a fixture file instead of the real machine's `~/.claude/`.
- `scripts/hooks-validate-bash.test.ts` — new test cases for the defer/stay-active/fail-closed
  branches, exercised through the real validator script (established convention — no dedicated
  unit-test file for any `utils/*-guard.js` module).
- `scripts/hooks-validate-file.test.ts` — same, for the Write/Edit validator.
- `scripts/lib/hook-event-triage.ts` — no behavior change; one inline comment on `TIER_VCODE`
  documenting that the `'defer'` tier is deliberately excluded from the map (binding decision
  `c`: never fold plugin-defer under `V-HOOK-02`).
- `scripts/lib/hook-event-triage.test.ts` — new regression test locking that a `tier: 'defer'`
  event is never ingested into any `V-HOOK-0N` ledger row.
- `src/references/hook-schemas.md` plus all generated dist trees per `scripts/lib/build/targets.ts`
  — `tier` enum row gains `defer`; new paragraph documenting the sibling-plugin-defer event shape
  and its human-greppable-only status.
- `src/references/blackhole-vcodes.md` plus all generated dist trees per
  `scripts/lib/build/targets.ts` — clarifying note that the `V-HOOK-02` row does not cover
  sibling-plugin-defer events (binding decision `c`; no new V-code minted — see § Codebase
  Conventions for why).
- `templates/hooks/pretooluse/README.md` plus all generated dist trees per
  `scripts/lib/build/targets.ts` (copied verbatim by `copyHooksDir`) — new short section
  describing the sibling-plugin defer mechanism, its human-greppable-only nature, and the two
  logged follow-ups.
- `package.json` — `version` field bump (patch), mandatory for any `templates/hooks/**`-touching
  diff per the pre-existing `V-PLUGIN-01` BLOCK gate.

## Documentation Impact

`docs_governance.enabled: true` in `.blackhole/config.json`.

- `src/references/hook-schemas.md` — the `tier` enum documented at § PreToolUse hook events
  currently lists `block | warn | error`; this diff adds a fourth value, `defer`, so the doc
  would go stale the moment the code ships without this update.
- `src/references/blackhole-vcodes.md` — the `V-HOOK-02` row's plain-English description could be
  misread as covering every "allowed but recorded" event, including the new defer event; binding
  decision `c` requires this misreading to be pre-empted in text, not left to reviewer inference.
- `templates/hooks/pretooluse/README.md` — already the canonical operator-facing doc for this
  directory's hooks (see its own "Installed Cache Refresh" framing); the new defer mechanism is a
  behavior change to hooks a consumer install runs, so it belongs here, not only in code comments.
- No `ARCHITECTURE.md` Active Constraints entry: this diff is Standard track with no
  `plans/issue-870-analysis.md` present (Step 4's trigger — an `investigator` `analyze` note —
  never ran for this issue; it went straight from Design Track to this Standard-track plan), so
  the Active Constraints seeding step is inert here (`planner.md` Step 4 is analysis-note-gated,
  not track-gated by itself).
- No `documentation/decisions/` file created by this plan — see § Objective's "Out of scope" note
  above.

## Critical Files

- `templates/hooks/pretooluse/validate-bash-command.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `templates/hooks/pretooluse/utils/hook-event-log.js`

## Codebase Conventions

| Touchpoint | Convention | Citation |
|---|---|---|
| New guard module shape | One small, independently-callable predicate per file under `utils/`, no class, no state | `templates/hooks/pretooluse/utils/git-main-clone-guard.js`, `worktree-removal-guard.js`, `bash-write-target-guard.js` |
| Guard-module test coverage | No dedicated unit-test file per guard module — coverage is end-to-end through the real validator script via `runPreToolUseHook` | Confirmed by `find templates/hooks/pretooluse/utils -iname '*.test.*'` returning nothing; same convention the design note's Blast Radius section (§6) already documents |
| Fail-closed-on-read-ambiguity shape | `try { ...read/parse... } catch { return <safe default> }` — never throw, never trust an unreadable/malformed value | `readScratchpadDir`, `templates/hooks/pretooluse/utils/hook-event-log.js:197-212` |
| Main-clone resolution | Reuse `mainCloneRoot(cwd)` verbatim — routine absence returns `null`, an anomalous git failure throws and callers wrap it in their own local `try/catch` rather than letting it reach the validator's top-level `failClosed()` | `hook-event-log.js:86-93`; `git-main-clone-guard.js:45`'s existing consumer of the same import |
| "No pattern matched" fallthrough | `allowSilently()` — bare `process.exit(0)`, no stdout, no record | `hook-event-log.js:506`; both validators' existing end-of-`main()` fallthrough |
| Recorded-but-not-denied event | `recordEvent({ hook, tool, decision, tier, pattern_id, reason, detail, cwd })` — caller supplies `decision`/`tier` explicitly; `recordEvent` itself does not default them (unlike `denyAndRecord`/`warnAndRecord`, which spread a fixed `decision`/`tier` on top) | `hook-event-log.js:404-455` |
| New env-var override naming | `BLACKHOLE_<PURPOSE>`, threaded through `runPreToolUseHook`'s optional trailing parameters | `BLACKHOLE_HOOK_EVENT_DIR`, `BLACKHOLE_ASSIGNED_WORKTREE`, `BLACKHOLE_SCRATCHPAD_DIR` in `scripts/lib/test-fixtures.ts:99-122` |
| Any `templates/hooks/**` diff | Must bump `package.json`'s `version` in the same diff | `templates/hooks/pretooluse/README.md` § Enforcement; `V-PLUGIN-01` (BLOCK) |
| New V-code vs. clarifying note | Do not mint an unenforced V-code for an event no automated process ingests (`V-YAGNI-01`/`V-UNFALSIFIABLE-01`-shaped risk) — state the scope boundary in prose against the existing table instead | This plan's own binding decision `c`; `blackhole-vcodes.md`'s own convention of one row per **enforced** check |

No `## Database/API Schema Changes` section — this diff has no schema surface.

## Threat Model

Trigger: this diff modifies the PreToolUse security-gate infrastructure itself (the two
validators that are blackhole's primary unattended-worker containment boundary), which the
orchestrator's spawn instructions for this plan explicitly called out for threat-model coverage
regardless of the router's own `security_review_required: FALSE` classification (design note §1
— a low-confidence `FALSE` at 75, not a considered judgment that this specific diff is safe).

| Threat | Description | Severity | Mitigation Status |
|---|---|---|---|
| Spoofing | A locally-installed plugin registers itself under a key whose `@`-split name segment is literally `mercure` without being the genuine co-developed mercure plugin, causing `shouldDeferToMercure` to defer incorrectly | Low | Accepted Risk — requires the attacker to already have local write access to `~/.claude/plugins/installed_plugins.json`, the same trust boundary `scripts/lib/hook-sources.ts`/ADR-044 already assumes for that file; named explicitly as design note Assumption 1, not silently absorbed |
| Tampering | Deleting `.blackhole/config.json` mid-session (while it still exists, so the deletion command is itself validated by blackhole's still-active hook at that moment) permanently flips subsequent calls in that session to the defer branch | Medium | Accepted Risk — the deleting command is validated by the still-fully-active blackhole hook at the moment of deletion (no `.blackhole/config.json`-specific block pattern exists today, so this is not newly closed by this diff, but it is also not newly opened: deleting the file already had this session-wide consequence for every *other* campaign-gated behavior before this diff); mercure's own hook remains independently active throughout, so the system degrades from two validators to one, never to zero |
| Repudiation | Nobody can prove after the fact that blackhole stood down for a given call | Low | Mitigated — every defer is written via `recordEvent` to `.blackhole/hook-events/` with `hook`, `tool`, `pattern_id`, `reason`, `detail` (redacted), `worktree`; this is the entire point of binding decision `a` (use `recordEvent`, not `allowSilently()` alone) |
| Information Disclosure | The defer event's `detail` field could leak a credential-shaped command/file-path argument into a durable file | Low | Mitigated — `recordEvent` already runs every `detail`/`reason` through the existing `redact()` masking before writing (same code path every other event tier already uses; no new redaction logic needed) |
| Denial of Service | The new guard adds one `fs.readFileSync` + one `mainCloneRoot` git subprocess call to the hot path of every Bash/Write/Edit call | Low | Mitigated — bounded, single read + single git call, same cost class the existing `git-main-clone-guard.js`/`worktree-removal-guard.js` checks already pay on this same call path; no loop, no network I/O |
| Elevation of Privilege | Blackhole's own containment (worktree-write bounding, destructive-Bash denial) is fully OFF for a deferred call, backstopped only by mercure's independently-versioned hook — including the case where mercure's registration is stale (ADR-030/issue #800's documented failure class: the plugin cache is version-keyed, not content-addressed, so a stale mercure install can be registered but non-functional) | Medium | Accepted Risk — this is the design note's own round-2 gate finding 4, explicitly graded "unresolved... file as a follow-up rather than pretending the design resolves it." This plan does not close it; it converts it from an invisible gap (before: no defer record existed at all) to a visible one (after: every defer is greppable). Follow-up: health-based sibling detection, tracked below, not in this plan's Touch-Paths |

All six STRIDE categories evaluated (`V-THREAT-03`). No threat above Medium severity, so
`V-THREAT-02`'s "every HIGH/CRITICAL threat is Mitigated" bar is vacuously satisfied — the two
Accepted-Risk rows are deliberate, named, bounded residual risk, not an unmitigated blocker.

## Execution Strategy & Stop Conditions

- If the early-exit call site cannot be inserted into either validator's `main()` before pattern
  loading without restructuring more than a few lines of existing control flow, halt and escalate
  to the orchestrator rather than refactoring surrounding logic beyond this plan's Touch-Paths
  (`V-SCOPE-01`).
- If any of the three named fail-closed conditions (malformed/unreadable `installed_plugins.json`,
  no git context, an anomalous `mainCloneRoot` throw) cannot be driven to the "stay active" branch
  by a test in the existing validator suites, stop before merging — a fail-closed guarantee that
  is asserted in prose but not exercised by a test is exactly the `V-UNFALSIFIABLE-01` shape this
  campaign's binding rules block on.
- Once `bun run scripts/plan-quality-gate.ts` or `bun run verify` reports any BLOCK-severity
  result after implementation, halt and fix it before opening a PR — never carry a BLOCK forward.
- If the `defer`-tier regression test in `hook-event-triage.test.ts` fails (i.e. a `defer` event
  is unexpectedly ingested into a ledger row), abort the implementation task and treat it as a
  root-cause investigation, not a test to loosen — this is the exact claim binding decision `c`
  depends on.
- When implementation is verified complete, file the two follow-up issues named in § Objective
  (health-based sibling detection; `.blackhole/hook-events/` rotation) via the forge before
  opening the PR for this issue, and reference both issue numbers in the PR description — do not
  silently defer them with no forge trace (`blackhole-protocol.md` § Never drop findings).

## Task Breakdown

1. **TDD Baseline Verification**: Run `bun test scripts/hooks-validate-bash.test.ts
   scripts/hooks-validate-file.test.ts scripts/lib/hook-event-triage.test.ts` to confirm the
   current suites are green before touching anything. — **AC**: all three suites report 0
   failures; pass/fail counts quoted in the completion evidence.
2. **Extend the test harness for `installed_plugins.json` fixture control**: add an optional
   trailing `claudeHome?: string` parameter to `runPreToolUseHook`
   (`scripts/lib/test-fixtures.ts`), threaded as `BLACKHOLE_CLAUDE_HOME` in the spawn env exactly
   like the existing `eventDir`/`assignedWorktree`/`scratchpadDirEnv`/`claudeProjectDir`
   parameters, and update the function's docstring to name the new parameter. — **AC**: every
   existing call site of `runPreToolUseHook` across both test files still passes with byte-identical
   behavior when the new parameter is omitted (baseline suites from Task 1 stay green); a scratch
   call passing `claudeHome` results in `BLACKHOLE_CLAUDE_HOME` present in the spawned process's env
   (assert via a throwaway test asserting on `process.env` inside a stub script, or by observing the
   guard's behavior change in Task 4's own tests once it reads that var).
3. **Write failing tests — sibling-plugin defer/stay-active/fail-closed matrix**: in both
   `scripts/hooks-validate-bash.test.ts` and `scripts/hooks-validate-file.test.ts`, add cases
   (using `withTempGitRepo`/`withTempDir` plus a fixture `installed_plugins.json` under a
   `BLACKHOLE_CLAUDE_HOME` temp dir):
   - defer: sibling `mercure` registered (`"mercure@some-marketplace"` key) + no
     `.blackhole/config.json` + valid git repo → exit code 0, empty stdout (bare `allowSilently()`
     contract), exactly one recorded event with `tier: 'defer'`, `pattern_id:
     'sibling-plugin-defer'`, `decision: 'allow'`.
   - stay-active: same sibling registration, but `.blackhole/config.json` **present** in the repo
     → the hook's normal pattern checks still run (assert with a command/file-path that would
     otherwise be denied, e.g. `rm -rf /` for Bash, a system path for Write, confirming the deny
     still fires — i.e. blackhole did NOT stand down).
   - stay-active: `installed_plugins.json` has no key whose `@`-split segment is `mercure` (e.g.
     only `"frontend-design@claude-plugins-official"`) → normal pattern checks still run.
   - stay-active (fail-closed): `installed_plugins.json` absent under `BLACKHOLE_CLAUDE_HOME` →
     normal pattern checks still run.
   - stay-active (fail-closed): `installed_plugins.json` present but malformed JSON → normal
     pattern checks still run.
   - stay-active (fail-closed): no git context at all (plain `withTempDir`, no `git init`) →
     normal pattern checks still run.
   - negative control: a key like `"notmercure@x"` or `"mercure-fork@x"` (whose `@`-split segment
     is `notmercure`/`mercure-fork`, not exactly `mercure`) does NOT trigger the defer branch —
     precision of the match, not a substring/prefix match.
   All new cases target `shouldDeferToMercure`/the guard, which does not exist yet — they must
   fail (module-not-found or wrong-branch-taken) before Task 4 lands. — **AC**: every new test
   listed above exists in both files, and `bun test` on both fails (not errors from a missing
   fixture helper) with the guard absent, confirming each test genuinely exercises new logic
   rather than passing vacuously.
4. **Implement `sibling-plugin-guard.js`**: create
   `templates/hooks/pretooluse/utils/sibling-plugin-guard.js` exporting
   `shouldDeferToMercure(cwd = process.cwd())`: reads
   `<BLACKHOLE_CLAUDE_HOME or path.join(os.homedir(), '.claude')>/plugins/installed_plugins.json`,
   returns `false` on any read/parse failure or when no key's `@`-split first segment equals
   `mercure`; otherwise resolves `mainCloneRoot(cwd)` (imported from `./hook-event-log`), returns
   `false` on a throw or a `null` result (no git context); otherwise checks for
   `<mainClone>/.blackhole/config.json` via `fs.statSync` in a `try/catch` distinguishing
   `ENOENT` (config absent → return `true`, defer) from any other error (ambiguous → return
   `false`, stay active — the same fail-closed-toward-staying-active discipline as the other two
   conditions, extended to this file-existence check). — **AC**: Task 3's full matrix (defer,
   both stay-active pattern cases, all three fail-closed cases, the negative-control precision
   case) passes green with no other test in Task 1's baseline regressing.
5. **Wire the guard into both validators**: in `validate-bash-command.js`, add
   `const { shouldDeferToMercure } = require('./utils/sibling-plugin-guard');` and add
   `recordEvent` to the existing destructured import from `./utils/hook-event-log`; immediately
   after `const cwd = input.cwd || process.cwd();` and before `let patterns;`, insert the
   defer check: `if (shouldDeferToMercure(cwd)) { recordEvent({ hook: HOOK, tool, decision:
   'allow', tier: 'defer', pattern_id: 'sibling-plugin-defer', reason: 'blackhole standing down:
   sibling mercure plugin detected, .blackhole/config.json absent — mercure hook is the sole
   validator for this call', detail: command, cwd }); allowSilently(); return; }`. Mirror the same
   insertion point and shape in `validate-file-changes.js` (using `filePath` for `detail` in place
   of `command`). — **AC**: Task 3's full matrix passes green against the real validator scripts
   (not a mocked module); Task 1's baseline suites are unaffected (byte-identical pass/fail
   counts).
6. **Lock the `V-HOOK-02` scope boundary in `hook-event-triage.ts`**: add a regression test to
   `scripts/lib/hook-event-triage.test.ts` asserting that an event file with `tier: 'defer'`
   (and any `pattern_id`) results in `ingested: 0` and zero new ledger rows from `ingestHookEvents`
   — a locking test, not red-green, since `TIER_VCODE`'s existing `if (!mapping) continue;`
   already satisfies it; add one inline comment on the `TIER_VCODE` definition in
   `hook-event-triage.ts` itself noting that `'defer'` is deliberately excluded (binding decision
   `c`) so a future contributor does not add it without re-reading this plan's rationale. —
   **AC**: the new test exists and passes; `git diff` on `hook-event-triage.ts` shows a
   comment-only change, zero logic lines touched.
7. **Update `src/references/hook-schemas.md`**: change the `tier` enum row from `` `block` \|
   `warn` \| `error` `` to `` `block` \| `warn` \| `error` \| `defer` ``, and add a short paragraph
   (near the existing tier-documentation prose) stating that `defer` records blackhole standing
   down for a sibling mercure plugin, is never ingested by `ingestHookEvents`/Triage (cite
   `scripts/lib/hook-event-triage.ts`'s `TIER_VCODE`), and is human-greppable only. — **AC**: the
   doc's `tier` row and new paragraph exist; `rg "defer" src/references/hook-schemas.md` returns
   at least 2 matches (the enum row and the prose paragraph).
8. **Update `src/references/blackhole-vcodes.md`**: add one sentence directly after the
   `V-HOOK-02` table row (or in an adjacent footnote, whichever keeps the table itself unbroken)
   stating explicitly that `V-HOOK-02` does not cover the sibling-plugin-defer event
   (`pattern_id: sibling-plugin-defer`, `tier: defer`) introduced by issue #870 — that event is
   never ingested by Triage and carries no V-code. — **AC**: the sentence exists in the file and
   names both `sibling-plugin-defer` and `V-HOOK-02` so a future reader searching either term
   finds the clarification.
9. **Update `templates/hooks/pretooluse/README.md`**: add a short new section ("Sibling mercure
   defer") describing: what triggers the defer, that the record is human-greppable only (Triage
   never runs in the non-campaign context the defer condition requires — the two are mutually
   exclusive by construction), and the two logged follow-ups (health-based detection; hook-events
   rotation) with placeholders for their issue numbers, filled in once Execution Strategy's final
   stop condition files them. — **AC**: the section exists; a fresh reader of the README alone
   (no other doc) can correctly state that the defer record is not automatically audited.
10. **Bump `package.json`'s `version`**: patch-bump `package.json`'s `version` field (the plain
    version-change discipline `templates/hooks/pretooluse/README.md` § Enforcement already
    documents; no separate semantic-versioning judgment needed here) and run `bun run build` so
    the 5 version-carrying manifests regenerate. — **AC**: `package.json`'s `version` differs from
    this plan's `plan_base_commit`-era value; `bun run build` exits 0; `.claude-plugin/plugin.json`
    reflects the new version.
11. **Verify Integrity**: run the full test suite, lint, and `bun run scripts/plan-quality-gate.ts
    --plan-file .blackhole/plans/issue-870.md --repo-root
    /home/clumineau@e-xpertsolutions.lan/Documents/Git/perso/blackhole`, plus `bun run verify`. —
    **AC**: full suite green, lint clean, `plan-quality-gate.ts`'s three keys all `true`, `bun run
    verify` reports zero BLOCK-severity findings — all four quoted in the completion evidence.
12. **File the two follow-up issues**: file forge issues for (a) health-based (not
    registration-based) sibling detection, and (b) `.blackhole/hook-events/` rotation/cleanup in
    the non-campaign context — both explicitly out of this plan's scope per § Objective — and
    reference both issue numbers in this PR's description. — **AC**: two new issues exist on the
    forge; the PR description for this issue's implementation links both by number.

## Sprint Contract

Definition of done is each task's own `**AC**` above — no task in this plan relies on the blanket
"all tests and linters pass" fallback; every task names a specific, checkable condition. Task 11's
`bun run verify` and `plan-quality-gate.ts` run is the final gate before PR creation; Task 12's two
forge issues are the closing condition for this plan's "never drop findings" obligation
(`blackhole-protocol.md`).

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no schema surface in this diff |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS — no sweep-to-zero AC in this plan |
| `ac_sweep_scope` | PASS — no sweep-to-zero AC in this plan |
| `touch_paths_ssot_gap` | PASS |
| `ac_facts_literal_bump` | PASS — no `facts.ts` literal bump in this plan |

## References

- Design note: `.blackhole/plans/issue-870-design.md` — see especially "Option A-prime" (§2) and
  "## 9. Gate — round 2 verdict (turn 19)" for the owner ruling this plan implements verbatim.
- `documentation/investigations/research-cross-plugin-hook-denial-visibility.md` — confirms hooks
  compose deny-wins with no cross-hook visibility, the reason Option A-prime must be a purely
  local, unilaterally-decidable guard.
- `documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md` (referenced, not amended by
  this plan) — the stale-plugin-cache failure class the Elevation-of-Privilege threat row cites.

---
issue: "#1280"
related_issues: ["#1296"]
supersedes_adr: null
type: plan
summary: "PreToolUse write guards (Write/Edit and Bash) trust single-file writes into the campaign state dir, the main clone's .blackhole/, for campaign-scoped workers through an allow-list of write shapes, keep main-clone protection for everything else, and treat variable-built Bash targets as one consistent unknown tier"
status: current
review_trigger: "on file change"
created: 2026-11-19
last_updated: 2026-11-19
related: [decisions/ADR-045-cwd-derived-worker-write-containment.md, decisions/ADR-047-hook-containment-scoped-to-campaign-workers.md]
---

# Plan: guards trust the campaign state dir (#1280 a+b, #1296 scratchpad leg)

Track: Standard (routes on record: bugfix, `security_review_required`, `needs_design`, `plan_mode: full`, `docs_impact`).
Task type: bugfix. Plan base commit: `243e078c10e0953b8b77dcef6a25f822247a1aaa`.
Pareto: Gain 8 x (11 - Effort 4) = 56 (>= 30, proceed). The plan lives in the PR because the guard blocks `.blackhole/plans` and `.blackhole/staged` until this lands (owner decision 2026-11-19).

## Objective

A campaign-scoped worker whose assigned root is a linked worktree is denied every write to the campaign's own state in the main clone (`<main>/.blackhole/plans/`, `staged/<issue>/`, `queue.json`, `findings-ledger.json`, `.tmp/`), via both the Write/Edit hook (`outside-assigned-worktree`) and the Bash hook (`bash-outside-assigned-worktree`). Trust single-file writes into the resolved state dir in both hooks (the write shapes of the Design revision below), keep every other main-clone path denied, and make Bash write targets built from shell variables behave as one consistent, documented tier.

## Split decision

| Piece | Ships in | Reason |
|-------|----------|--------|
| #1280 (a) state-dir root, Write + Bash | **This PR** | Blocks ADR-021 staging and #1278's dispatch gate; owner direction |
| #1280 (b) variable-target consistency | **This PR** | Falls out of (a): once the literal state-dir write is allowed, literal and variable forms agree. Remaining work is pinning the unknown tier with tests and fixing comments/docs. Same file, same tests |
| #1296 harness-scratchpad leg (Write denied, Bash allowed) | **This PR** if T5's investigation shows it shares the new root helper; otherwise its own PR | Same resolver (`allWorktreeRoots`/`readCwdDerivedAssignedRoot`) |
| #1296 cross-repo leg (session additional working dirs) | **Separate PR, issue #1296 stays open** | Needs a different trust source (harness working directories) that the PreToolUse payload may not carry; unverified, design-sized, widens trust beyond the owner's "state dir only" direction |
| #1280 (c) heredoc-in-quoted-arg `->` false positive | **Separate PR** (file a new issue, link from #1280) | Lexer/heredoc masking in `shell-lexer.js`/`bash-write-target-guard.js`, different failure class (false positive, not trust root), larger regression surface (ADR-040 splitter policy) |

PR body: `Closes #1280` only after (c) is filed as its own issue and #1280's body is updated; `Part of #1296`.

## Design

### Design revision (fix rounds 1-3)
This section supersedes D1-D3, C3, T3 and T4 below wherever they disagree; those rows are amended to match. Three security-review rounds each found the same bypass class: the guard judged a directory while the shell chose the file written (round 1 `cp config.json <state>/`; round 2 a planted symlink plus `cp config.json <state>/staged/`; round 3 a nested symlink inside a recursively copied source, and `rsync --link-dest=<state>`). The shipped rule is therefore not "the state dir is an allowed root" but an allow-list of write shapes (`templates/hooks/pretooluse/utils/state-dir-write-shape.js`, `isTrustedStateWrite`):

1. **Shape 1**: a redirect (`>`, `>>`, `>|`, `&>`, a heredoc to a file) or `tee`/`tee -a` naming a file.
2. **Shape 2**: `cp`, `mv` or `install` with exactly one source that exists as a regular file (lstat: not a symlink, not a directory) to an explicit file destination (not an existing directory, no trailing `/` or `/.`), with only `-f -i -n -p -v`, `install -m <mode>` and `-C` and their exact long names. A `mv` source must itself be a trusted path inside the state dir.

Every trusted path, in both guards, must also: be plain path text with no quote, expansion, glob or glued operator (Bash); have no `..` segment; resolve inside the state root once every symlink is followed (`realpathWithTail`: realpath of the existing part plus the not-yet-existing tail); not be protected (`config.json`, `hook-events/`, `archive/hook-events-*`, matched case-insensitively); not be the state root or `archive/` itself; and have a leaf that is absent or a regular file with one hard link (`isPlainLeaf`). Every other modelled write shape under the state root (directory destinations, `-t`/`-T`, recursive or archive copies, directory or multiple sources, `rsync`, `ln`, `cp -s/-l`, `install -d/-D`, `sed -i`, `dd`, `truncate`) gets origin/main's `bash-outside-assigned-worktree` block. The Write/Edit hook takes an exact file path and shares `isStateDirTrustedPath`, so it applies the same path and leaf rules.

Behaviour changes against the round 1/2 design (stricter than owner decision 16; the protocol only ever writes single files into `.blackhole/` with explicit paths):
- A directory destination (`cp x <state>/plans/`, `cp x <state>/staged/1/`) is denied; name the file.
- A `mv` whose source does not exist when the hook runs is denied, so writing `queue.json.tmp` and renaming it takes two Bash calls.
- A `mv` from the worktree into the state dir is denied; `cp` the file instead.

### Facts (verified at base commit)
- `validate-file-changes.js:132-185`: assigned root `[assignedRoot]` else `allWorktreeRoots(cwd)`; campaign-scoped call outside every root is denied (`outside-assigned-worktree` / `outside-worktree`).
- `bash-write-target-guard.js` `evaluateBashWriteTargets` (end of file): each literal target not `isUnderRoot(resolved, assignedRoot)` is denied `bash-outside-assigned-worktree`; a dynamic target or unresolvable command yields tier `warn` / `bash-write-target-unresolvable`, which is allowed with a recorded event. That asymmetry is #1280 (b): the literal state-dir write is denied, the `$F`/`$B` form passes as `warn`.
- `readCwdDerivedAssignedRoot` (`hook-event-log.js`, ADR-045) narrows to the linked worktree (or its enclosing validated scratchpad root). `mainCloneRoot(cwd)` and `isUnderRoot` (realpath on both sides) exist and are reused.

### Decision Record (V-FIX-01 / V-CHOICE-01)
- **Root cause**: the allowed-root set is built from worktree geometry only (assigned worktree, scratchpad). The campaign's own state store, which the protocol requires workers and the orchestrator to write (`blackhole-state.md` § Paths, ADR-021 D1), lives in the main clone, outside that set. Nothing models "campaign state" as a root, so legitimate protocol writes are indistinguishable from main-clone tampering. Bash variable targets are not the bug; they are the unmodelled-input tier that happened to expose it.
- **Chosen (E1, owner direction)**: derive one state root, `campaignStateRoot(cwd) = realpath(<mainClone>/.blackhole)`, and trust writes inside it in both hooks, narrowed to the write shapes of the Design revision. A single shared helper in `utils/hook-event-log.js` next to `mainCloneRoot` (V-INT-02, V-DRY-01), consumed by `validate-file-changes.js` and `bash-write-target-guard.js`.
- **Harder alternative named (E2)**: a subpath allowlist (`plans/`, `staged/`, `queue.json`, `findings-ledger.json`, `.tmp/`, `pending-decisions.json`, `owner-decisions.json`, ...) per role, so a worker could never touch `config.json` or `hook-events/`. Strongest least-privilege, and the right answer if the dir held secrets. Rejected as primary because it re-couples the guard to `blackhole-state.md` § Paths (every new state file needs a hook change plus a hook version bump to reach installed caches, the ADR-030 problem) and the owner ruled the dir is trusted. We keep **one carve-out** from E2 where trust has an integrity cost: see D2.
- **Rejected (E3)**: expand `$VAR` in Bash targets. A static expander cannot cover indirection, `eval`, `read`, command substitution; a partial expander is a new bypass surface and a large lexer change (V-KISS-01).

### Decisions
- **D1 Trust condition.** The state root exists (and trust can be granted inside it, for the write shapes in the Design revision only) only when all hold: `mainCloneRoot(cwd)` resolves (non-null, no throw); `<main>/.blackhole/config.json` exists (so an unrelated repo with a stray dir gets nothing); the realpath of `<main>/.blackhole` is not too broad (`isTooBroadRoot`, same breadth check as scratchpad, so a `.blackhole` symlinked to `$HOME` or `/tmp` adds no trust); and the call is already campaign-scoped (`isCampaignScoped`, ADR-047: ordinary sessions are untouched). The root is derived from the main clone, never from the worktree, so a worker-created `<worktree>/.blackhole -> /elsewhere` symlink cannot mint trust: it resolves under the worktree root anyway and is judged by `isUnderRoot` realpath as today.
- **D2 Carve-out.** Under the state root, `hook-events/` (and `archive/hook-events-*`) stays denied to campaign workers: the deny record is the audit trail the orchestrator ingests (V-HOOK-01/03, ADR-042); letting a worker delete or forge it defeats the guard that produced it. `config.json` is denied too (owner decisions 15/16, resolving Q1). Names match case-insensitively, and the state root and `archive/` are never a write target themselves.
- **D3 Variable targets (b).** Keep the existing unknown tier (`warn`, `bash-write-target-unresolvable`, recorded, allowed). A variable-built target is never expanded, so it never earns state-dir trust; the literal form passes only in the shapes of the Design revision. Do not expand variables. Correct the stale module comments that say unresolvable targets "pass" so the tier is described as warn-and-record. Never silent-allow is already true (the event is recorded); tests pin it.
- **D4 Scratchpad (#1296 leg).** First reproduce why Write to the harness scratchpad is denied while Bash is allowed (hypothesis: Write uses `readAssignedWorktreeRoot` -> single root, Bash path defers to `allWorktreeRoots` union when `BLACKHOLE_SCRATCHPAD_DIR` is declared). Fix only by making Write consume the same already-validated scratchpad sources; no new trust source.
- **D5 Build output.** Hook changes ship with regenerated build output: `bun run build`, committing every generated tree per `scripts/lib/build/targets.ts`, never hand-edited. V-PLUGIN-01 (version bump when touching `templates/hooks/**`) is **owner-waived for this campaign**; record the waiver in the PR body.

## Threat Model (STRIDE; `security_review_required: true`)

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| **Spoofing**: a worker plants `<worktree>/.blackhole` symlink or `config.json` to be treated as the state dir | High | Root derived from `mainCloneRoot`, not the worktree; requires `<main>/.blackhole/config.json`; breadth check on the realpath (D1). Test T3c | Mitigated |
| **Tampering**: worker rewrites `queue.json`/`config.json` (e.g. `scratchpad_dir`, autonomy flags) to widen its own containment | High | `config.json` denied to workers (D2, owner decisions 15/16); queue/ledger writes remain trusted by owner ruling, single-file shapes only, never through a link (Design revision) | Mitigated (config), Accepted Risk (queue/ledger, owner ruling) |
| **Repudiation**: worker erases its own deny/warn records | High | `hook-events/` and `archive/hook-events-*` stay denied (D2). Test T3d | Mitigated |
| **Information Disclosure**: wider read/write reach exposes state files | Low | Guard governs writes only; state dir holds no secrets by protocol (`.env`/sensitive-filename warn tier unchanged) | Mitigated |
| **Denial of Service**: broken root resolution blocks all writes, or guard crashes | Medium | Resolver failure falls into existing `failClosed` posture (`worktree-root-resolution-failure`); missing `config.json` means no extra root, i.e. today's behaviour | Mitigated |
| **Elevation of Privilege**: state-dir trust becomes trust of the whole main clone (prefix match, `..`, symlink leaf, `.blackhole-evil` sibling) | Critical | `isUnderRoot` realpath + `root + path.sep` prefix (sibling-prefix safe); path-traversal pattern still runs first in `validate-file-changes.js`; main-clone tracked files outside `.blackhole/` stay denied. Tests T2/T3a/T3b | Mitigated |
| **Elevation of Privilege**: the guard judges a directory while the shell writes a file inside it (directory destination, planted or nested link, recursive copy, `rsync`, link creation, a swapped `mv` source) | Critical | Write-shape allow-list (Design revision): only shapes 1-2 earn trust, each naming the exact file written; `realpathWithTail` landing check and `isPlainLeaf`; everything else gets main's block | Mitigated |

## Touch-Paths

- `templates/hooks/pretooluse/utils/hook-event-log.js` (new `campaignStateRoot` helper, exported)
- `templates/hooks/pretooluse/validate-file-changes.js` (trust `isStateDirTrustedPath` targets outside every root)
- `templates/hooks/pretooluse/utils/state-dir-write-shape.js` (new: the Bash write-shape allow-list, `isTrustedStateWrite`)
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js` (allow state root, fix module comments)
- `scripts/hooks-validate-file.test.ts`, `scripts/hooks-bash-write-redirects.test.ts` (new cases; or a new `scripts/hooks-state-dir-trust.test.ts` if the existing files near the content-gate ceiling); reuse `scripts/lib/test-fixtures.ts` (`withLinkedWorktree`, `writeCampaignConfig`, `runPreToolUseHook`), edit it only if a fixture is missing
- `templates/hooks/pretooluse/README.md`, `src/references/blackhole-state.md` (§ Paths: state dir is a guard-trusted root; hook-events carve-out), `src/references/hook-schemas.md` (pattern semantics, only if wording changes)
- `documentation/plans/plan-guard-trusts-campaign-state-dir.md` (this file)
- plus all generated dist trees per `scripts/lib/build/targets.ts` (regenerated by `bun run build`, never hand-edited)

Not touched: `shell-lexer.js`, heredoc masking (#1280 c), cross-repo working-directory roots (#1296), `documentation/INDEX.md` (the implementer regenerates it via the carry step / `scripts/generate-doc-index.ts`).

## Codebase Conventions
- CommonJS `'use strict'` hook modules; containment always via `isUnderRoot` (realpath both sides), never string prefix.
- Reuse `mainCloneRoot`, `isTooBroadRoot`/`isAcceptableScratchpadDir`, `isCampaignScoped`; no second breadth check or main-clone resolver (V-INT-02).
- Hook tests spawn the real script via `runPreToolUseHook` against `withTempGitRepo`/`withLinkedWorktree`; assert `permissionDecision` plus `readHookEvents`.
- Test-first (V-TEST-01/02); comments follow Comment Discipline (rationale once at the helper, no issue numbers in source comments).
- Windows-style tmp symlinks: build fixtures with `fs.realpathSync` as existing tests do.

## Task Breakdown (test first; each task: red, then green)

**T1. Failing tests (red).** Add cases to the hook tests, run only the two hook specs (through `with-test-lock`; CI runs the full suite).
- **AC**: each case below fails on base `243e078c` for the stated reason and the "must be denied" cases already pass; recorded in the PR.

Cases (campaign-scoped `agent_type: planner`/`implementer`, cwd = linked worktree, `.blackhole/config.json` present in main):
| # | Tool | Target | Expected |
|---|------|--------|----------|
| C1 | Write | `<main>/.blackhole/plans/issue-1.md` | allow |
| C2 | Write | `<main>/.blackhole/staged/1/manifest.json` | allow |
| C3 | Bash | `cat > <main>/.blackhole/queue.json.tmp` (allow), then in a separate call `mv <main>/.blackhole/queue.json.tmp <main>/.blackhole/queue.json` (allow); the chained one-liner `cat > ….tmp && mv ….tmp queue.json` is **deny** (the mv source does not exist at hook time) | allow / allow / deny |
| C4 | Bash | same via `F=<main>/.blackhole/queue.json; jq . x > $F.tmp && mv $F.tmp $F` | allow with `warn` event `bash-write-target-unresolvable` (recorded, not silent) |
| D1 | Write | `<main>/README.md` (tracked, outside `.blackhole/`) | **deny** `outside-assigned-worktree` |
| D2 | Bash | `echo x > <main>/README.md` | **deny** `bash-outside-assigned-worktree` |
| D3 | Bash | `$B=<main>/README.md; echo x > $B` | warn (unknown tier), never silent-allow |
| D4 | Write | `<main>/.blackhole-evil/x` and `<main>/.blackhole/../README.md` | **deny** (sibling prefix, traversal) |
| D5 | Write | `<main>/.blackhole/hook-events/e.json`, `config.json`, any case; Bash redirect into them (`rm` is unmodelled, #1347) | **deny** (carve-out D2) |
| D6 | Write | `<worktree>/.blackhole -> /etc` symlink then write through it | **deny** |
| D7 | Write | no `<main>/.blackhole/config.json` (stray dir) | **deny** (no trust without config) |
| D8 | Write | `.blackhole` symlinked to `$HOME` or `/tmp` | **deny** (too broad) |
| D9 | Write | interactive session (no `agent_type`, cwd main) writing `<main>/README.md` | allow (ADR-047 unchanged) |
| S1 | Write | harness scratchpad path (`BLACKHOLE_SCRATCHPAD_DIR` valid) | allow (if D4 reproduces) |

**T2. Shared helper.** Add `campaignStateRoot(cwd)` to `hook-event-log.js`: returns realpath of `<mainClone>/.blackhole` under the D1 conditions, else `null`; exports `isHookEventsPath(path, root)` for the D2 carve-out. 
- **AC**: C-cases and D5/D6/D7/D8 resolve correctly in unit-level checks; no new duplicate of `mainCloneRoot` or breadth logic (`grep` shows a single definition each).

**T3. Write/Edit hook.** `validate-file-changes.js`: a path outside every root is allowed only when `isStateDirTrustedPath(path, stateRoot)` holds (path, protected-name and leaf rules of the Design revision); the state root is not added to the allowed roots.
- **AC**: C1, C2, D1, D4, D5, D6, D7, D8, D9 pass; deny reasons still name the assigned root; the sibling-prefix case D4 passes only because `isUnderRoot` uses `root + path.sep`.

**T4. Bash hook.** `bash-write-target-guard.js`: a literal target under the state root is not a violation only when `isTrustedStateWrite` accepts it (shape 1 or 2 of the Design revision, plus `isStateDirTrustedPath`); every other shape keeps the outside-assigned-worktree block. Update the header comments to describe the unresolvable tier as warn-and-record.
- **AC**: C3, C4, D2, D3, D5 pass; all existing `scripts/hooks-bash-write-*.test.ts` and `hooks-validate-bash.test.ts` still pass (run the focused files, CI runs the rest); comment diff contains no issue numbers.

**T5. Scratchpad leg (D4).** Reproduce S1 on base; if it shares the cause, fix by reusing the existing validated scratchpad sources in the Write path; if not, stop and file it as its own issue/PR.
- **AC**: S1 green with the fix, or a filed issue number recorded in the PR body and the split table above updated.

**T6. Docs.** Update `src/references/blackhole-state.md` § Paths (state dir is a guard-trusted root for campaign-scoped callers; `hook-events/` carve-out; main-clone protection unchanged) and `templates/hooks/pretooluse/README.md`.
- **AC**: `bun run verify` doc and reference checks pass for the changed files; the carve-out and trust conditions appear exactly once each (V-DRY-01), other docs cite by section.

**T7. Build and verify.** `bun run build`; commit regenerated trees; confirm no stale generated output.
- **AC**: a second `bun run build` produces an empty `git status`; CI `bun run verify` and the hook specs are green on the pushed head (CI run is the evidence; no full suite locally).

## Critical Files
- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js`

## Execution Strategy & Stop Conditions
- If `campaignStateRoot` cannot be made to return `null` for case D7 or D8, stop and revert to the base behaviour; do not ship an unconditional `.blackhole` allow.
- If any D-case (main-clone tracked file outside `.blackhole/`) becomes allowed, abort the change and revert the hook edit.
- If a Bash fixture needs a variable expander to pass C4, stop: D3 forbids expansion; keep the warn tier.
- If T5 shows the Write scratchpad denial has a cause unrelated to the shared resolver, abort that leg and file a separate issue.
- If `bun run build` leaves a diff on the second run, stop and fix the generator input, never hand-edit output.

## Quality Gate Results
- touch_paths_declared: PASS
- schema_baseline: PASS (no schema or public API change; hook pattern ids unchanged)
- ac_mapping: PASS (every task carries an AC)
- critical_files_exist: PASS (all three pre-existing)
- mitigation_concrete: PASS
- ADVISORY: `touch_paths_ssot_gap`: new check module not added; if a registry row (e.g. content-gate budgets) is touched, add its companion path.

## Documentation Impact
`src/references/blackhole-state.md` § Paths, `templates/hooks/pretooluse/README.md`; consider a short Post-acceptance note on ADR-045 (state dir is a second assigned-root source) rather than a new ADR. `documentation/INDEX.md` is regenerated by the implementer.

## Open Questions
- **Q1** (resolved by owner decisions 15/16): `config.json` is denied to workers.
- **Q2**: Is the harness's additional-working-directory list present in the PreToolUse payload? Needed before the #1296 cross-repo PR.
- **Q3**: Waiver of V-PLUGIN-01 (owner-granted) must be restated in the PR body.

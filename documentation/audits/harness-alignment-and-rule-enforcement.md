---
type: analysis
summary: "Audit of blackhole against current Claude Code, Cursor and Grok features, and of V-code enforcement coverage, with ranked gaps"
status: current
review_trigger: "on release"
created: 2026-10-14
last_updated: 2026-10-14
related:
  - .claude/rules/blackhole-vcodes.md
  - documentation/architecture.md
---

# Harness Alignment and Rule-Enforcement Audit

Scope: issue #1024. Blackhole v0.23.2 at `origin/main` (54cf74eb), audited 2026-10-14. Read-only: no source behavior changes.
Priority = Gain × (11 − Effort), both 1–10. V-PARETO-03 files an issue only at Priority ≥ 30.
Gain and Effort are estimates, not measurements.

## Executive Summary

- **Wiring is sound.** All 122 V-code rows cite a site that exists, and every `scripts/checks/*.check.ts` is discovered and run by `scripts/verify.ts:10-23`.
- **Several BLOCK rules cannot fail on bad input.** V-SEC-08 has no validator, V-BRANCH-01 is warn-tier in the hook, V-SEC-11 is prompt-only, V-PARETO-03 and V-TEST-09/10 only check that prose exists.
- **The Cursor output likely does not enforce read-only roles.** `.cursor/agents/*.md` use Claude-only frontmatter (`disallowedTools`, `permissionMode`).
- **The Claude plugin wires two hook events.** There is no `SubagentStop`, so worker-return validation (V-BRIEF-01) is not enforced on Claude.
- **Grok Build already reads Claude/Cursor trees.** Blackhole has no explicit Grok support and no check that its guards load there.
- **Grok Bot** is a cloud-hosted teammate product with no documented plugin, hook or rules surface. It gets no dedicated work.

Verification: gaps G1, G2, G3 and G5 were re-checked directly in the worktree (see Evidence), and a read-only reviewer confirmed G6, G9 and the other repo-internal citations. External-doc claims were not independently re-fetched.

## Ranked Gaps

| ID | Gap | Gain | Effort | Pri | Size |
|----|-----|------|--------|-----|------|
| G1 | Cursor agents carry Claude-only fields; set `readonly: true` for read-only roles | 8 | 2 | 72 | s |
| G2 | No `SubagentStop` hook in the Claude plugin (V-BRIEF-01 unenforced on Claude) | 8 | 3 | 64 | s |
| G3 | V-SEC-08 BLOCK has no validator (`attack_scenario` appears nowhere in `scripts/`) | 8 | 3 | 64 | xs |
| G4 | Grok Build hooks fail open; `${CLAUDE_PLUGIN_ROOT}` expansion unverified, so guards may be silently off | 8 | 3 | 64 | s |
| G5 | V-BRANCH-01/02: force push is warn-tier only (`bash-patterns.json` `warnPatterns`) | 8 | 4 | 56 | s |
| G10 | No first-class Cursor plugin manifest (`.cursor-plugin/`); install is a git submodule | 8 | 4 | 56 | m |
| G6 | `Delete` in `disallowedTools` is a no-op; `NotebookEdit` not denied and not matched by the file guard | 6 | 2 | 54 | xs |
| G7 | Agents set no `model` or `maxTurns`; model tiers are prose only | 6 | 2 | 54 | xs |
| G8 | No Grok campaign-prompt entry (`/goal --budget` unused) and no hook-trust doctor check | 6 | 2 | 54 | xs |
| G9 | V-GIT-01 is a regex job done in prose (ADR-003) | 6 | 2 | 54 | xs |
| G11 | Grok Build install row missing from README | 5 | 1 | 50 | xs |
| G12 | V-TEST-10 test checks gate prose, not skip/removed-assertion detection | 7 | 4 | 49 | s |
| G13 | `UNTRUSTED-FORGE-DATA` fence spoofable and absent from planner, investigator, hunter, reviewer, coordinator | 8 | 5 | 48 | m |
| G14 | V-PLUGIN-01 is a pure diff function done in prose | 6 | 3 | 48 | xs |
| G15 | Cursor hooks not shipped in-band; containment guards are Claude-only | 8 | 5 | 48 | m |
| G16 | Grok hook payload shape vs. validators' `tool_name`/`tool_input` unverified | 6 | 3 | 48 | s |
| G17 | Cursor model slugs likely stale (`model-routing.md:117-119`) | 5 | 2 | 45 | xs |
| G18 | V-SEC-11 staging gate is prose; the Write/Edit hook only warns on sensitive files | 7 | 5 | 42 | s |
| G19 | V-PARETO-03 check asserts docs, not the Priority computation | 6 | 4 | 42 | s |
| G20 | Dead frontmatter `permissionMode`/`autoCompactWindow` on plugin agents | 4 | 1 | 40 | xs |
| G21 | Cursor `.cursor/cli.json` deny list not shipped | 5 | 3 | 40 | xs |
| G22 | `PreCompact` / `PermissionDenied` hooks unused | 5 | 3 | 40 | s |
| G23 | `vcode-citation.check.ts` accepts a code anywhere in the cited file | 4 | 2 | 36 | xs |
| G24 | No sandbox/permissions defense-in-depth recipe; plugins cannot ship them | 6 | 5 | 36 | m |
| G27 | `effort` claim "`agent()` cannot set effort" may be stale | 4 | 2 | 36 | xs |
| G25 | V-UI-01 `ui_gate` check is prose only | 5 | 4 | 35 | s |
| G26 | Grok subagent types (`explore`, `.grok/agents/`) unmapped | 5 | 4 | 35 | m |
| G28 | V-TEST-09 coverage-delta script missing (marker tests only) | 6 | 6 | 30 | m |
| G29 | No `workflows/` shipped in the Claude plugin | 5 | 5 | 30 | m |

Deferred (Priority < 30, not filed): hook `if`/`args` exec form (27), Grok model ladder (27), vacuous `ok:true` when runtime state is absent (24), `plugin.json` cosmetic fields (20), `/goal` primary-source confirmation (20), Grok Bot install surface (15), V-DOC-GOV-02/03 site naming and V-DOC-04 advisory-in-practice.

## Claude Code

Sources (accessed 2026-10-14): https://code.claude.com/docs/en/plugins-reference, /sub-agents, /hooks, /skills, /workflows, /tools-reference, /plugins/marketplace-reference.

- **G2.** The hooks page lists `SubagentStop` as an event. `plugins/blackhole-claude/hooks/hooks.json` declares only `PreToolUse` (Bash, Write|Edit) and `SessionStart`. The validator exists only as optional Cursor fragments, `templates/hooks/subagent-stop-validate.json:5`.
- **G6.** Read-only roles deny `[Write, Edit, Delete]` (`plugins/blackhole-claude/agents/reviewer.md:6`). There is no `Delete` tool and `NotebookEdit` is a write tool. The file guard matches `Write|Edit` only (`hooks.json`).
- **G7, G20.** No agent sets `model` or `maxTurns`. All set `permissionMode: default`, and some `autoCompactWindow: 100000`. Plugin subagents ignore `permissionMode` per the sub-agents page; `autoCompactWindow` is not in the documented subagent frontmatter table.
- **G22, G24, G29.** Hook events `PreCompact`, `PermissionDenied` and plugin `workflows/` exist but are unused. Plugins cannot ship `sandbox` or `permissions` settings.
- **G27.** `src/references/model-routing.md:135,208` asserts `agent()` cannot set effort. The sub-agents page documents a per-invocation `effort` parameter on the Agent tool since v2.1.292. Whether `agent()` accepts it is UNVERIFIED.
- **No gap:** `onFailure: "block"` is current and used; SKILL.md length and description limits hold; CI already runs `claude plugin validate --strict` (`.github/workflows/verify.yml:101-102`).

## Cursor

Sources (accessed 2026-10-14): https://cursor.com/docs/plugins, /docs/reference/plugins, /docs/subagents, /docs/hooks, /docs/context/rules, /docs/models, /docs/cli/reference/permissions.

- **G1.** Documented subagent frontmatter is `name`, `description`, `model`, `readonly`, `is_background`. `.cursor/agents/reviewer.md:4-6` uses `permissionMode`, `effort`, `disallowedTools`, so read-only roles are probably unenforced there.
- **G10.** The distribution unit is `.cursor-plugin/plugin.json`. The repo has none. `.cursor/settings.json:6` enables a plugin named `blackhole/blackhole` whose definition is not in this repo (resolution UNVERIFIED).
- **G15, G21.** No `.cursor/hooks.json` and no `.cursor/cli.json`. Exit code 2 is portable, but the deny JSON is Claude-shaped (`templates/hooks/pretooluse/utils/hook-event-log.js:534-552`) and Cursor's payload shape is UNVERIFIED.
- **G17.** Slugs such as `grok-4.5-fast-xhigh` and `claude-opus-4-8-thinking-high` (`model-routing.md:117-119`) are not confirmed by the models page.
- **No gap:** rule frontmatter (`description`, `globs`, `alwaysApply`) matches; the largest rule file is 413 lines; root `AGENTS.md` is read natively.

## Grok

### Grok Build

Sources (accessed 2026-10-14): https://docs.x.ai/build/overview, /build/features/skills-plugins-marketplaces, /hooks, /subagents, /project-rules, /build/modes-and-commands, https://github.com/xai-org/grok-build.

Grok Build reads Claude marketplaces, plugins, skills, agents, hooks and instruction files natively. Blackhole's committed trees are therefore partly live there without explicit support. The only Grok mentions in the repo are Cursor model slugs (`model-routing.md:117,125`, `clarify-gates.md:15`).

- **G4.** Hooks fail open on timeout, crash or malformed output; only an explicit deny blocks. Plugin hooks get `GROK_PLUGIN_ROOT`, and `${CLAUDE_PLUGIN_ROOT}` expansion is UNVERIFIED. Guard commands use it (`hooks.json`).
- **G8.** Project hooks need `/hooks-trust` or `--trust` before they load. `scripts/doctor.ts:41` and `scripts/install-verify.ts:26` check Cursor only. `/goal <objective> --budget <tokens>` is native but absent from `src/references/campaign-prompt.md:6-16`.
- **G11, G16, G26.** No install row (`README.md:112-133`). Hook payload field names (`hookEventName`, `toolName`, `toolInput`) differ from the validators' `tool_name`/`tool_input` (`validate-file-changes.js:51-52`). Subagent schema compatibility is UNVERIFIED.

### Grok Bot

https://docs.x.ai/grok-bot/overview and /security describe a cloud-hosted teammate product run in Cursor's cloud and signed in with Cursor accounts. No hook, rules or plugin surface is documented. A claim that Bots hand coding tasks to Cursor appears only in a secondary source (teslanorth.com, 2026-10-01) and is UNVERIFIED. If true, the Cursor fixes (G1, G15, G21) are what govern blackhole there.

## Rule Enforcement

Legend: Y = script/hook can exit non-zero; M = marker-only or partial; N = agent-prompt judgment; A = always `ok:true`.

- **Wiring:** `verify.ts:10-23` discovers every check and throws if a module lacks `runChecks()`. Each check has a paired test. `vcode-citation.check.ts` validates cited files (V-CITE-01/02/03) and `audit-modules.check.ts` (V-AUDIT-01) gives each reviewer-sited code one owning module.
- **Mechanical with red-case tests:** V-ADA-08, V-ADR-01..06, V-BLASTRADIUS-01, V-BRIEF-02, V-CONFIG-02, V-CTRLCHAR-01, V-CWDPIN-01, V-DOCHEALTH-01/02/04, V-GATE-02, V-INCLUDE-01/02, V-LEDGER-01, V-PROSE-01, V-SHAPE-01, V-TREE-01, V-ARGV-01, V-AUDIT-01. `verify.audit-modules.test.ts:82,100` confirms an empty or missing registry fails.
- **Always-advisory by design (A):** V-DOCHEALTH-03, V-WATCH-01, V-DEFER-01, V-MPARITY-01/02, V-ADR-08. `verify.vcode-parity.test.ts:96,104` assert `ok:true` on a real mismatch.
- **Marker-only or warn-only (M):** V-SEC-11 (hook warns, staging gate is prose), V-TEST-09 (`verify.coverage-regression.test.ts:55-88`), V-TEST-10 (`verify.test-integrity.test.ts:54-74`), V-PARETO-03 (`pareto-filing-gate.check.ts:6-8,44-80`), V-GATE-01. These pass if the gate prose exists; they do not show the control rejects bad input (V-UNFALSIFIABLE-01).
- **Judgment-only BLOCK (N):** V-SOLID-01/02/03/05, V-DRY-01, V-PAT-01/02/03, V-KISS-01, V-YAGNI-01, V-INT-02, V-FIX-01, V-RULE-01, V-API-01, V-THREAT-01/02, V-UI-01, V-PERF-01, V-BRANCH-01/02, V-WORKTREE-01, V-GIT-01, V-GITFIX-01, V-SEC-01/02/03/04/06/08, V-TEST-11, V-PLUGIN-01, V-UNFALSIFIABLE-01, V-MERGE-01.
- **Not inspected:** assertion bodies for the V-TEST-01/02 pairing check and V-GATE-01; relationship of several `N/M` rows to their partial scripts (grep for the code string only).

### Security coverage

- **Hooks** (`templates/hooks/pretooluse/`): `hooks.json` matches only `Bash` and `Write|Edit`, `onFailure: block`. Block-tier Bash patterns cover destructive root/home removal, device writes, curl-pipe-shell and fork bombs. Force push, `reset --hard`, `clean -f`, `npm publish`, SQL drop/truncate and `secret-literal` are warn-tier (`bash-patterns.json`, `warnPatterns`). Dynamic guards: `git-main-clone-guard.js`, `worktree-removal-guard.js`, `bash-write-target-guard.js`, `sibling-plugin-guard.js`.
- **G5.** V-BRANCH-01 is CRITICAL, yet `hooks-validate-bash.test.ts:1701-1702` expects `warn` for force push. A force push to `main` outside a PR is seen only by a hook that allows it.
- **G18.** `templates/hooks/pretooluse/validate-file-changes.js:197-206` warns on `.env`/`*.pem`/`id_rsa` writes; `git add` is intentionally not intercepted (`templates/hooks/pretooluse/utils/git-main-clone-guard.js:80-84`). No script blocks sensitive-file staging; code comments cite V-SEC-11 (`validate-file-changes.js:216`) and one test names the gate (`scripts/hooks-validate-file.test.ts:1090`).
- **G13.** The canonical rule is `src/references/forge-sync.md:320-329`: a plain-text fence `--- UNTRUSTED-FORGE-DATA (issue #N) ---`. An issue body containing the closing line escapes it. `planner.md:15` reads the issue body directly, and `planner.md`, `investigator.md`, `hunter.md`, `reviewer.md`, `coordinator.md`, `phase-plan.md`, `phase-review.md` and `review-core.md` contain no UNTRUSTED mention (the reviewer audit modules carry a quoting note but no issue-body fence). No script enforces the wrapper.
- **G3.** `src/references/review-core.md:138-141` calls V-SEC-08 a "documented manual gate". A reviewer BLOCK security finding with no exploit path would proceed on manual confirmation alone.

## Evidence (re-verified in the worktree)

| Claim | Check |
|-------|-------|
| G1 | `.cursor/agents/reviewer.md` frontmatter has `permissionMode`, `effort`, `disallowedTools`; no `readonly` |
| G2 | `plugins/blackhole-claude/hooks/hooks.json` has no `SubagentStop` |
| G3 | `grep -rn attack_scenario scripts` returns nothing |
| G5 | `git-push-force` and `git-push-force-refspec` sit under `warnPatterns` in `bash-patterns.json` |

## Unverified Items

Settle these before implementing the dependent gaps:

1. G4: does Grok expand `${CLAUDE_PLUGIN_ROOT}`? Next action: run `grok inspect` in this repo.
2. G16: what payload do Claude-format hook files receive on Grok?
3. G15: Cursor hook payload shape.
4. G27: does `agent()` accept `effort`?
5. G10: what does the enabled `blackhole/blackhole` Cursor plugin resolve to?
6. G26: does Grok Build honor Claude-format agent frontmatter, and what is its `.grok/agents` schema?

## Follow-up

Issues for every gap with Priority ≥ 30 are filed after owner approval of the list, each with a size label. Gaps G4, G10, G15, G16, G26 and G27 depend on the unverified items above.

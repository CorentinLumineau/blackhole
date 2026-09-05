---
type: analysis
summary: "x-analyze full audit of blackhole's executable code: coverage gaps, SOLID/DRY findings in the hook utils and scripts, and the status dashboard's information hierarchy"
skill: x-analyze
mode: all
status: draft
review_trigger: "on release"
created: 2026-09-05
last_updated: 2026-09-05
target: "blackhole (codebase root) — scripts/, templates/hooks/, status dashboard"
related:
  - documentation/audits/analysis-plugin-synergy-code-quality.md
  - documentation/architecture/retrospective-blackhole.md
---

# Full Audit Report — blackhole

**Date**: 2026-09-05
**Scope**: `scripts/` (lib, checks, entrypoints), `templates/hooks/`, the `bun run status` dashboard. Agent/reference Markdown in `src/` was covered structurally by `bun run verify`, not re-audited by hand.
**Analyzer**: x-analyze (all modes), session class `cloud`

## Mode Score Summary

| Mode | Score / Metric | Rating | Top Issue |
|------|----------------|--------|-----------|
| Coverage | 83.5% lines / 83.1% funcs (2,000 pass, 1 fail, 1 skip) | Good | `validate-worker-json.ts` at 5% lines guards V-BRIEF-01 and is effectively untested as a CLI |
| Best Practices | SOLID 77% / Quality 74% | Fair | DRY 58%: five copies of the quoted-span skip loop across the security-gate hook utils |
| UX | IA 58% | Needs improvement | Dashboard has no health verdict, all 9 sections expanded, forge failure rendered as `0 open PRs` |

**Gate status (observed, not claimed)**: `bun run verify` 89/89 checks PASS with advisories (20 docs missing lifecycle frontmatter, 11 docs over the 400-line ceiling, INDEX drift on 17 rows, V-TREE-01 README missing for `claude-marketplace` and `codex`). `bun test`: 2,000 pass, 1 skip, **1 fail** — see Coverage.

## Mode: Coverage

Runner: bun. Command run: `bun test --coverage` at repo root.

| Metric | Value | Target |
|--------|-------|--------|
| Lines | 83.52% | 80% (P2 public API ≥ 90%) |
| Functions | 83.13% | — |
| Tests | 2,000 pass / 1 fail / 1 skip across 118 files, 4,802 `expect()` calls | 0 fail |

**The one failure is environmental, not a defect**: `scripts/campaign-resume-signal.test.ts:325` ("top-level catch exits 0") forces a write failure with `chmod 0o555` on a temp dir. This container runs as uid 0, where mode bits are not enforced, so the write succeeds and the fail-open path never triggers. The test should skip (or use an unwritable path such as a file-as-directory) when `process.getuid() === 0`; otherwise it fails on every root CI runner.

Priority gaps (Pareto):

| Priority | File | Lines % | Why it matters | Suggested test |
|----------|------|---------|----------------|----------------|
| P1 | `scripts/validate-worker-json.ts` | 5.2 | The V-BRIEF-01 gate every worker return must pass; only the lib under it is tested | CLI test: pipe each role fixture through `--hook` and assert exit code + stderr |
| P1 | `scripts/lib/state-write-guard.ts` | 48.4 | Data-loss guard for `queue.json` / ledger (issue #489); lines 88-136 (the CLI main + shrink path) uncovered | zero-byte, malformed, shrink-without-flag, shrink-to-zero-with-flag cases via the CLI |
| P2 | `scripts/lib/forge-adapter/{gitea,gitlab,github}.ts` | 32 / 28 / 47 | Adapter interface (ADR-027) — Gitea/GitLab PR, label and check paths untested; `gitlab.ts:201-212` returns a single synthetic "pipeline" check where the others return per-check rows | table-driven test over the three adapters with a fake CLI runner |
| P2 | `scripts/lib/forge-adapter/{tea-cli,glab-cli}.ts`, `scripts/lib/forge-doctor.ts` | 14 / 14 / 7 | `bun run doctor` is the documented way to verify forge auth | one test per CLI wrapper |
| P2 | `scripts/lib/build/targets.ts` | 18 | Generates the 5 version-carrying manifests and all dist trees | golden-tree test (the `tree-shape` test covers shape, not content) |
| P3 | `scripts/triage-deferred-findings.ts` (56%), `scripts/plan-quality-gate.ts` (50%), `scripts/lib/campaign-status/state.ts` (15%) | — | Entry-point mains untested | CLI tests |
| P3 | No test references at all: `scripts/lib/forge-doctor.ts`, `scripts/lib/plan-touch-path-ssot-pairs.ts`, `scripts/checks/forge-adapter-routing.check.ts`, `scripts/checks/reformulation-surface.check.ts` | — | Two of these are `verify` checks that can never be seen failing (V-UNFALSIFIABLE-01 by the repo's own standard) | red-then-green fixture test |

Assertion quality is good: 3,484 `expect(` calls with only 20 `toBeDefined()` / `toBeTruthy()`. Pyramid is unit-heavy with a healthy layer of CLI-spawn tests; no end-to-end campaign run is exercised (consistent with the open T3 verification noted in `analysis-blackhole-mercure-synergy.md`).

## Mode: Best Practices

| Principle | Score | Rating |
|-----------|-------|--------|
| S | 68 | Fair |
| O | 80 | Good |
| L | 85 | Good |
| I | 82 | Good |
| D | 72 | Fair |
| DRY | 58 | Needs improvement |
| KISS | 70 | Fair |
| YAGNI | 78 | Good |

`th` = `templates/hooks/pretooluse/utils`. Every line cited was read.

| # | V-code | Severity | file:line | Description | Effort |
|---|--------|----------|-----------|-------------|--------|
| 1 | V-DRY-01 | HIGH | `th/bash-write-target-guard.js:98-108` vs `:131-141`; `th/bash-context.js:90-98,262-270,397-405` | Identical 11-line quoted-span skip loop, five copies across the security-gate utils | M |
| 2 | V-DRY-01 | HIGH | `th/worktree-removal-guard.js:143-178,258-284`; `th/bash-write-target-guard.js:124-167` | Three separate shell clause splitters, each re-implementing redirect-aware `&` handling | M |
| 3 | V-PAT-03 | MEDIUM | `th/hook-event-log.js:215-217` | `allWorktreeRoots` maps any error to `null`, which callers treat as fail-open ("no git context") | S |
| 4 | V-PAT-03 | MEDIUM | `scripts/campaign-resume-signal.ts:149-151,189-191,268-270` | Three swallowed catches produce `action: 'none'`; a corrupt queue drops the resume doorbell with no log | S |
| 5 | V-DRY-02 / V-INT-02 | MEDIUM | `scripts/checks/{playbook,hooks,config-registration,deferred-reconciliation,ledger-schema,queue-coherence}.check.ts`, `scripts/triage-deferred-findings.ts:182`, `scripts/lib/hook-event-triage.ts:109`, `scripts/stack-repair.ts:169` | Bare `JSON.parse(fs.readFileSync(...))` bypassing `scripts/lib/fs.ts:53` `readJsonFile`, which declares itself the one shared helper | S |
| 6 | V-DRY-02 | MEDIUM | `scripts/review-aggregate.ts:330`, `design-aggregate.ts:355`, `campaign-resume-signal.ts:363`, `stack-repair.ts:186`, `lib/companion-file-sync.ts:262` (+9) | 14 hand-rolled `--flag value` argv parsers | M |
| 7 | V-DRY-04 | MEDIUM | `scripts/lib/forge-adapter/gitea.ts:88-104,186-196` vs `gitlab.ts:78-94,173-190` vs `github.ts:93-106` | `authStatus` and `labelAdd`/`labelRemove` copy-pasted with CLI-name renames | M |
| 8 | V-SOLID-01 | MEDIUM | `th/hook-event-log.js:44-360` | One module owns redaction, git-root resolution, scratchpad policy, worktree allow-list, stdin parse, persistence and harness emit | M |
| 9 | V-SOLID-01 | MEDIUM | `th/worktree-removal-guard.js:100-642` | Shell tokenizer, git probes and refusal-prose builder in one 656-line file | M |
| 10 | V-KISS-01 | MEDIUM | `th/bash-context.js:361-436` | `computeMaskedSpans` ≈30 branches (comment/quote/heredoc/word state machine) | M |
| 11 | V-KISS-01 | MEDIUM | `scripts/design-aggregate.ts:148-209` | `validateInput` ≈27 branches, 3-deep nested loops at 198-206 | S |
| 12 | V-DRY-02 | MEDIUM | `scripts/lib/carry-staged-artifacts.ts:311-318` vs `:329-336` | Identical mkdir/write/catch/skip block twice inside `carryManifest` | S |
| 13 | V-DRY-02 | LOW | `scripts/lib/carry-staged-artifacts.ts:208-229` vs `th/hook-event-log.js:95-115` | `resolveExistingAncestor` + `isUnderRoot` duplicated (documented CJS/ESM boundary) | S |
| 14 | V-DRY-02 | LOW | `scripts/design-aggregate.ts:319-323` vs `scripts/checks/adr-supersession.check.ts:70-73` | `findAdrFileByNumber` duplicated; comment admits a third copy in `links.check.ts` | S |
| 15 | V-PAT-03 | LOW | `scripts/lib/forge-adapter/gitea.ts:216-218`, `gitlab.ts:213-215` | `prChecks` catch → `[]`: CLI failure indistinguishable from "no checks" | S |
| 16 | V-SOLID-02 | LOW | `scripts/lib/worker-json/validate.ts:12-27` | Role `switch` + 6 imports edited per new role; a `Record<Role, Validator>` closes it | S |
| 17 | V-YAGNI-03 | LOW | `scripts/campaign-resume-signal.ts:106,144,183,224`; `review-aggregate.ts:242`; `doctor.ts`; `triage-deferred-findings.ts`; `checks/forge-adapter-routing.check.ts`; `checks/doc-health.check.ts` | ~15 exported functions with zero references in `scripts/`, `templates/`, `src/` or tests | S |
| 18 | V-DRY-02 | LOW | `scripts/review-aggregate.ts:263-272` | `sortFindings` re-derives the gain/effort guard from `buildParetoCandidates:244-253` | S |
| 19 | V-KISS-03 | LOW | `scripts/review-aggregate.ts:366-368` | `isFindingArray` wraps `Array.isArray` | S |
| 20 | V-DOCFACT-01 | LOW | `documentation/audits/mercure-parity-matrix.md` row PM-090 | Marked `gap` (Comment Discipline Audit) but `blackhole-vcodes.md` already carries V-DOC-05..07 with `reviewer.md` §26 as enforcement site | S |

Also: `lib/companion-file-sync.ts:286,303` and `lib/state-write-guard.ts:141` embed `process.exit` CLI mains inside `lib/`, blurring the library/entrypoint split the rest of `scripts/` observes.

## Mode: UX

No web UI surfaces in scope. Surfaces audited: `bun run status` dashboard (`scripts/lib/campaign-status/`), `src/references/coordinator-dashboard.md`.

| # | V-code | Severity | file:line | Description | Effort |
|---|--------|----------|-----------|-------------|--------|
| 1 | V-UX-01d / V-UX-05 | MEDIUM | `scripts/lib/campaign-status/dashboard.ts:200-216` | Header leads with Scope/Turn/timestamp; no single health verdict; `N done` shown without a total | S |
| 2 | V-UX-01c | MEDIUM | `dashboard.ts:219-227` (+ `:59-83`) | All 9 sections expanded every turn; Routing and Waves uncapped (only Ledger caps at 10); active issues repeat in Ready, Routing and Waves — ~200 lines at 98 issues; `coordinator-dashboard.md:37` forbids collapsing | M |
| 3 | V-UX-05 | MEDIUM | `scripts/lib/campaign-status/forge.ts:26-28` | `gh pr list` failure silently reports `0 open PRs` with `ok: true` — absent data rendered as a real zero | S |
| 4 | Error/empty state | MEDIUM | `scripts/campaign-status.ts:54-55`, `lib/campaign-status/state.ts:18-19` | Missing `queue.json` throws uncaught → stack trace instead of "no campaign initialised at <dir>" | S |
| 5 | V-UX-05 | MEDIUM | `scripts/lib/campaign-status/queue.ts:61-73` | `conf split:0.8 design:0.6 …` — bare numbers with no scale shown | S |
| 6 | V-UX-01e | MEDIUM | `src/references/coordinator-dashboard.md:53-58` | Documents a **Hunt** section that `formatDashboard` never renders; section order differs from code | S |

## Cross-Mode Priorities

| # | Severity | Mode(s) | File:Line | Issue | Effort |
|---|----------|---------|-----------|-------|--------|
| 1 | HIGH | best-practices, coverage `[multi-mode]` | `templates/hooks/pretooluse/utils/*` | Five divergent copies of the quote-skip rule and three clause splitters in the security gates; a bypass fixed in one copy stays open in the others | M |
| 2 | HIGH | coverage | `scripts/validate-worker-json.ts`, `scripts/lib/state-write-guard.ts` | The two guards that protect campaign state are the least-tested code in the repo | M |
| 3 | HIGH | coverage | `scripts/campaign-resume-signal.test.ts:325` | Suite is red on any root runner for an environmental reason | S |
| 4 | MEDIUM | best-practices, ux `[multi-mode]` | `forge.ts:26-28`, `gitea.ts:216`, `gitlab.ts:213`, `hook-event-log.js:215`, `campaign-resume-signal.ts:149` | The same swallow-and-degrade pattern in five places turns forge/git failures into "nothing to do" | S |
| 5 | MEDIUM | ux | `dashboard.ts:200-227` | The orchestrator reads this every turn; no verdict, no caps | S |
| 6 | MEDIUM | best-practices | 9 files | `readJsonFile` bypass despite a `V-INT-02` self-declaration | S |

## Recommendations

### Quick Wins (< 1 hour)
1. Guard the root-uid case in `campaign-resume-signal.test.ts` (#3) -- effort: S
2. Return `ok: false` from `forge.ts:26-28` on `gh` failure and log to stderr in the four other swallow sites (#4) -- effort: S
3. Wrap `loadCampaignState` in a "no campaign at <dir>" message; add a one-line health verdict above the dashboard counts (#5) -- effort: S
4. Correct parity-matrix row PM-090 to `covered` (V-DOC-05..07 shipped) -- effort: S

### Planned Improvements (1-4 hours)
1. Extract `templates/hooks/pretooluse/utils/shell-lexer.js` (`skipQuotedSpan`, `splitClauses`, `tokenize`) consumed by the three guards (#1) -- effort: M
2. CLI tests for `validate-worker-json.ts --hook` and `state-write-guard.ts` covering the refuse paths (#2) -- effort: M
3. A `verify` check forbidding bare `JSON.parse(fs.readFileSync` outside `lib/fs.ts`, same shape as `jq-empty-guard.check.ts`; lift `stack-repair.ts:186` `parseFlags` into `lib/` (#6, best-practices #6) -- effort: S

## Suggested Next Steps

| Action | Command | When |
|--------|---------|------|
| Plan fixes | `/x-plan` (mercure) or file as `[Kaizen]` issues and `/goal run blackhole until empty` | Create implementation plan from cross-mode priorities |
| Deep assessment | `/x-analyze general` | 5-domain security/perf/architecture swarm on `templates/hooks/` |

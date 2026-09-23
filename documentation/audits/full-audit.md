---
type: analysis
summary: "Full-codebase x-analyze audit (coverage + best-practices + ux): 87.4% line coverage with 3 test-isolation failures in hook-event-triage.test.ts that CI cannot see, a verified security-relevant coverage gap in carry-target-allowlist.ts's reject branch that the coverage tool reports as 100%, SOLID/DRY debt concentrated in the shared PreToolUse hook modules, no UX findings (CLI-only tool), and a post-audit discovery that main was red from 2026-09-07 on the self-hosted runner while PRs went green on ubuntu-latest (resolved 2026-09-22 by #987). Remediation filed as epic #978."
status: current
created: 2026-09-22
last_updated: 2026-09-23
review_trigger: "on file change"
---

# Full Audit Report

**Date**: 2026-09-22
**Scope**: Codebase root (repo root)
**Analyzer**: x-analyze (all modes: coverage, best-practices, ux)

## Mode Score Summary

| Mode | Score / Metric | Rating | Top Issue |
|------|----------------|--------|-----------|
| Coverage | 87.57% funcs / 87.44% lines (2668 tests, 2665 pass / **3 fail**) | Good, with an active red signal | Test-isolation bug in `hook-event-triage.test.ts` masking true coverage of that file |
| Best Practices | SOLID: SRP 78%, OCP 85%, LSP 88%, ISP 85%, DIP 85% — DRY 87%, KISS 74%, YAGNI 91% | Good overall, KISS Fair | God-module: `worktree-removal-guard.js` (~1330 lines, 38 functions, 4 bundled concerns) |
| UX | N/A — no traditional UI surface | N/A | CLI-only tool; `campaign-status.ts` dashboard output has sound information hierarchy, no findings |

## Mode: Coverage

Ran `bun test --coverage`: 2668 tests across 147 files, 2665 pass / 3 fail, 6378 assertions, 53.95s. No coverage floor is currently configured in `package.json` or CI.

**3 pre-existing failures** — all in `scripts/lib/hook-event-triage.test.ts` (`main() CLI entrypoint` block, around lines 484/507/553): `expect(fs.existsSync(campaignDir)).toBe(false)` fails because a real `.blackhole/` directory already exists in the repo at test time. This is a **test-isolation bug** (the suite assumes a clean repo root instead of scoping to a temp dir), not a coverage gap — but it masks the true coverage figure for that file and will flake in CI depending on run order/state.

**Coverage-tool caveat**: several CLI entrypoints are tested via `Bun.spawn` subprocess (`validate-worker-json`, `review-aggregate`, `campaign-status`, `ci-diagnosis`, `triage-deferred-findings`, `carry-staged-artifacts`, `stack-repair`). Bun's instrumentation doesn't see subprocess execution, so these show artificially low numbers despite being behaviorally exercised — flagged per-file below rather than treated as blind gaps.

### P1 — Critical

| File | Coverage | Finding | Effort |
|------|----------|---------|--------|
| `scripts/lib/carry-target-allowlist.ts` (`isCarryTargetAllowed`) | 100% (false negative) | Reject branch for in-repo-root-but-outside-allowlist targets (e.g. `package.json`, `.git/hooks/*`) has zero test coverage. Security-relevant: this is issue #784 AC1's whole reason for existing — a staged-artifact carry step could target CI config or git hooks. **VERIFIED** | S |
| `scripts/checks/adr-status.check.ts` | 49.10% lines / 74.07% funcs | Divergence-detection branches (INDEX-vs-frontmatter mismatch, missing supersession citation) uncovered; enforces V-ADR-01/02/03/04. Also flagged by Best-Practices for redundant I/O — see Cross-Mode Priorities. | M |
| `scripts/checks/design-track.check.ts` | 40.91% lines | `checkDesignTrackTemplate()` (lines 20-31) and `checkDesignAutonomyGateGrounding()` (lines 49-66) are defined but never called by any test. Feeds the V-AUTO-01 BLOCK gate. **VERIFIED** | S/M |
| `scripts/lib/state-write-guard.ts` | 56.25% lines / 50% funcs | `--allow-shrink` / zero-collapse-refusal logic at lines 36-82 (refusal itself at 70-71) is uncovered. This is the single-writer atomic-write guard for `queue.json`/`findings-ledger.json` — the direct fix for the historical issue #489 zero-byte-file incident. *(Corrected citation — original scan cited lines 89-130, which is CLI-parsing code; verification found the real logic at 36-82.)* | S |
| `scripts/checks/schema.check.ts` | 61.17% lines | ~40 uncovered lines (83-122). | M |
| `scripts/checks/adr-shape.check.ts` | 61.11% lines | Only guard against corpus-wide ADR shape drift (V-ADR-08, WARN). | S |

### P2 — High

| File | Coverage | Finding | Effort |
|------|----------|---------|--------|
| `scripts/validate-worker-json.ts` | 0-5.65% (subprocess blind spot) | Feeds the V-BRIEF-01 BLOCK gate; recommend direct unit tests on internal validators rather than relying solely on subprocess smoke tests. | M |
| `scripts/lib/campaign-status/state.ts` (`loadCampaignState`) | 0% funcs / 17.07% lines | No direct test; includes the `CampaignNotFoundError` path. | S |
| `scripts/doctor.ts` | 42.73% lines | Genuine gap (not subprocess-tested); uncovered 134-294. | M |
| `scripts/campaign-status.ts` | 50% lines | Uncovered 93-139 (dashboard-render dispatch). Also touched by UX mode — see below. | S/M |
| `scripts/lib/build/targets.ts` | 17.92% lines | Large uncovered surface (50-284); feeds the V-PLUGIN-01 BLOCK gate (ADR-030 stale-plugin-cache incident, issue #800). | M/L |
| `scripts/checks/agent-plugins-build.check.ts` | 34.48% lines | — | S |
| `scripts/checks/gemini-build.check.ts` | 17.19% lines | `--gemini` is a documented deprecated no-op (ADR-007 T2) — **delete the dead branches instead of testing them**. | S (delete) |
| `scripts/lib/forge-adapter/github.ts` | 75.38% lines | Uncovered 154-263; underlies nearly every forge operation (ADR-027 abstraction). | M |
| `scripts/lib/hook-event-triage.ts` | 72.84% lines | Uncovered 243-290, adjacent to the failing-test isolation bug above — fix isolation first, re-measure after. | S (after fix) |

### P3 — Medium (lower Pareto priority)

`scripts/checks/links.check.ts` (71.90%), `scripts/checks/companion-docs.check.ts` (65.22%), `scripts/checks/claude-dist.check.ts` (60%), `scripts/checks/vocabulary.check.ts` (83.33% lines / 43.75% funcs), `scripts/checks/agent-dir-citations.check.ts` (71.03%), `scripts/lib/mercure-vcode-snapshot.ts` (74.36%), `scripts/ci-diagnosis.ts` (67.78%, subprocess-tested main path).

### Testing Pyramid

No clean unit/integration/E2E split — the dominant pattern is "CLI-as-unit": pure functions get direct unit tests, and a subset of CLI wrappers are additionally exercised via `Bun.spawn` subprocess (true integration-style). No E2E layer exists (expected — no browser/UI). Estimated split: **~75% unit / ~25% integration(subprocess) / ~0% E2E** — heavier on unit than the 70/20/10 target, which is appropriate for this tool. The real gap isn't pyramid shape: it's that CLI-wrapper glue (`parseArgs`, `import.meta.main` bodies) falls between unit tests (which skip it as "just glue") and subprocess tests (which don't produce coverage credit).

## Mode: Best Practices

**Calibration note**: this repo runs a heavy internal meta-enforcement layer (V-DRY-01/V-INT-02 gates, `check-common.ts` shared-primitive extraction, `V-CONTENTGATE-01..03` size ceilings). It visibly works — e.g. zero bare `JSON.parse(fs.readFileSync(...))` calls exist anywhere in production `scripts/**`. Scores are calibrated against that baseline.

### SOLID Compliance

| Principle | Score | Rating | Top violation |
|-----------|-------|--------|----------------|
| SRP | 78% | Good | `worktree-removal-guard.js` bundles 4 concerns in one file; `hook-event-log.js` mixes event-recording with worktree/path-resolution |
| OCP | 85% | Good | `scripts/lib/worker-json/validate.ts:11-28` — `switch(role)` dispatch (minor, one-line delegation per case) |
| LSP | 88% | Good | No violations found — predominantly functional TS; the one real hierarchy (`ForgeAdapter`) is implemented consistently across github/gitea/gitlab |
| ISP | 85% | Good | `ForgeAdapter` interface (12 methods) is cohesive, no stub implementations found |
| DIP | 85% | Good | Clean factory pattern (`createForgeAdapter`) — consumers never instantiate concrete adapters directly |

### Quality Principles

| Principle | Score | Rating | Top violation |
|-----------|-------|--------|----------------|
| DRY | 87% | Good | `validate-bash-command.js:90-164` — 4x near-identical tier-dispatch block, varying only by evaluator/reason source |
| KISS | 74% | Fair | `worktree-removal-guard.js:1132-1194` (`evaluateResolvedWorktree`) — nested branches accreted across 5 documented incidents (F-00043…F-00065) |
| YAGNI | 91% | Excellent | No speculative abstractions or dead code found; zero TODO/FIXME/XXX in `scripts/**/*.ts`; every pattern found has 3+ real consumers |

No V-SEC, V-SOLID-01/03 CRITICAL, or V-DRY-01 (>10-line duplication) instances found in the sampled scope.

### Priority Violations

**P1 — shared/hook modules (every Bash call in every session passes through these)**

1. **`templates/hooks/pretooluse/utils/worktree-removal-guard.js`** (full file, ~1330 lines) — V-PAT-01/V-SOLID-01 God-module: 38 functions bundling shell-clause tokenizing/walking, `cd`-target simulation, git-worktree-removal safety evaluation, and `rm`-removal safety evaluation. **VERIFIED**. The file's own docstring argues current cohesion is intentional (shared clause-walk needed by both checks) — recommend a future split along that seam, not urgent.
2. Same file, lines 1132-1194 (`evaluateResolvedWorktree`) — V-KISS-02 nested branch accretion (5 documented incidents).
3. **`templates/hooks/pretooluse/validate-bash-command.js:90-164`** — V-DRY-02: 4x repeated tier-dispatch block. **VERIFIED**. A `handleTieredResult()` helper collapses ~50 lines to ~15.
4. **`templates/hooks/pretooluse/utils/hook-event-log.js`** — V-SOLID-01: mixes event-recording (`recordEvent`, `denyAndRecord`, `warnAndRecord`, `failClosed`, lines ~455-597) with worktree/assigned-root path resolution (`worktreeRoot`, `mainCloneRoot`, `readScratchpadDir`, etc., lines ~70-425) under a filename describing only the first concern. **VERIFIED**. Imported by nearly every hook.

**P2 — high-churn `scripts/checks/*.check.ts`**

5. `scripts/checks/adr-status.check.ts:118-207` — V-DRY-02/perf: 4 check functions each independently `fs.readdirSync`+`fs.readFileSync` the same ADR files (up to 4x redundant I/O per `bun run verify` pass). **VERIFIED**. Same file as the coverage-gap finding above.
6. `scripts/lib/worker-json/validate.ts:11-28` — V-SOLID-02 minor: `switch(role)` dispatch; a `Record<Role, validator>` lookup makes role-addition a pure-addition change.

**Watch only, no action needed**: `scripts/review-aggregate.ts`, `scripts/design-aggregate.ts`, `scripts/campaign-resume-signal.ts` (300+ lines but well-factored pure-function pipelines, not God-objects); `src/agents/planner.md` (543 lines, under its grandfathered 712-line ceiling).

## Mode: UX

**ia_score: N/A** — no traditional UI surfaces exist (`.tsx`/`.jsx`/`.vue`/`.svelte`/`.html` absent). V-UX-01/04/05/07/08 are all N/A for this repo.

A lightweight informal pass on `scripts/campaign-status.ts` + `scripts/lib/campaign-status/dashboard.ts` (the CLI text-output "dashboard") found sound information hierarchy:
- **At-a-glance**: header (scope, orchestrator turn, refresh time), forge stats, queue/ledger summary counts, health verdict icon
- **Summary**: in-flight table, blocked list, ready list, routing, waves, completed
- **Detail**: ledger open findings (capped, severity-then-recency sorted)
- **Raw/advanced**: active workers, plugin-drift warning

Overflow caps (`SECTION_CAP = 10` + "…and N more") prevent wall-of-text dumps; no anti-pattern violations found. Two minor density notes (header line, counts line) are informational only, not findings.

## Cross-Mode Priorities

Ranked by x-synthesizer (Pareto 80/20). `[multi-mode]` = confirmed by 2+ modes.

| # | Tier | Mode(s) | File:Line | Issue | Effort |
|---|------|---------|-----------|-------|--------|
| 1 | Active red signal | Coverage | `scripts/lib/hook-event-triage.test.ts` (`main()` block) | 3 failing tests — test-isolation bug, `.blackhole/` dir leaks into test run. **VERIFIED** → **#981** | S |
| 2 | Security gap | Coverage | `scripts/lib/carry-target-allowlist.ts` (`isCarryTargetAllowed`) | Reject-branch coverage gap, feeds issue #784 AC1's threat model. **VERIFIED** → **#979** | S |
| 3 | BLOCK-gate | Coverage + Best-Practices | `scripts/checks/adr-status.check.ts:118-207` | **[multi-mode]** Low coverage on divergence-detection branches + 4x redundant file I/O. **VERIFIED** (I/O angle) — *not filed; see Filed Issues below* | M |
| 4 | BLOCK-gate | Coverage | `scripts/checks/design-track.check.ts:20-31,49-66` | Untested functions feeding V-AUTO-01. **VERIFIED** → **#982** | S/M |
| 5 | BLOCK-gate | Coverage | `scripts/lib/state-write-guard.ts:36-82` (refusal at 70-71) | Zero-collapse-refusal coverage gap — protects against #489-class incident. Corrected citation. → **#983** | S |
| 6 | Shared-module quality | Best-Practices | `templates/hooks/pretooluse/validate-bash-command.js:90-164` | 4x tier-dispatch duplication, every Bash call passes through this file. **VERIFIED** → **#980** | S |
| 7 | Shared-module quality | Best-Practices | `templates/hooks/pretooluse/utils/hook-event-log.js:70-597` | Mixed concerns (event-recording + path-resolution). **VERIFIED** | M |
| 8 | Shared-module quality | Best-Practices | `templates/hooks/pretooluse/utils/worktree-removal-guard.js` (full file) | God-module, 38 functions, 4 concerns. **VERIFIED**, not urgent per own docstring rationale. | L |
| 9 | BLOCK-gate | Coverage | `scripts/validate-worker-json.ts` | Subprocess-only test coverage, feeds V-BRIEF-01. | M |
| 10 | BLOCK-gate | Coverage | `scripts/lib/build/targets.ts:50-284` | Feeds V-PLUGIN-01 (ADR-030 precedent, issue #800). | M/L |
| 16 | Gap (no UX risk) | Coverage + UX | `scripts/campaign-status.ts:93-139` + `dashboard.ts` | **[multi-mode]** Coverage gap on dashboard-render dispatch; UX pass confirms the rendered output itself has no hierarchy issues. | S/M |

*(Full 20-item list available in the synthesis pass; items 11-15, 17-20 are lower-Pareto-priority coverage/quality gaps — see per-mode sections above.)*

## Could Not Verify

- `scripts/lib/state-write-guard.ts` — the original coverage-agent citation (lines 89-130) was **STALE**: that range is CLI argument parsing, not the `--allow-shrink`/zero-collapse-refusal logic. Verification located the correct region at lines 36-82 (refusal itself at 70-71); the corrected citation is used throughout this report (see P1 #4 and Cross-Mode Priority #5).

## Discovered After the Audit

One finding surfaced while filing this report's issues, outside the three mode audits. It is
recorded here because it changes how the rest of this report should be read.

**`main` was red from 2026-09-07** — five consecutive failing Verify runs. **Resolved 2026-09-22 by #987**, which gave the test suite a deadlock-guard timeout instead of a 5s performance budget; the finding is kept below as the historical record. Two subprocess
tests exceed bun's 5000ms default timeout on the self-hosted `mba` runner:
`build.test.ts:1105` (`--all` byte-identical, 5067ms) and `verify.runner.test.ts`
(`verify.ts CLI subprocess`, 5001ms). Both shell out to a full build or verify run; their passing
siblings land at 1755–3561ms, so the budget is marginally met rather than comfortably met.

This was invisible on pull requests because `verify.yml:24` routes `pull_request` events to
`ubuntu-latest` (green) and `push` events to the self-hosted runner (red) — so PRs merge green and
main went red afterward. Filed as **#984**, closed by #987.

Two consequences for this report:

1. The coverage baseline here (87.44% lines) was measured **locally**, not on a green main. It is
   still the best available number, but it was not taken against a passing build.
2. The 3 `hook-event-triage` failures are a *different* problem from the CI red — they do not appear
   in CI at all, because CI checks out clean and has no repo-root `.blackhole/`. That asymmetry
   corroborates the isolation diagnosis rather than undermining it.

## Filed Issues

Epic **#978** tracks the remediation set. Report tracking issue: **#977**.

| Finding | Issue | Size | Priority |
|---------|-------|------|----------|
| `carry-target-allowlist` reject branch untested (security-relevant) | #979 | s | P1 |
| `validate-bash-command.js` 4x tier-dispatch duplication | #980 | s | P1 |
| `hook-event-triage.test.ts` clean-repo-root assumption | #981 | s | P1 |
| `design-track.check.ts` two uninvoked check functions | #982 | s | P2 |
| `state-write-guard` zero-collapse refusal untested | #983 | s | P1 |
| `main` red on self-hosted runner (post-audit discovery) — **resolved 2026-09-22 by #987** | #984 | s | P1 |

**Deliberately not filed**, with reasons:

- `worktree-removal-guard.js`'s God-module shape — real and verified (`V-PAT-01`), but the file's own
  docstring argues the cohesion is intentional and every prior change to it was incident-driven.
  L-effort against the highest-risk file in the hook tree; not worth doing speculatively.
- `adr-status.check.ts` (cross-mode #3) — the only multi-mode-confirmed finding, and a genuine
  dual-purpose fix (coverage + collapsing 4x redundant ADR-file I/O). Held back because it is the
  one M-effort item in a set of S-effort items; file it when the S-tier set is cleared.
- `gemini-build.check.ts` (17% covered) — `--gemini` is a documented deprecated no-op (ADR-007 T2).
  Belongs to that flag's removal, not to a test-backfill campaign.
- The 60–75%-covered long tail — real, low blast radius, not worth issue overhead yet.

## Recommendations

### Top 5 by Risk-to-Effort Ratio

1. **`carry-target-allowlist.ts` reject-branch test** (S) — closes a verified, security-relevant coverage-tool blind spot protecting issue #784's threat model.
2. **`validate-bash-command.js` `handleTieredResult()` extraction** (S) — mechanical DRY fix on the file every Bash call in every session passes through.
3. **Fix `hook-event-triage.test.ts` isolation bug** (S) — unblocks trustworthy coverage measurement on that file and removes an active red CI signal.
4. **`design-track.check.ts` — test the two untested functions** (S/M) — direct enforcement-gate coverage (V-AUTO-01).
5. **`state-write-guard.ts` zero-collapse-refusal test** (S) — closes the gap on the exact mechanism that fixed the #489 incident, using the corrected line citation.

*(6th pick if room allows: `adr-status.check.ts` — the only multi-mode-confirmed finding; dual-purpose fix adds coverage and collapses 4x redundant ADR-file I/O into one shared load, effort M.)*

### Quick Wins (< 1 hour)

1. `carry-target-allowlist.ts` reject-branch unit test — effort: S
2. `validate-bash-command.js` tier-dispatch extraction — effort: S
3. `hook-event-triage.test.ts` isolation fix (scope to temp dir) — effort: S
4. `state-write-guard.ts` zero-collapse-refusal test (lines 36-82) — effort: S
5. `gemini-build.check.ts` — delete dead `--gemini` branches instead of testing them — effort: S

### Planned Improvements (1-4 hours)

1. `adr-status.check.ts` — add coverage AND collapse 4x redundant ADR-file I/O into one shared load — effort: M
2. `hook-event-log.js` — split event-recording from worktree/path-resolution concerns — effort: M
3. `validate-worker-json.ts` — add direct unit tests on internal validators (V-BRIEF-01 gate) — effort: M
4. `build/targets.ts` — close the largest uncovered surface feeding V-PLUGIN-01 — effort: M/L

### Architectural (defer, not urgent)

1. `worktree-removal-guard.js` — future split along its own documented seam (clause-walk vs. policy evaluation) before the next incident-driven patch grows it further — effort: L. File's own docstring argues current cohesion is intentional; not a blocking finding.

## Suggested Next Steps

| Action | Command | When |
|--------|---------|------|
| Plan fixes | `/x-plan` | Create implementation plan from cross-mode priorities (start with the 5 Quick Wins) |
| Deep security/perf/architecture assessment | `/x-analyze general` | If a deeper 5-domain swarm is wanted beyond this named-mode audit |
| Fix isolation bug directly | `/x-fix` | The `hook-event-triage.test.ts` failure is a clear, obvious bug — doesn't need full planning |

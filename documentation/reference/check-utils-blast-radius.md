---
type: reference
summary: "Blast-radius reference for shared check-utils.ts consumers across scripts/checks"
status: current
review_trigger: "on check-utils.ts or scripts/checks/*.check.ts import change"
created: 2026-07-26
last_updated: 2026-09-06
related:
  - scripts/checks/check-utils.ts
  - scripts/verify.ts
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
---

# `check-utils.ts` — Dependency Blast-Radius

Post-merge review finding **F-00103** (#360 / PR #399): `CheckResult` and shared check
helpers live in `scripts/checks/check-utils.ts` and fan out to every verify domain module.
This note is the consumer graph for `V-SCOPE-03` planning — update it when imports change.

## Exported surface

| Symbol | Kind | Contract |
|--------|------|----------|
| `root` | `string` | Absolute repo root (`path.resolve(import.meta.dirname, '..', '..')`) |
| `read(rel)` | function | Sync UTF-8 read of `path.join(root, rel)` |
| `CheckResult` | type | `{ id: string; ok: boolean; detail?: string }` — one verify assertion row |

`scripts/verify.ts` glob-discovers `scripts/checks/*.check.ts`, calls each module's
`runChecks(): CheckResult[]`, and aggregates results. Any change to the `CheckResult` shape
is **BREAKING** for all rows below.

## `CheckResult` consumers (52 modules)

All paths are repo-relative. Imports verified against `main` at issue #410; refreshed at issue
#462 (added `hooks.check.ts`, `stop-mode.check.ts` — both landed on `main` since #410 and were
missing from this table — plus that issue's own `doc-health.check.ts`); refreshed again at issue
#498 (added `claude-native-settings.check.ts`, `gate-content-contract.check.ts`,
`plan-quality-gate.check.ts`, `test-integrity.check.ts`, `worker-git-safety.check.ts` — five
modules that had landed on `main` since #462 and were missing here; also corrected this table's
own hand-maintained counts and `check-utils.ts`'s header comment, which had independently
drifted from each other and from this table); refreshed again at #570 (added
`queue-coherence.check.ts` plus `jq-empty-guard.check.ts`, landed at #558 and missing from this
table independently of #570's own addition; re-measured the count via the `rg` command in §
Maintenance rather than hand-incrementing, per that section's own instruction — merged as PR
#590); refreshed again at #567/#565 (added `vcode-severity-sync.check.ts` and
`vcode-citation.check.ts` — this pair's own new modules, split into a follow-up PR after #590
merged, per the batching grant's own "split into two PRs" escape hatch); refreshed again at #882,
which found the header comment (29), this table (32 rows) and a live `read()`-importer count (39)
had drifted into three disagreeing numbers — re-measured with the § Maintenance `rg` command
against the live tree rather than trusting any of the three: 52 `*.check.ts` modules import from
`check-utils.ts` today (20 were missing from this table — `adr-shape`, `adr-supersession`,
`adr-watch`, `agent-plugins-build`, `audit-modules`, `build-input-dirs`, `config-registration`,
`cwd-pin-guard`, `deferred-reconciliation`, `forge-adapter-routing`, `gate-resolution-citation`,
`inline-schema-drift`, `ledger-schema`, `pareto-filing-gate`, `prose-heredoc`,
`reformulation-surface`, `route-shape`, `staging-schema`, `tree-registry`,
`v-test09-hooks-claim`). These three numbers count three different, genuinely distinct sets (see
§ Maintenance for the count-by-count breakdown) — none of the three was "wrong" on its own terms,
they were simply never reconciled against each other after each independent addition.

| Consumer | Imports from `check-utils.ts` | Role |
|----------|-------------------------------|------|
| `scripts/checks/adr-shape.check.ts` | `root`, `CheckResult` | ADR heading-shape conformance checks |
| `scripts/checks/adr-status.check.ts` | `root`, `CheckResult` | ADR status gate checks |
| `scripts/checks/adr-supersession.check.ts` | `root`, `CheckResult` | ADR reversal disclosure checks |
| `scripts/checks/adr-watch.check.ts` | `root`, `CheckResult` | ADR revisit-threshold checks |
| `scripts/checks/agent-dir-citations.check.ts` | `root`, `CheckResult` | Agent-directory citation checks |
| `scripts/checks/agent-plugins-build.check.ts` | `root`, `CheckResult` | agent-plugins.org build output checks |
| `scripts/checks/agents.check.ts` | `root`, `read`, `CheckResult` | Agent prompt / gate-marker checks |
| `scripts/checks/audit-modules.check.ts` | `root`, `read`, `CheckResult` | Reviewer audit-module registry checks |
| `scripts/checks/build-input-dirs.check.ts` | `root`, `CheckResult` | Build-input-only directory / INCLUDE-marker-site checks |
| `scripts/checks/build.check.ts` | `root`, `CheckResult` | Build output parity checks |
| `scripts/checks/checkpoint.check.ts` | `read`, `CheckResult` | Checkpoint protocol checks |
| `scripts/checks/claude-dist.check.ts` | `root`, `CheckResult` | Claude marketplace dist checks |
| `scripts/checks/claude-native-settings.check.ts` | `root`, `CheckResult` | Claude native settings checks |
| `scripts/checks/codex-build.check.ts` | `root`, `CheckResult` | Codex build output checks |
| `scripts/checks/companion-docs.check.ts` | `read`, `CheckResult` | Companion documentation checks |
| `scripts/checks/config-gate.check.ts` | `read`, `CheckResult` | Config gate marker checks |
| `scripts/checks/config-registration.check.ts` | `read`, `root`, `CheckResult` | Config-key registration checks |
| `scripts/checks/content-gates.check.ts` | `root`, `read`, `CheckResult` | Content gate marker checks |
| `scripts/checks/coverage-regression.check.ts` | `read`, `CheckResult` | Coverage regression gate checks |
| `scripts/checks/cwd-pin-guard.check.ts` | `read`, `CheckResult` | CLI `--cwd` pin checks |
| `scripts/checks/deferred-reconciliation.check.ts` | `root`, `CheckResult` | Deferred-finding reconciliation checks |
| `scripts/checks/design-track.check.ts` | `read`, `CheckResult` | Design-track gate checks |
| `scripts/checks/doc-health.check.ts` | `root`, `CheckResult` | Doc-tree health + INDEX.md integrity checks |
| `scripts/checks/forge-adapter-routing.check.ts` | `root`, `CheckResult` | Forge-adapter CLI routing checks |
| `scripts/checks/gate-content-contract.check.ts` | `read`, `CheckResult` | R-003 Gate Content Contract checks |
| `scripts/checks/gate-resolution-citation.check.ts` | `read`, `CheckResult` | Gate-resolution clause citation checks |
| `scripts/checks/gemini-build.check.ts` | `root`, `read`, `CheckResult` | Gemini build output checks |
| `scripts/checks/ground-truth.check.ts` | `root`, `read`, `CheckResult` | Ground-truth / SSOT checks |
| `scripts/checks/hooks.check.ts` | `root`, `CheckResult` | PreToolUse hook gate checks |
| `scripts/checks/inline-schema-drift.check.ts` | `root`, `CheckResult` | Inline status-skeleton drift checks |
| `scripts/checks/jq-empty-guard.check.ts` | `root`, `CheckResult` | `jq empty`-as-sufficient-guard prescription checks |
| `scripts/checks/ledger-schema.check.ts` | `root`, `CheckResult` | Findings-ledger schema checks |
| `scripts/checks/links.check.ts` | `root`, `read`, `CheckResult` | Markdown link integrity checks |
| `scripts/checks/pareto-filing-gate.check.ts` | `root`, `read`, `CheckResult` | Pareto filing-gate checks |
| `scripts/checks/parity-matrix.check.ts` | `root`, `CheckResult` | Platform parity matrix checks |
| `scripts/checks/plan-quality-gate.check.ts` | `root`, `read`, `CheckResult` | Plan quality gate checks |
| `scripts/checks/playbook.check.ts` | `root`, `read`, `CheckResult` | Playbook / phase doc checks |
| `scripts/checks/prose-heredoc.check.ts` | `read`, `CheckResult` | Agent-prose heredoc checks |
| `scripts/checks/queue-coherence.check.ts` | `root`, `CheckResult` | Live `.blackhole/queue.json` coherence checks |
| `scripts/checks/reformulation-surface.check.ts` | `read`, `root`, `CheckResult` | Reformulation-surface checks |
| `scripts/checks/route-shape.check.ts` | `read`, `root`, `CheckResult` | Route field-set parity checks |
| `scripts/checks/schema.check.ts` | `root`, `read`, `CheckResult` | JSON schema checks |
| `scripts/checks/single-writer.check.ts` | `read`, `CheckResult` | Single-writer invariant checks |
| `scripts/checks/staging-schema.check.ts` | `read`, `CheckResult` | Durable-artifact staging schema checks |
| `scripts/checks/stop-mode.check.ts` | `read`, `CheckResult` | Campaign stop-mode gate checks |
| `scripts/checks/test-integrity.check.ts` | `read`, `CheckResult` | Test integrity checks |
| `scripts/checks/tree-registry.check.ts` | `read`, `CheckResult` | Committed target-tree registry checks |
| `scripts/checks/v-test09-hooks-claim.check.ts` | `read`, `CheckResult` | Hooks-only coverage-claim checks |
| `scripts/checks/vcode-citation.check.ts` | `root`, `read`, `CheckResult` | `blackhole-vcodes.md` enforcement-site citation checks |
| `scripts/checks/vcode-severity-sync.check.ts` | `root`, `CheckResult` | `blackhole-vcodes.md` severity-restatement sync checks |
| `scripts/checks/vocabulary.check.ts` | `root`, `CheckResult` | Vocabulary / naming checks |
| `scripts/checks/worker-git-safety.check.ts` | `read`, `CheckResult` | Worker git safety checks |

**Count:** 52 `*.check.ts` domain modules + `verify.ts` = **53** direct `CheckResult` consumers.

## `root`-only consumer (no `CheckResult`)

| Consumer | Imports | Notes |
|----------|---------|-------|
| `scripts/lib/check-common.ts` | `root` | Shared cross-domain helpers (ADR-007 R6 / #375); imported by some `*.check.ts` modules |

Changes to `root` resolution affect every check module above **plus** `check-common.ts`.

## Indirect consumers

| Consumer | Dependency path | Blast radius |
|----------|-----------------|--------------|
| `scripts/verify.runner.test.ts` | `verify.ts` → `CheckResult[]` | Runner unit tests |
| `scripts/verify.*.test.ts` (per-domain) | individual `*.check.ts` → `CheckResult` | Domain check unit tests |
| `bun run verify` / CI | `verify.ts` → all `*.check.ts` | Full verify gate (release-blocking) |

## Change-impact summary

| Change | Classification | Affected consumers |
|--------|----------------|-------------------|
| Add optional field to `CheckResult` | TRANSPARENT (if optional) | Type-only; runtime unchanged |
| Rename / remove `CheckResult` field | BREAKING | All 53 direct consumers + verify output formatting |
| Change `runChecks()` return type away from `CheckResult[]` | BREAKING | `verify.ts` + every `*.check.ts` |
| Move `CheckResult` to another module | BREAKING | All import sites (grep `check-utils`) |
| Change `root` path resolution | BREAKING | All 52 checks + `check-common.ts` |
| Change `read()` encoding or path join | BREAKING | Modules importing `read()` — see the `Imports` column in the consumer table above |

**Overall blast radius:** HIGH — `CheckResult` is the shared verify wire format across the
entire `scripts/checks/` domain split (ADR-007 T5/R2').

## Maintenance

Reconcile this table after:

- Adding or removing a `scripts/checks/*.check.ts` module
- Changing any `from './check-utils.ts'` or `from '../checks/check-utils.ts'` import
- Altering the `CheckResult` type or `runChecks()` contract

Three different commands measure three different sets — conflating them is exactly how the
header comment (29), this table (32 rows) and a stale "39" drifted apart before issue #882's
reconciliation. Re-run all three and update every consumer of the corresponding number:

```bash
# 1. This table's own scope — *.check.ts domain modules + verify.ts (the "Count:" line above).
rg -l "from ['\"].*check-utils" scripts/checks/*.check.ts scripts/verify.ts | wc -l   # 53

# 2. Every scripts/ file (tests and utility scripts included) importing anything from
#    check-utils.ts — a strict superset of #1. This is what check-utils.ts's own header
#    comment ("Dependency blast-radius (N direct consumers)") should always match.
rg -l "from ['\"].*check-utils" scripts --glob '!wt-*' | wc -l                        # 75

# 3. Files anywhere under scripts/ that import the `read` symbol specifically — a subset of
#    #2, orthogonal to #1 (a file can import `read` without being a *.check.ts module, e.g.
#    scripts/lib/check-common.ts's readComposedAgentDoc).
rg -l "from ['\"].*check-utils" scripts --glob '!wt-*' \
  | xargs grep -lE "import\s*\{[^}]*\bread\b" | wc -l                              # 40
```

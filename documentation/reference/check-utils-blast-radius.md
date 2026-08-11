---
type: reference
status: current
review_trigger: "on check-utils.ts or scripts/checks/*.check.ts import change"
created: 2026-07-26
last_updated: 2026-08-11
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

## `CheckResult` consumers (30 modules)

All paths are repo-relative. Imports verified against `main` at issue #410; refreshed at issue
#462 (added `hooks.check.ts`, `stop-mode.check.ts` — both landed on `main` since #410 and were
missing from this table — plus that issue's own `doc-health.check.ts`); refreshed again at issue
#498 (added `claude-native-settings.check.ts`, `gate-content-contract.check.ts`,
`plan-quality-gate.check.ts`, `test-integrity.check.ts`, `worker-git-safety.check.ts` — five
modules that had landed on `main` since #462 and were missing here; also corrected this table's
own hand-maintained counts and `check-utils.ts`'s header comment, which had independently
drifted from each other and from this table); refreshed again at #570 (added
`queue-coherence.check.ts` — this issue's own new module — plus `jq-empty-guard.check.ts`,
landed at #558 and missing from this table independently of #570's own addition; re-measured the
count via the `rg` command in § Maintenance rather than hand-incrementing, per that section's own
instruction. `vcode-severity-sync.check.ts`/`vcode-citation.check.ts` — #567/#565's own new
modules — are not yet in this table: those two checks are held back pending a content decision
outside this PR's scope, see #567/#565).

| Consumer | Imports from `check-utils.ts` | Role |
|----------|-------------------------------|------|
| `scripts/checks/adr-status.check.ts` | `root`, `CheckResult` | ADR status gate checks |
| `scripts/checks/agent-dir-citations.check.ts` | `root`, `CheckResult` | Agent-directory citation checks |
| `scripts/checks/agents.check.ts` | `root`, `read`, `CheckResult` | Agent prompt / gate-marker checks |
| `scripts/checks/build.check.ts` | `root`, `CheckResult` | Build output parity checks |
| `scripts/checks/checkpoint.check.ts` | `read`, `CheckResult` | Checkpoint protocol checks |
| `scripts/checks/claude-dist.check.ts` | `root`, `CheckResult` | Claude marketplace dist checks |
| `scripts/checks/claude-native-settings.check.ts` | `root`, `CheckResult` | Claude native settings checks |
| `scripts/checks/codex-build.check.ts` | `root`, `CheckResult` | Codex build output checks |
| `scripts/checks/companion-docs.check.ts` | `read`, `CheckResult` | Companion documentation checks |
| `scripts/checks/config-gate.check.ts` | `read`, `CheckResult` | Config gate marker checks |
| `scripts/checks/content-gates.check.ts` | `root`, `read`, `CheckResult` | Content gate marker checks |
| `scripts/checks/coverage-regression.check.ts` | `read`, `CheckResult` | Coverage regression gate checks |
| `scripts/checks/design-track.check.ts` | `read`, `CheckResult` | Design-track gate checks |
| `scripts/checks/doc-health.check.ts` | `root`, `CheckResult` | Doc-tree health + INDEX.md integrity checks |
| `scripts/checks/gate-content-contract.check.ts` | `read`, `CheckResult` | R-003 Gate Content Contract checks |
| `scripts/checks/gemini-build.check.ts` | `root`, `read`, `CheckResult` | Gemini build output checks |
| `scripts/checks/ground-truth.check.ts` | `root`, `read`, `CheckResult` | Ground-truth / SSOT checks |
| `scripts/checks/hooks.check.ts` | `root`, `CheckResult` | PreToolUse hook gate checks |
| `scripts/checks/jq-empty-guard.check.ts` | `root`, `CheckResult` | `jq empty`-as-sufficient-guard prescription checks |
| `scripts/checks/links.check.ts` | `root`, `read`, `CheckResult` | Markdown link integrity checks |
| `scripts/checks/parity-matrix.check.ts` | `root`, `CheckResult` | Platform parity matrix checks |
| `scripts/checks/plan-quality-gate.check.ts` | `root`, `read`, `CheckResult` | Plan quality gate checks |
| `scripts/checks/playbook.check.ts` | `root`, `read`, `CheckResult` | Playbook / phase doc checks |
| `scripts/checks/queue-coherence.check.ts` | `root`, `CheckResult` | Live `.blackhole/queue.json` coherence checks |
| `scripts/checks/schema.check.ts` | `root`, `read`, `CheckResult` | JSON schema checks |
| `scripts/checks/single-writer.check.ts` | `read`, `CheckResult` | Single-writer invariant checks |
| `scripts/checks/stop-mode.check.ts` | `read`, `CheckResult` | Campaign stop-mode gate checks |
| `scripts/checks/test-integrity.check.ts` | `read`, `CheckResult` | Test integrity checks |
| `scripts/checks/vocabulary.check.ts` | `root`, `CheckResult` | Vocabulary / naming checks |
| `scripts/checks/worker-git-safety.check.ts` | `read`, `CheckResult` | Worker git safety checks |
| `scripts/verify.ts` | `CheckResult` (type only) | Thin runner — `runVerifyChecks()`, exit-code helpers |

**Count:** 30 `*.check.ts` domain modules + `verify.ts` = **31** direct `CheckResult` consumers.

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
| Rename / remove `CheckResult` field | BREAKING | All 31 direct consumers + verify output formatting |
| Change `runChecks()` return type away from `CheckResult[]` | BREAKING | `verify.ts` + every `*.check.ts` |
| Move `CheckResult` to another module | BREAKING | All import sites (grep `check-utils`) |
| Change `root` path resolution | BREAKING | All 30 checks + `check-common.ts` |
| Change `read()` encoding or path join | BREAKING | Modules importing `read()` — see the `Imports` column in the consumer table above |

**Overall blast radius:** HIGH — `CheckResult` is the shared verify wire format across the
entire `scripts/checks/` domain split (ADR-007 T5/R2').

## Maintenance

Reconcile this table after:

- Adding or removing a `scripts/checks/*.check.ts` module
- Changing any `from './check-utils.ts'` or `from '../checks/check-utils.ts'` import
- Altering the `CheckResult` type or `runChecks()` contract

```bash
rg "from ['\"].*check-utils" scripts --glob '!wt-*'
```

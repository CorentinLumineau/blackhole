---
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-04
last_updated: 2026-09-04
---

# Plan - Issue #787

## Objective
`V-TEST-09` (coverage-regression on changed files, BLOCK) is structurally unmeasurable for any
file under `templates/hooks/**` — those modules execute only inside a subprocess spawned by
`runPreToolUseHook` (`scripts/hooks-validate-file.test.ts`), so `bun test --coverage` never
instruments them. The gate does not fail loudly on this — it produces no coverage delta at all —
and a worker that doesn't check carefully can report `V-TEST-09: pass`, a false assurance on a
BLOCK-severity gate. This plan closes the reporting-accuracy gap end-to-end, without touching the
instrumentation problem itself:

1. `implementer.md`'s Coverage-regression gate step must state the carve-out and require
   `unmeasurable` (never `pass`) when the diff's only changed source is under `templates/hooks/**`.
2. `reviewer.md` gains a judgment audit: a worker/PR claim of `V-TEST-09: pass` on a
   hooks-only diff is itself a `BLOCK` finding.
3. An `unmeasurable` report must carry real evidence (e.g. end-to-end behavioral test-case count
   before/after), never an empty field.
4. A new advisory (WARN, never blocking) mechanical check backstops the judgment audit.
5. Instrumenting `templates/hooks/**` itself stays explicitly out of scope — logged, not built.

No new V-code — this is a reporting-accuracy fix to the existing `V-TEST-09`. Precedent: this
campaign's own implementer already self-reported informally this way on PR #816/issue #729
("Coverage-regression gate: `bun test --coverage` does not instrument
`templates/hooks/pretooluse/*.js` ... no-runner degradation, logged here rather than silently
treated as a pass") — this plan formalizes that pattern rather than inventing a new one.

## Touch-Paths
- `src/agents/implementer.md` plus all generated dist trees per `scripts/lib/build/targets.ts`
- `src/agents/reviewer.md` plus all generated dist trees per `scripts/lib/build/targets.ts`
- `src/references/blackhole-vcodes.md` plus all generated dist trees per `scripts/lib/build/targets.ts`
- `scripts/checks/coverage-regression.check.ts`
- `scripts/verify.coverage-regression.test.ts`
- `scripts/checks/v-test09-hooks-claim.check.ts` (new)
- `scripts/v-test09-hooks-claim.ts` (new)
- `scripts/verify.v-test09-hooks-claim.test.ts` (new)

## Documentation Impact
`src/references/blackhole-vcodes.md`'s `V-TEST-09` row's "Primary enforcement site" column gains
a citation to the new `reviewer.md` §30 audit — that file is already in Touch-Paths above, so
this is not a new file. No `documentation/` tree file needs updating: this is an internal
agent-behavior / reporting-accuracy fix, not a change to a public API, schema, or user-facing
surface. AC5 (instrumenting the hooks) is out of scope and must be surfaced by the implementer as
a `new_findings` entry in its return so the orchestrator can log it in `findings-ledger.json` as
a deferred concern.

## Task Breakdown
- [ ] **TDD Baseline Verification**: Run `bun test` and `bun run verify` before any edit. — **AC**:
  baseline pass/fail counts quoted in the completion evidence.
- [ ] **[AC1] implementer.md carve-out**: state coverage is unmeasurable for `templates/hooks/**`
  files and MUST be reported as `unmeasurable`, never `pass`. — **AC**: `grep -n "unmeasurable"
  src/agents/implementer.md` finds it inside the Coverage-regression gate bullet.
- [ ] **[AC3] Evidence requirement**: require an `unmeasurable` report state real verification
  evidence (e.g. behavioral test-case count before/after). — **AC**: non-empty evidence citation
  required by the new sentence.
- [ ] **Grounding sync**: extend `IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS` in
  `scripts/checks/coverage-regression.check.ts` and its fixture test. — **AC**:
  `bun test scripts/verify.coverage-regression.test.ts` passes.
- [ ] **[AC2] reviewer.md §30 judgment audit**: a `pass` claim on a hooks-only diff is a `BLOCK`
  finding (`V-TEST-09`). — **AC**: `grep -n "V-TEST-09 Hooks-Claim Audit" src/agents/reviewer.md`.
- [ ] **[AC4] Mechanical advisory check**: new `scripts/checks/v-test09-hooks-claim.check.ts` +
  CLI wrapper `scripts/v-test09-hooks-claim.ts`, `ok` always `true` (non-blocking). — **AC**:
  `bun run scripts/v-test09-hooks-claim.ts ...` prints `"ok": true` with `detail` when flagged.
- [ ] **Tests**: `scripts/verify.v-test09-hooks-claim.test.ts`. — **AC**: green.
- [ ] **blackhole-vcodes.md citation**: append reviewer.md §30 to the enforcement-site cell. —
  **AC**: `grep -n "reviewer.md §30" src/references/blackhole-vcodes.md`.
- [ ] **[AC5] Out-of-scope statement**: PR body states instrumenting the hooks is out of scope. —
  **AC**: phrase present in PR description.
- [ ] **Full verification**: `bun run build`, `bun run verify`, full `bun test` suite. — **AC**:
  quoted pass counts, all checks passing.

---
type: plan
summary: "Test-only fix: enum-source LOCAL_CONST_NAME_BY_MEMBERS collision-drop path gains regression coverage, gated on WAIVABLE_ENUMS surviving future collisions"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
related: [documentation/reference/decision-log.md]
---


# Plan - Issue #883

## Objective
`scripts/lib/worker-json/enum-source.ts:96-127` builds `LOCAL_CONST_NAME_BY_MEMBERS` — a
reverse lookup from a joined member-list string back to the local `constants.ts` export name
that declares it — and deliberately drops (deletes) **both** names when two exported constants
share an identical member list (the `ambiguous` set loop, lines ~118-126). This drop-both
behavior is intentional and documented in the comment directly above it, and it stays exactly
as-is: **this issue adds test coverage only, it does not change production behavior.**

Verified against `origin/main` (`git show origin/main:scripts/lib/worker-json/enum-source.ts`,
`enum-source.test.ts`): the test file has zero matches for
`collision|ambiguous|LOCAL_CONST_NAME_BY_MEMBERS`, so the collision-drop path — and in
particular whether it can ever silently swallow a `WAIVABLE_ENUMS`-allowlisted constant — is
completely unexercised today. `WAIVABLE_ENUMS = new Set(['COMPANION_REPAIR_VCODES'])`
(`enum-source.ts:96`) is the fail-closed allowlist that PR #854's seven security review
iterations hardened against RCE, waiver bypass, and discriminator smuggling (F-00048/F-00049/
F-00060/F-00062 in that PR's review history). A future `constants.ts` addition whose member
list happens to collide with `COMPANION_REPAIR_VCODES`'s (`['V-ADA-01','V-ADA-05','V-ADA-09']`)
would silently make that entry `ambiguous`, drop it from the map, and make
`waiveWidenedEnumErrors` treat every `COMPANION_REPAIR_VCODES` error as non-waivable from then
on — silently killing the widened-enum feature for that constant with no test ever noticing.

## Threat Escalation Check (V-THREAT-01)
`route.security_review_required: true` combined with `route.plan_mode: quick` triggers the
plan-time threat escalation check (mandatory per `planner.md` Quick Track). Screen result:

| # | Question | Answer |
|---|----------|--------|
| 1 | Does this change touch auth/authz? | No — `enum-source.ts` governs worker-JSON schema validation, not authentication/authorization |
| 2 | Does it read or write user data? | No — it operates on statically-declared `as const` arrays in a source file, no user data in scope |
| 3 | Does it add or modify an endpoint? | No — no endpoint of any kind exists in this module |

All three **No** → Quick Track stands, no escalation to Standard Track.
`threat_screen_passed: true` stamped in frontmatter above.

This disposition is orthogonal to the fact that `enum-source.ts` is itself a
security-hardened trust boundary (PR #854) — that boundary determines *why the file matters*,
not *whether this specific diff (test-only, plus one `export` keyword) touches auth/authz,
user data, or an endpoint*. It does not.

## Non-Goals (binding constraint, not advisory)
- **No production behavior change in `enum-source.ts`.** The collision-drop (`ambiguous` set)
  logic, `waiveWidenedEnumErrors`, `extractEnumArrays`, and every other function's control flow
  are untouched byte-for-byte except the one line noted under Touch-Paths.
- An implementer discovering the real `IMPLEMENTER_STATUSES`/`INVESTIGATOR_STATUSES` collision
  (see Task Steps) must **not** "fix" it by renaming one constant, picking one of the colliding
  names, or otherwise changing which name the map resolves to. That collision is pre-existing,
  intentional (per the file's own docstring, `enum-source.ts:103-108`), and orthogonal to this
  issue. Touching it is out of scope — a Touch-Paths violation (`V-SCOPE-02`) if attempted.

## Touch-Paths
- `scripts/lib/worker-json/enum-source.test.ts` — new test cases (primary Touch-Path)
- `scripts/lib/worker-json/enum-source.ts` — **exactly one line**: add the `export` keyword to
  the existing `const LOCAL_CONST_NAME_BY_MEMBERS: ReadonlyMap<string, string> = (() => { ... })();`
  declaration (currently module-private, `enum-source.ts:111`). This is the only way to make the
  real, statically-built map observable to a test without duplicating its construction logic in
  the test file (which would test a copy, not the production map — exactly the trap AC #2 below
  exists to avoid). No other line in this file changes.

## Documentation Impact
`documentation/` search performed (grep for `enum-source|LOCAL_CONST_NAME_BY_MEMBERS` across
`documentation/`): only `documentation/reference/decision-log.md` mentions `enum-source.ts`
(PR #854 decision-log rows, unrelated to this test-only diff). No doc describes this module's
test coverage or its internal map. **None — test-only diff, no consumer-facing behavior,
API, or schema changes; nothing under `documentation/` requires updating.**

## Task Steps

- [ ] **TDD Baseline Verification**: Run `bun test scripts/lib/worker-json/` to confirm the
  existing suite is green before any change. — **AC**: baseline run reported, pass/fail counts
  quoted in the completion evidence.

- [ ] **Write Failing Tests (AC #1 — mechanism regression, real pre-existing collision)**: In
  `enum-source.test.ts`, import `LOCAL_CONST_NAME_BY_MEMBERS` from `./enum-source.ts` (not yet
  exported — this import fails to resolve until the next step lands, which is the TDD-red state
  for this otherwise-mechanical change) and assert that the real, already-existing collision
  between `IMPLEMENTER_STATUSES` and `INVESTIGATOR_STATUSES`
  (`scripts/lib/worker-json/constants.ts:10,24` — both `['complete','blocked','error','partial']`,
  documented at `enum-source.ts:103-108`) leaves **neither** name resolvable:
  `LOCAL_CONST_NAME_BY_MEMBERS.get('complete|blocked|error|partial')` is `undefined`, and
  `Array.from(LOCAL_CONST_NAME_BY_MEMBERS.values())` contains neither `'IMPLEMENTER_STATUSES'`
  nor `'INVESTIGATOR_STATUSES'`. — **AC**: test fails to import/compile before the export lands;
  after the export lands (next step) it passes, confirming drop-both semantics on a real,
  already-present collision. **State plainly: this AC alone is insufficient regression coverage**
  — it pins already-intentional behavior on a pair that isn't security-relevant and would keep
  passing under a hypothetical regression that swallows a *different*, security-relevant entry
  (see AC #2).

- [ ] **Write Failing Tests (AC #2 — the load-bearing assertion)**: Assert, against the real
  `LOCAL_CONST_NAME_BY_MEMBERS` map (imported, never a hand-built mock or a re-implementation
  of the collision-detection loop), that every member of `WAIVABLE_ENUMS` is a key of that map:
  `for (const name of WAIVABLE_ENUMS) { expect(LOCAL_CONST_NAME_BY_MEMBERS.has(name)).toBe(true); }`
  (equivalently, assert `Array.from(WAIVABLE_ENUMS).every(n => LOCAL_CONST_NAME_BY_MEMBERS.has(n))`
  is `true`). — **AC**: this assertion is falsifiable, and MUST be run as its own test, not
  folded into or dropped as "redundant with AC #1" — the falsifiability difference between the
  two ACs is the entire point of this issue and is specified below.

- [ ] **Export `LOCAL_CONST_NAME_BY_MEMBERS`**: Add the `export` keyword to its declaration in
  `enum-source.ts` (see Touch-Paths). — **AC**: `git diff scripts/lib/worker-json/enum-source.ts`
  shows exactly one changed line (`const` → `export const`); both AC #1 and AC #2 tests now pass.

- [ ] **Verify Integrity**: Run the full test suite and lint/typecheck. — **AC**: full suite
  green, lint/typecheck clean, both quoted in the completion evidence; `git diff --stat` shows
  changes in only the two Touch-Paths files.

## Falsifiability Specification — AC #1 vs AC #2 (why both are required)

**AC #1 is necessary but insufficient on its own.** It exercises the collision-drop mechanism
using a pair of constants (`IMPLEMENTER_STATUSES`/`INVESTIGATOR_STATUSES`) that already collide
on `origin/main` *today*, under both the current correct behavior and under the regression this
issue exists to prevent. A future change that adds a *new* collision colliding with some
*other*, unrelated constant would leave AC #1 green — AC #1 says nothing about `WAIVABLE_ENUMS`
at all. An implementer or reviewer must not treat AC #1 as covering the security-relevant case;
it covers only "the drop-both mechanism itself still drops both names for a pair that already
collides."

**AC #2 is the falsifiable, load-bearing assertion.** It flips from passing to failing the
moment a future `constants.ts` change introduces a new exported `as const` array whose member
list textually matches any `WAIVABLE_ENUMS` entry's member list (today, only
`COMPANION_REPAIR_VCODES = ['V-ADA-01','V-ADA-05','V-ADA-09']`). Concretely, if a future PR adds:

```ts
// hypothetical future constants.ts addition
export const SOME_NEW_ENUM = ['V-ADA-01', 'V-ADA-05', 'V-ADA-09'] as const;
```

then `LOCAL_CONST_NAME_BY_MEMBERS`'s build loop finds the key `'V-ADA-01|V-ADA-05|V-ADA-09'`
already bound to `'COMPANION_REPAIR_VCODES'`, adds it to the `ambiguous` set, and deletes it —
`LOCAL_CONST_NAME_BY_MEMBERS.has('COMPANION_REPAIR_VCODES')` becomes `false`. AC #2's assertion
then fails with an output shaped like:

```
expect(received).toBe(expected)
Expected: true
Received: false
  at WAIVABLE_ENUMS member "COMPANION_REPAIR_VCODES" — LOCAL_CONST_NAME_BY_MEMBERS.has(...)
```

This is the same flip PR #854's review iteration 7 demonstrated by hand — reproducible, not
hypothetical. **An implementer must not drop AC #2 as "redundant with AC #1"** — they test
disjoint failure modes (mechanism-still-works vs. security-allowlist-still-resolvable), and only
AC #2 pins the invariant this issue was filed to protect. Both tests are required; neither
substitutes for the other.

## Sprint Contract
- AC #1 (mechanism regression on a real pre-existing collision) — PASS required, but understood
  as insufficient alone; see Falsifiability Specification.
- AC #2 (WAIVABLE_ENUMS ⊆ keys(LOCAL_CONST_NAME_BY_MEMBERS), real map) — PASS required; this is
  the security-relevant, load-bearing assertion this issue exists to add.
- Export-only diff constraint — PASS required (`git diff --stat` shows only the two Touch-Paths
  files changed, and `enum-source.ts`'s diff is exactly one line).
- Full suite + lint/typecheck green — PASS required (definition of done for all remaining,
  non-AC-bearing steps).

## Quality Gate Results (CLI, advisory on Quick Track — see note)
Quick Track carries neither `## Task Breakdown` nor `## Critical Files` nor
`## Execution Strategy & Stop Conditions` (it uses `## Task Steps` instead, per
`planner.md` § Plan Complexity Tracks & Sections), so `scripts/plan-quality-gate.ts`'s three
checks are structurally inert here (section-presence gating, not track-gating —
`planner.md` Step 8's "mercure parity" note) — they report `true` because their source section
is absent, not because Quick Track is exempted. Run and reported below per explicit request:

| Check | Result |
|---|---|
| `ac_mapping` | PASS (advisory — no `## Task Breakdown` section on Quick Track) |
| `critical_files_exist` | PASS (advisory — no `## Critical Files` section on Quick Track) |
| `mitigation_concrete` | PASS (advisory — no `## Execution Strategy & Stop Conditions` section on Quick Track) |

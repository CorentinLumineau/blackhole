---
type: plan
summary: "Adds an optional verification_mode field and verification_legs[] array to the reviewer JSON contract (ADR-036) so a review can disclose executed-vs-reasoned verification, including for a clean investigation leg that produces no finding"
status: current
review_trigger: "on file change"
created: 2026-09-04
last_updated: 2026-09-04
---

# Plan - Issue #815

## Objective

Implement ADR-036 (`documentation/decisions/ADR-036-executed-vs-reasoned-verification.md`,
staged, not yet carried — `.blackhole/staged/815/`): give the `reviewer` a structural, schema-level
way to disclose that a finding or an investigation direction was verified by **reasoning**
(static analysis / code-reading) rather than by **execution** (a probe or test actually ran), and
surface a `reasoned` disclosure at the merge decision on security-mode PRs — never as grounds to
bypass `with-test-lock` (AC4, unchanged).

Two additive, optional JSON shapes on the reviewer contract:
1. `verification_mode: "executed" | "reasoned"` — optional field on the shared `Finding` shape.
2. `verification_legs: [{ direction, mode, evidence }]` — new optional top-level array, sibling to
   `recheck[]`/`verification[]`, giving a **clean/negative investigation leg** (one that produces
   no `Finding` object) a JSON home to disclose into — the structural gap AC2 names.

This is the Standard Track plan for the design already accepted at
`.blackhole/plans/issue-815-design.md` under `resume_context: design_approved` — the design
question (Option A vs. B vs. C) is settled and out of scope here; do not re-litigate it.

## Touch-Paths

Source files (`src/**`) — plus all generated dist trees per `scripts/lib/build/targets.ts`:
- `src/references/worker-schemas.md` — § Reviewer contract + `### Finding shape (shared)`.
- `src/references/review-core.md` — § Security-mode review (new step) + § LGTM definition
  (new condition).
- `src/references/blackhole-vcodes.md` — new `V-SEC-12` row.
- `src/agents/reviewer.md` — new numbered section instructing the reviewer how/when to author
  `verification_mode` and `verification_legs[]`; `## Output Format` example update.

Non-generated implementation files:
- `scripts/lib/worker-json/constants.ts` — new `VERIFICATION_MODES` enum constant.
- `scripts/lib/worker-json/shared-validators.ts` — `validateFinding` gains optional
  `verification_mode` enum check; new `validateVerificationLegEntry` /
  `validateVerificationLegsArray` (mirrors `validateVisualEvidenceEntry`/`...Array` shape,
  `V-DRY-01`).
- `scripts/lib/worker-json/validators/reviewer.ts` — wires `verification_legs` into
  `validateReviewer` as an optional field.
- `scripts/checks/ledger-schema.check.ts` — `findLedgerSchemaDrift` gains a `verification_mode`
  enum check on ledgered rows (`V-LEDGER-01`), importing `VERIFICATION_MODES` from
  `scripts/lib/worker-json/constants.ts` rather than re-declaring the enum (`V-DRY-01`).

Test files:
- `scripts/validate-worker-json.test.ts` — new cases under `describe('validateWorker reviewer', ...)`.
- `fixtures/worker-json/reviewer-complete-verification-mode-executed.json` (new)
- `fixtures/worker-json/reviewer-invalid-verification-mode-bad-enum.json` (new)
- `fixtures/worker-json/reviewer-complete-verification-legs.json` (new)
- `fixtures/worker-json/reviewer-invalid-verification-legs-missing-evidence.json` (new)
- `scripts/verify.ledger-schema.test.ts` — new cases under `describe('findLedgerSchemaDrift', ...)`
  and `describe('checkLedgerSchema ...', ...)`.

No `[NEEDS CLARIFICATION]` markers — the design gate already resolved the only open question
(field naming/shape) via ADR-036.

**Hot-file note**: `src/references/blackhole-vcodes.md` is in `config.json`
`wave_scheduling.hot_files_max_one_per_wave` — this is a single-PR issue so no in-wave contention
is expected, but the orchestrator should not schedule a second `blackhole-vcodes.md`-touching PR
in the same wave as this one.

## Documentation Impact (`docs_governance.enabled: true`)

`None — this change is entirely schema/validator/check-module code plus its own src/ build
sources (worker-schemas.md, review-core.md, blackhole-vcodes.md, reviewer.md), which are not
`documentation/` companion docs. The durable `documentation/` artifact for this change is
ADR-036 + its `documentation/decisions/INDEX.md` row — already staged by the Design Track
(`.blackhole/staged/815/manifest.json`) and explicitly out of this plan's scope per the spawn
instruction ("do not restage the already-staged ADR/INDEX entries"); it is carried by
`implementer`'s § Carry Staged Artifacts step, not by a task in this plan. Grepped
`documentation/` for an existing canonical doc describing the reviewer JSON contract or the
ledger schema (search-before-write, `doc-governance.md`) — none exists; `worker-schemas.md` and
`blackhole-vcodes.md` (both `src/references/`) are the only living descriptions of these shapes.

## Critical Files

None. `scripts/checks/ledger-schema.check.ts` is an existing, already-`git`-tracked file being
extended (not created), but it is not a "highly sensitive pre-existing touchpoint" in the
database-client/auth-config sense this section is for — routine validator/check-module code.

## Codebase Conventions

No `plans/issue-815-analysis.md` analyze note exists (confirmed: `.blackhole/plans/` has only
`issue-815-design.md` for this issue) — falls back to independent codebase discovery per Step 3,
unchanged from current behavior. Conventions found directly:

| Concern | Convention | Evidence |
|---|---|---|
| Sibling optional top-level array on reviewer contract | `recheck[]` / `verification[]`, both `{finding_id, verdict, evidence}`-shaped, documented under `## Reviewer` in `worker-schemas.md` with a dedicated `### <name>` subsection below the JSON block | `worker-schemas.md:433-489` |
| Optional-array validator shape | `validate<X>Entry` (returns `string[]`, path-prefixed) + `validate<X>Array` (thin wrapper over `validateArrayOf`) | `scripts/lib/worker-json/shared-validators.ts:115-144` (`validateVisualEvidenceEntry`/`...Array`) |
| Optional-enum-field-on-an-object check | `if (isString(x.field)) pushEnumError(...)` — checked only when the field is a string, never `requireField` (field itself stays optional) | `shared-validators.ts:46-48` (`finding.severity` is required here, but the `isString` + `pushEnumError` pairing is the reusable idiom; `validateVerificationLegEntry`'s `mode` field reuses it identically) |
| Enum constant ownership | One `SCREAMING_SNAKE_CASE` `as const` array per enum in `scripts/lib/worker-json/constants.ts`, imported everywhere the enum is checked — never re-declared inline | `constants.ts:15,34-35` (`SEVERITIES`, `HUNTER_SEVERITIES`, `HUNTER_VERIFICATIONS`) |
| Ledger-schema check optional-key pattern | `'key' in row && !isValid(row.key)` — absent key is never drift, only a present-but-malformed value is | `scripts/checks/ledger-schema.check.ts:39-43` |
| Documented (non-scripted) merge-gate validator | Numbered step under `review-core.md` § Security-mode review + a matching numbered condition under § LGTM definition, citing the V-code by name | `review-core.md:35,137-140` (`V-SEC-08`) |
| Reviewer behavioral section for a new field | One `### N. <Title> (\`V-CODE\`, ...)` numbered section in `reviewer.md`, appended after the last existing section rather than renumbering | `reviewer.md:538` (`### 24. Independent Security Verification Mode`) is the most recent precedent |
| Naming discipline | `verification` is already claimed twice (`reviewer`'s own `verification[]` recheck array; `hunter`'s per-finding `CONFIRMED\|STALE` field, `scripts/lib/worker-json/validators/hunter.ts:39-42`) — this plan's new names (`verification_mode`, `verification_legs`) are ADR-036-settled and must be used verbatim, never `verification` bare |

## Threat Model (`route.security_review_required: true`, `route.confidence.security: 90` ≥ threshold 70)

| Threat (STRIDE) | Description | Severity | Mitigation status |
|---|---|---|---|
| Spoofing | N/A — no new identity/auth surface introduced. | Low | Mitigated (out of scope by construction) |
| Tampering | A reviewer could tamper with the meaning of a security finding's absence by mislabeling a `reasoned` leg as `executed`. | Medium | Accepted Risk — self-report trust model, explicitly named as a domain-inherent ceiling by both Design Track critics (design note §7 #1) and by ADR-032/`V-TEST-11`; no schema change can close this, only independent re-verification (out of scope for this issue). |
| Repudiation | None new — `verification_legs[]` is read directly from the reviewer's raw JSON return by the merge-gate step, same non-repudiation posture as every other reviewer-authored field. | Low | Mitigated |
| Information Disclosure | None — no new field carries secrets; `evidence` strings are the same free-text shape already used by `recheck[]`/`verification[]`. | Low | Mitigated |
| Denial of Service | A malformed `verification_legs[]` entry could, if unvalidated, cause a downstream consumer to throw. Closed by adding a real validator (`validateVerificationLegsArray`) rather than accepting the array unchecked. | Medium | Mitigated — Task 2 below adds validation before this ships. |
| Elevation of Privilege | N/A — no new privilege boundary. | Low | Mitigated (out of scope by construction) |

No HIGH/CRITICAL-severity threat in this table — `V-THREAT-02` is satisfied vacuously (no
HIGH/CRITICAL row requires escalation beyond what Task 2/5 already do). All six STRIDE categories
evaluated (`V-THREAT-03`).

## Dependency Blast-Radius

Re-grepped at plan time (not trusted from the design note verbatim) — every consumer of the
`Finding`/ledger-row shape that this plan's interface changes could affect:

| Consumer | file:line | Classification | Note |
|---|---|---|---|
| `validateFinding` / `validateReviewer` | `scripts/lib/worker-json/shared-validators.ts:36`, `scripts/lib/worker-json/validators/reviewer.ts:5` | TRANSPARENT | No `additionalProperties:false` guard on either function; `verification_mode`/`verification_legs` are purely additive optional checks. |
| `checkLedgerSchema` / `findLedgerSchemaDrift` | `scripts/checks/ledger-schema.check.ts:32,56` | TRANSPARENT | Only inspects `issue_ref`/`pr_ref`/legacy `pr` today; the new `verification_mode` check is additive, gated on `'verification_mode' in row`. |
| `promote-review-artifact.ts` | `scripts/lib/promote-review-artifact.ts:9,51,90,121-145` | TRANSPARENT | `LedgerFinding` type reads only `vcode`/`file`/`line`/`severity`/`summary`/`pr_ref`/`recheck`/`status`/`deferred_to_issue` by name; a new field is simply not read, not broken (verified by direct read, not by re-trusting the design note). |
| `LedgerFinding` type (campaign-status) | `scripts/lib/campaign-status/types.ts:37-45` | TRANSPARENT | Structural TS type reads only its 7 declared fields; extra JSON keys on a ledger row are inert to it. |
| `migrate-ledger-schema.ts` | `scripts/migrate-ledger-schema.ts:71-74` | TRANSPARENT | Explicitly spreads `const { pr: _legacyPr, ...rest } = row` before reconstructing — verified directly: any new field on `row` survives into `out` untouched. |
| `triage-deferred-findings.ts` | `scripts/triage-deferred-findings.ts:16-18,61-63` | TRANSPARENT | Reads only `vcode`/`file`/`status` for text matching against issue titles/bodies. |
| `deferred-reconciliation.check.ts` | `scripts/checks/deferred-reconciliation.check.ts:17-21,36-48` | TRANSPARENT | Reads only `vcode`/`status`/`id`/`deferred_to_issue`/`file`. |
| `review-core.md` § LGTM definition / § Security-mode review | `src/references/review-core.md:28-35,110-140` | TRANSPARENT | Gains one new documented step (§ Security-mode review) and one new numbered condition (§ LGTM definition); existing conditions 1-4 and steps 1-6 are unchanged in shape. |

7 consumer groups, all TRANSPARENT, zero BREAKING — confirms the design note's Refactoring Impact
Analysis (§6) independently. Meets the "3+ affected consumers" trigger for this section
(`V-SCOPE-03`).

## Task Breakdown

Each task follows red-then-green TDD (`mercure-quality-gates.md`): write the failing test first,
confirm it fails for the stated reason, then implement to green. Per this session's own
V-TEST-11 standard (a check that can't demonstrate it would fail on a malformed input is itself
an unfalsifiable control, the #808/ADR-035 pattern), every new/extended check test below must
include at least one case that fails against the **pre-change** code and passes only after the
implementation step.

### Task 1 — `VERIFICATION_MODES` enum constant
- Add `export const VERIFICATION_MODES = ['executed', 'reasoned'] as const;` to
  `scripts/lib/worker-json/constants.ts`, alongside `HUNTER_VERIFICATIONS` (same enum-constant
  convention, `V-DRY-01`).
- **AC**: `scripts/lib/worker-json/constants.ts` exports `VERIFICATION_MODES` with exactly the
  two string values `"executed"` and `"reasoned"`, importable from both
  `shared-validators.ts` and `scripts/checks/ledger-schema.check.ts`.

### Task 2 — `verification_mode` on the shared Finding validator
- **Red**: add to `scripts/validate-worker-json.test.ts` under `describe('validateWorker
  reviewer', ...)`:
  - `expectValid('reviewer', 'reviewer-complete-verification-mode-executed.json')` — a finding
    carrying `verification_mode: "executed"`.
  - `expectInvalid('reviewer', 'reviewer-invalid-verification-mode-bad-enum.json')` — a finding
    carrying `verification_mode: "guessed"`.
  - Also assert a finding with **no** `verification_mode` key still validates (backward
    compatibility) — reuse `reviewer-complete-empty.json`'s existing pass as the regression
    guard; no new fixture needed for this leg.
  Run the suite now: the two new fixtures do not yet exist / the enum check does not yet run —
  both new tests must fail (or error on missing fixture) before the implementation step.
- **Green**: in `scripts/lib/worker-json/shared-validators.ts`, import `VERIFICATION_MODES` from
  `./constants.ts`; in `validateFinding`, after the existing `severity` block, add:
  ```ts
  if ('verification_mode' in finding && isString(finding.verification_mode)) {
    pushEnumError(errors, `${path}.verification_mode`, finding.verification_mode, VERIFICATION_MODES);
  } else if ('verification_mode' in finding) {
    errors.push(`${path}.verification_mode: expected string`);
  }
  ```
  Create the two fixture files under `fixtures/worker-json/` (see Touch-Paths).
- **AC**: `bun test scripts/validate-worker-json.test.ts` is green; the added test for
  `reviewer-invalid-verification-mode-bad-enum.json` fails against the pre-Task-2 validator
  (verified by running it before the `shared-validators.ts` edit) and passes after.

### Task 3 — `verification_legs[]` validator
- **Red**: add to `scripts/validate-worker-json.test.ts`:
  - `expectValid('reviewer', 'reviewer-complete-verification-legs.json')` — `verification_legs`
    array with one well-formed `{direction, mode, evidence}` entry, `mode: "reasoned"`.
  - `expectInvalid('reviewer', 'reviewer-invalid-verification-legs-missing-evidence.json')` — an
    entry missing `evidence`.
  - Confirm both fail before the validator wiring exists (`verification_legs` is currently
    unvalidated — any value passes today, so the invalid fixture must be shown to pass silently
    pre-change, then fail post-change).
- **Green**: in `scripts/lib/worker-json/shared-validators.ts`, add (below
  `validateVisualEvidenceArray`, same file-position convention as the other paired
  entry/array validators):
  ```ts
  export function validateVerificationLegEntry(entry: unknown, path: string): string[] {
    const errors: string[] = [];
    if (!isObject(entry)) {
      errors.push(`${path}: expected object`);
      return errors;
    }
    requireField(errors, entry, 'direction', isNonEmptyString, 'non-empty string');
    requireField(errors, entry, 'mode', isString, 'string');
    if (isString(entry.mode)) {
      pushEnumError(errors, 'mode', entry.mode, VERIFICATION_MODES);
    }
    requireField(errors, entry, 'evidence', isNonEmptyString, 'non-empty string');
    return errors.map((error) => `${path}.${error}`);
  }

  export function validateVerificationLegsArray(value: unknown, path: string): string[] {
    return validateArrayOf(value, path, validateVerificationLegEntry);
  }
  ```
  In `scripts/lib/worker-json/validators/reviewer.ts`, import
  `validateVerificationLegsArray` and add, after the existing `findings` check:
  ```ts
  if ('verification_legs' in data) {
    errors.push(...validateVerificationLegsArray(data.verification_legs, 'verification_legs'));
  }
  ```
  Create the two fixture files.
- **AC**: `bun test scripts/validate-worker-json.test.ts` is green; a `verification_legs` entry
  missing `direction`, `mode`, or `evidence`, or carrying an invalid `mode` enum value, is
  rejected; absence of `verification_legs` entirely still validates (regression: rerun
  `reviewer-complete-empty.json` and `reviewer-partial.json` cases, unchanged green).

### Task 4 — `worker-schemas.md` § Reviewer contract documentation
- Add a `verification_legs` row to the `## Reviewer` field table (`worker-schemas.md:442-448`),
  a `### verification_legs (optional — ...)` subsection modeled on `### verification (optional —
  ...)` (`worker-schemas.md:468-489`), and a `verification_mode` line in `### Finding shape
  (shared)` (`worker-schemas.md:499-513`) documenting the two enum values and that absence means
  "no claim made" (backward compatible).
- Update the `## Reviewer` example JSON block (`worker-schemas.md:421-440`) to show one finding
  with `verification_mode` and one top-level `verification_legs` entry, matching the shape now
  accepted by Task 2/3's validators exactly (no doc/validator drift).
- **AC**: every field name and enum value in the new doc prose matches the validator code
  byte-for-byte (`verification_mode`, `verification_legs`, `direction`, `mode`, `evidence`,
  `"executed"`, `"reasoned"`) — grep `worker-schemas.md` and
  `scripts/lib/worker-json/{constants,shared-validators}.ts` for `verification_mode`/
  `verification_legs` and confirm identical spelling.

### Task 5 — `reviewer.md` authoring instructions
- Add a new `### 29. Executed vs. Reasoned Verification Disclosure (ADR-036)` section (after the
  existing `### 28.` — confirm the current last section number at implementation time via
  `grep -n '^### [0-9]' src/agents/reviewer.md | tail -1`, since other in-flight issues this
  campaign may have already appended `### 29`; number sequentially after whatever is last) that
  instructs the reviewer to:
  - Set `verification_mode: "executed"` on a finding backed by a probe/test that actually ran;
    `"reasoned"` on one backed by static analysis / code-reading only; omit the field when the
    distinction genuinely does not apply (e.g. a pure documentation-prose finding).
  - For each investigation direction from the security-mode attack-signature scan
    (`review-core.md` § Security-mode review step 3) that produced **no** finding, emit one
    `verification_legs[]` entry — `direction` (a short label for what was checked), `mode`
    (`"executed"` if a probe ran, `"reasoned"` if not), `evidence` (what was checked and, for
    `"reasoned"`, why execution was unavailable — e.g. `with-test-lock` contention). This is the
    structural fix for AC2: a clean leg no longer relies on free prose to disclose its basis.
  - Explicitly restate AC4: this disclosure is never grounds to skip or bypass
    `with-test-lock` — a contended lock still means `"reasoned"`, never a reason to force the
    lock or use an unlocked path.
- Update `## Output Format` (`reviewer.md:817-877`) example JSON and its two explanatory
  paragraphs to include `verification_mode` on one finding and a `verification_legs` array,
  mirroring the `worker-schemas.md` Task 4 example verbatim (single source of truth for the
  example content is `worker-schemas.md`; `reviewer.md`'s copy must match it, not diverge).
- **AC**: the new section names both `verification_mode` and `verification_legs` explicitly,
  states the `with-test-lock` non-bypass rule in its own text (not just by cross-reference), and
  the `## Output Format` example round-trips through `bun run scripts/validate-worker-json.ts`
  (or `validateReviewer` directly) without errors.

### Task 6 — `V-SEC-12` row in `blackhole-vcodes.md`
- Insert a new row immediately after the existing `V-SEC-11` row
  (`src/references/blackhole-vcodes.md:43`):
  `| V-SEC-12 | Merge-gate surfacing — on a security-mode PR, any \`verification_legs[]\` entry with \`mode: "reasoned"\` is surfaced (never auto-blocked) at the merge decision | WARN | review-core.md § Security-mode review (merge-gate step, mirrors V-SEC-08) |`
- **AC**: `grep -c "V-SEC-12" src/references/blackhole-vcodes.md` returns exactly 1 (single
  canonical definition, no duplicate row).

### Task 7 — `review-core.md` merge-gate step + LGTM condition
- Add a new numbered step to § Security-mode review (after existing step 6, `V-SEC-08`),
  mirroring its exact "surface, never auto-block" shape:
  > 7. **Reasoned-verification surfacing (`V-SEC-12`)**: before merge on a security-mode PR, the
  > orchestrator surfaces (never blocks on) any `verification_legs[]` entry with
  > `mode: "reasoned"` at the merge decision point — documented manual gate, same script-free
  > treatment as `V-GIT-01`/`V-SEC-08`. This never authorizes bypassing `with-test-lock` (AC4);
  > it only makes an existing reasoned-verification disclosure visible where it was previously
  > buried in free prose.
- Add a 5th condition to § LGTM definition (`review-core.md:28-35`), matching condition 4's
  phrasing pattern:
  > 5. When the Security-mode review gate resolved `true` for this PR, any `verification_legs[]`
  > entry with `mode: "reasoned"` has been surfaced to the merge decision (`V-SEC-12`) — visible,
  > not blocking. Not applicable when the gate resolved `false` or `route` was absent.
- **AC**: § LGTM definition lists exactly 5 numbered conditions after this edit; § Security-mode
  review lists exactly 7 numbered steps; both new items cite `V-SEC-12` by name (not just "the
  new step").

### Task 8 — `ledger-schema.check.ts` extension (`V-LEDGER-01`)
- **Red**: add to `scripts/verify.ledger-schema.test.ts`, inside the existing
  `describe('findLedgerSchemaDrift', ...)` block:
  ```ts
  test('a verification_mode outside the enum is reported as drift', () => {
    const findings = [{ id: 'F-6', issue_ref: 100, verification_mode: 'guessed' }];
    const drift = findLedgerSchemaDrift(findings);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('F-6');
    expect(drift[0]).toContain('verification_mode');
  });

  test('a verification_mode of "executed" or "reasoned" is not drift', () => {
    const findings = [
      { id: 'F-7', issue_ref: 100, verification_mode: 'executed' },
      { id: 'F-8', issue_ref: 100, verification_mode: 'reasoned' },
    ];
    expect(findLedgerSchemaDrift(findings)).toEqual([]);
  });

  test('a row with verification_mode key entirely absent is not reported as drift', () => {
    const findings = [{ id: 'F-9', issue_ref: 100 }];
    expect(findLedgerSchemaDrift(findings)).toEqual([]);
  });
  ```
  Run `bun test scripts/verify.ledger-schema.test.ts` now — the `'guessed'` case must fail
  (pass silently) against the pre-Task-8 `findLedgerSchemaDrift`, demonstrating the check is not
  vacuous before it is wired up (this session's own V-TEST-11 standard).
- **Green**: in `scripts/checks/ledger-schema.check.ts`, import
  `VERIFICATION_MODES` from `'../lib/worker-json/constants.ts'` (reuse, not a re-declared enum —
  `V-DRY-01`); add `verification_mode?: unknown;` to the `LedgerRow` type; in
  `findLedgerSchemaDrift`, after the existing `pr` check:
  ```ts
  if ('verification_mode' in row && !(VERIFICATION_MODES as readonly string[]).includes(row.verification_mode as string)) {
    violations.push(`${id}: verification_mode is ${JSON.stringify(row.verification_mode)} (expected "executed"|"reasoned")`);
  }
  ```
- **AC**: `bun test scripts/verify.ledger-schema.test.ts` is green, including the three new cases;
  the existing "clean ledger" and "pr_ref key entirely absent" tests remain green unmodified
  (no regression to `V-LEDGER-01`'s existing three checks).

## Sprint Contract

Every task above (1-8) carries its own `— **AC**: <condition>` line; there is no task in this
plan relying on the blanket "all tests and linters pass" fallback. Definition of done for the
whole plan: all 8 ACs pass, `bun run scripts/validate-worker-json.ts` accepts the updated
`## Output Format` example, `bun test` (scoped to the touched test files) is green, and
`bun run build` regenerates the dist trees for the four touched `src/**` files with no diff
outside those trees.

## Execution Strategy & Stop Conditions

- If `bun test scripts/validate-worker-json.test.ts` still passes on the two new "invalid" fixtures
  **before** Task 2/3's validator code is written, halt and rewrite the fixture — the red step
  did not actually exercise the new check (unfalsifiable-control pattern, ADR-035).
- If extending `findLedgerSchemaDrift` (Task 8) causes any of the three pre-existing tests in
  `scripts/verify.ledger-schema.test.ts` to fail, revert the Task 8 diff and re-inspect the
  `'verification_mode' in row` guard — it must never fire on a row that lacks the key.
- If `worker-schemas.md`'s new example JSON (Task 4) fails `validateReviewer` when checked via
  `bun run scripts/validate-worker-json.ts` (or an equivalent direct call), stop and fix the
  doc/validator mismatch before proceeding to Task 5 — `reviewer.md`'s copy must not encode a
  divergent example.
- If `bun run build` produces a diff outside the four declared generated-dist-tree targets for
  the touched `src/**` sources, abort the build step and investigate — an unexpected target
  indicates `scripts/lib/build/targets.ts` drift not accounted for by this plan.
- Do not touch `resource-frugal-testing.md`, `with-test-lock`, or any config under
  `.blackhole/config.json` `resource_policy` — AC4 is satisfied by this plan doing nothing to
  that surface, not by editing it.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS — all 4 source files, 4 implementation files, and 6 test/fixture paths listed explicitly under Touch-Paths |
| `schema_baseline` | PASS — `verification_mode`/`verification_legs` fully specified: field names, types, enum values, required/optional status, and example JSON all given in Task 4 |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS (Critical Files section is empty — vacuously PASS) |
| `mitigation_concrete` | PASS |

CLI invocation and result (`bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-815.md`):
```json
{
  "ac_mapping": true,
  "critical_files_exist": true,
  "mitigation_concrete": true
}
```
No `failing_checks`.

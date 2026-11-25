# Reviewer Schemas

Structured JSON return contract for the `reviewer` campaign worker agent. Split out of [`worker-schemas.md`](worker-schemas.md) so a reviewer reads only its own contract; the shared worker preamble, the other roles and the aggregate scripts' output shapes stay there.

## Reviewer (`reviewer`)

```json
{
  "status": "complete",
  "findings": [
    {
      "vcode": "V-KISS-03",
      "severity": "BLOCK",
      "file": "src/db/client.ts",
      "line": 42,
      "summary": "Empty catch block in query wrapper",
      "verification_mode": "executed"
    }
  ],
  "recheck": [
    { "finding_id": "F-00042", "verdict": "fixed", "evidence": "L.128 now validates input before query" }
  ],
  "verification": [
    { "finding_id": "V1", "verdict": "refuted", "evidence": "input is validated at L.40 — exploit path not reproducible" }
  ],
  "verification_legs": [
    { "direction": "Authorization bypass via role param tampering", "mode": "reasoned", "evidence": "Read role-check middleware; no probe run — with-test-lock was contended" }
  ]
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `complete` \| `error` | yes |
| `findings` | finding[] | yes (empty array = no issues found) |
| `error` | string | when `status: error` |
| `recheck` | `{finding_id, verdict, evidence}[]` | required only when the reviewer was dispatched in recheck mode (`review-core.md` § Recheck mode); absent/omitted for a normal full-audit review |
| `verification` | `{finding_id, verdict, evidence}[]` | required only when the reviewer was dispatched in independent verification mode (a `finding_id` is assigned for every non-pre-existing BLOCK) (`review-core.md` § Independent security verification, `reviewer.md` § Independent Security Verification Mode); absent/omitted for every other dispatch |
| `verification_legs` | `{direction, mode, evidence}[]` | optional — ADR-036 (issue #815); a clean/negative investigation leg that produced no `Finding` object |
| `loaded_modules` | `string[]` | optional — file names of the on-demand audit modules the reviewer Read (`reviewer.md` § On-demand audit modules); `review-aggregate.ts --audit-context-file` fails a return that omits a module whose trigger holds for the diff (`scripts/lib/audit-module-triggers.ts`) |

The reviewer return declares no PR-number field — the PR under review is the dispatch's own
input, not something the reviewer reports back. Where a worker contract does carry one, the
canonical top-level spelling is `pr_number`, defined once in
[`implementer-schemas.md`](implementer-schemas.md) § `pr_number` and cited here rather than
restated.

### `recheck` (optional — recheck-mode fast path, issue #214)

Carries one entry per prior finding named in the recheck-mode prompt, verifying whether the
fix commits resolved it:

- `finding_id` — the existing ledger `F-NNNNN` id (`findings-ledger.md`) of the prior finding
  being rechecked, not a new id scheme.
- `verdict` — `fixed` \| `not_fixed`. `not_fixed` is treated identically to a `BLOCK` finding
  for that same `finding_id` — the reviewer must also emit a corresponding `findings` entry
  when `verdict: not_fixed`, so the aggregate script and LGTM gate need no special-casing for
  `recheck`.
- `evidence` — a short concrete pointer (e.g. `file:line` + what changed) showing why the
  finding is judged fixed or not — not a restatement of the original finding summary.

`--prior-file` rows passed to `review-aggregate.ts` must carry the ledger `id` field (issue
#485) for a `recheck[]` `verdict: fixed` entry to resolve against them; a missing or mismatched
`id` surfaces in `unresolved_recheck` (`worker-schemas.md` § Review aggregate), not silently.

### `verification` (optional — independent security verification mode, issue #439)

Carries one entry per stamped `V-SEC-*` finding the reviewer was dispatched to independently
judge (`review-core.md` § Independent security verification, `reviewer.md` § Independent Security Verification Mode) — a sibling
shape to `recheck` above, distinct meaning: `recheck` verifies whether a fix commit resolved a
*prior, ledgered* finding; `verification` verifies whether a *fresh, same-pass* finding
independently holds up.

- `finding_id` — the temporary, review-pass-scoped id (e.g. `V1`, `V2`, ...) the orchestrator
  stamped onto the finding before including it in this dispatch's prompt — not a ledger
  `F-NNNNN` id (none exists yet at this point in the pipeline; see `review-core.md` §
  Independent security verification step 3).
- `verdict` — `confirmed` \| `refuted`. `refuted` downgrades the matching `BLOCK` finding to
  `WARN` before `applyConfidenceGate`/`dedupeFindings` run (`scripts/review-aggregate.ts`'s
  exported `applyVerificationDowngrades`) — it never excludes the finding outright, unlike
  `recheck`'s `fixed` verdict; a `confirmed` verdict, or a `finding_id` with no match among the
  primary's stamped findings, is a no-op.
- `evidence` — a concrete pointer showing what was checked and why the exploit path did or did
  not hold — not a restatement of the original finding's summary.

Passed to `review-aggregate.ts` via `--verification-file` (see `worker-schemas.md` § Review aggregate) as a
plain JSON array — distinct from `--prior-file`'s ledger-row shape.

### `verification_legs` (optional — executed vs. reasoned disclosure, ADR-036 / issue #815)

A JSON home for a **clean/negative investigation leg** (checked something, found no `Finding`) — not named `verification`, already used twice (the array above, `hunter`'s `CONFIRMED`/`STALE` field). Fields: `direction`, `mode` (`executed` \| `reasoned`), `evidence` (for `reasoned`, why execution was unavailable, e.g. `with-test-lock` contention). Never grounds to bypass `with-test-lock`. See `reviewer.md` § Executed vs. Reasoned Verification Disclosure / `review-core.md` § Security-mode review (`V-SEC-12`).

### Rulings ledger (read-input)

`reviewer.md` § Owner-Ruling Violation Audit "Owner-Ruling Violation Audit" reads `documentation/reference/
product-principles.md` (the owner-rulings ledger) when present, gated by
`docs_governance.companion_files`. A diff contradicting an `active`-status ruling's
`Interpretation` field surfaces as a normal `findings[]` entry with `vcode: "V-RULE-01"`,
`severity: "BLOCK"` — no dedicated JSON field beyond the shared Finding shape below.

### Finding shape (shared)

```json
{
  "vcode": "V-DRY-01",
  "severity": "BLOCK",
  "file": "lib/foo.ts",
  "line": 42,
  "summary": "Description",
  "gain": 7,
  "effort": 2,
  "verification_mode": "executed"
}
```

`gain` and `effort` required only for `V-PARETO-02` findings.

`verification_mode` (optional — `executed` \| `reasoned`, ADR-036 / issue #815): execution vs. reasoning-only basis; absence means no claim made.

`cited_value` and `declared_set_ref` (optional strings, ADR-134): the citation on a `V-UX-09` or `V-UX-10` finding. `cited_value` is the literal as written on `file:line`. `declared_set_ref` is `<set file>#<axis>` and is required for `V-UX-09`. `review-aggregate.ts` re-checks the citation before such a finding may stay `BLOCK`.
<!-- GENERATED by scripts/build.ts from src/references/reviewer-schemas.md — do not hand-edit -->

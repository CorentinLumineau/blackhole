# Hunt Kind: Bug

Scan heuristics, calibration table, and scoring rule for the `bug` hunt kind
(`kaizen.kinds`, `config-template.md`). Ported from `x-troubleshoot`'s hypothesis-driven
diagnostics, narrowed to read/trace-verified reproduction (ADR-006 § Hunt kinds).

## Scan heuristics

A `bug` wave looks for reproducible defects — never a hunch or a "this looks suspicious"
flag. Every candidate requires **read/trace-verified reproduction**: a concrete traced path
from a specific input through the code to a wrong output or a crash, not a hypothesis
(mirrors `V-FIX-01`'s root-cause standard). The wave scans one territory band per wave via
the same generic `territory.bands_scanned` mechanic every other kind already uses — this is
not a bug-specific banding scheme (contrast `coverage.md`'s P1–P4 criticality bands); it is
the shared wave-territory mechanic applied to bug-hunting territory.

- **Off-by-one / boundary error** — a loop bound, array index, or comparison operator is
  traced to produce a wrong result at a specific boundary input (empty input, single
  element, max-length input), with the wrong output demonstrated by tracing the code path.
- **Null/undefined dereference** — a traced call path reaches a property access or method
  call on a value that can be `null`/`undefined`/absent at that point, with a concrete input
  that reaches it.
- **Incorrect error handling** — an exception is caught and silently swallowed, or a caught
  error is re-thrown with the wrong type/message, traced to a specific input that triggers
  the catch block and produces an observably wrong outcome (a hung operation, a misleading
  error surfaced to the user, data left in an inconsistent state).
- **Race condition / ordering bug** — a traced sequence shows two operations that must
  happen in a specific order can execute out of order (e.g. a read before a write it depends
  on completes), with a concrete trigger scenario.
- **State/logic inversion** — a conditional's polarity is traced to be backwards (e.g. a
  flag meant to gate a path instead disables it), demonstrated by tracing a concrete input
  through the condition to the wrong branch.

Every finding is read-verified before it is reported: the hunter re-reads the cited
`file:line` and only reports `CONFIRMED` findings (`worker-schemas.md` § Hunter). For this
kind specifically, `CONFIRMED` means the traced input→output path was walked and the wrong
result demonstrated — a plausible-sounding but untraced suspicion is `STALE`/not reported,
never rounded up to `CONFIRMED`.

## Severity-term reconciliation note

The issue AC and ADR-006 § Scoring model item 3 say "CRITICAL/HIGH bugs always file." The
hunter's already-shipped output contract (`worker-schemas.md` § Hunter, Finding shape) has
no `CRITICAL` tier — its `severity` field is `LOW | MEDIUM | HIGH | BLOCK`. This kind
**reuses that enum as-is** — it does not introduce a new `CRITICAL` tier. `severity: BLOCK`
**stands in for** the ADR's "CRITICAL" (the same reconciliation already stated in the
already-merged `phase-loop.md` § Kaizen hunt dispatch step 3: "the hunter's shipped
`worker-schemas.md` contract has no `CRITICAL` tier; `severity: BLOCK` stands in for the
ADR's 'CRITICAL'"; precedent for this kind of label reconciliation: `filing.md`'s own
"Field-label reconciliation note" for Rationale vs. Root-cause–rationale).

## Severity floor

A `CONFIRMED` bug finding with `severity: BLOCK` or `severity: HIGH` **always files**,
bypassing the `Priority >= 30` gate. `severity: MEDIUM`/`severity: LOW` findings go through
the normal `V-PARETO-02` gate like every other kind. This file documents the input rule the
hunter uses when scoring a bug finding; the floor's actual enforcement at filing time lives
in `phase-loop.md` § Kaizen hunt dispatch step 3 (already shipped, unchanged, out of this
file's scope) — this reference does not re-implement or duplicate that dispatch logic.

## Calibration table

| Heuristic | Trigger | Gain range | Effort range | Severity range | Worked example |
|-----------|---------|------------|---------------|-----------------|-----------------|
| Off-by-one / boundary error | Loop bound/index/comparison traced to a wrong result at a boundary input | 4–7 | 1–3 | LOW–HIGH | A pagination helper traced with a `page_size`-exact input drops the last row due to `< limit` instead of `<= limit` → gain 5, effort 2, severity MEDIUM → Priority 5 × (11 − 2) = 5 × 9 = 45 (moderate, files via the normal gate) |
| Null/undefined dereference | Traced call path reaches a property/method access on a value that can be null/undefined | 5–8 | 2–4 | MEDIUM–BLOCK | A traced request path shows an unauthenticated request reaches `session.user.id` before the auth middleware runs, crashing the process on every unauthenticated request (illustrative, invented) → gain 8, effort 3, severity BLOCK → Priority 8 × (11 − 3) = 8 × 8 = 64, which already clears the floor on its own — but the point of this example is the severity floor: even if effort were high enough to push Priority under 30 (e.g. effort 9 → Priority 8 × 2 = 16), `severity: BLOCK` would still force filing regardless, per the severity floor above. This is the AC3 anchor: a `BLOCK`/`HIGH` bug finding files even when its Priority would otherwise fall below 30. |
| Incorrect error handling | Traced input triggers a catch block that swallows or mis-surfaces an error, producing an observably wrong outcome | 3–6 | 1–4 | LOW–HIGH | A traced retry wrapper catches a network timeout and silently returns `undefined` instead of retrying or surfacing failure, so a caller proceeds with missing data → gain 5, effort 2, severity HIGH → Priority 5 × (11 − 2) = 5 × 9 = 45, and severity HIGH alone would file this regardless of the Priority computation per the severity floor |
| Race condition / ordering bug | Traced sequence shows an out-of-order execution with a concrete trigger scenario | 5–8 | 3–6 | MEDIUM–BLOCK | A traced write-then-read across two async handlers shows the read can execute before the write's promise resolves under concurrent requests, returning stale data → gain 7, effort 4, severity HIGH → Priority 7 × (11 − 4) = 7 × 7 = 49 (moderate) |
| State/logic inversion | Traced conditional polarity is backwards, demonstrated on a concrete input | 4–7 | 1–3 | LOW–HIGH | A traced feature-gate check uses `if (flag)` where the intended semantics were "disable when flag is set," so enabling the flag silently disables the feature for all users → gain 6, effort 2, severity HIGH → Priority 6 × (11 − 2) = 6 × 9 = 54 (moderate) |

`gain`, `effort`, and `severity` are carried alongside each other on every finding
(`worker-schemas.md` § Hunter, Finding shape) — `severity` is not a substitute for
`gain`/`effort`, it is an additional input that can override the `Priority >= 30` gate per
the severity floor above. `gain` and `effort` are each 1–10; `severity` is one of
`LOW | MEDIUM | HIGH | BLOCK`.

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending (`src/references/blackhole-vcodes.md`,
`V-PARETO-02`). This is the **only** scoring formula for the `bug` kind — no alternate or
per-kind formula is introduced. The severity floor above is an input rule layered on top of
the one formula (a `BLOCK`/`HIGH` `CONFIRMED` bug bypasses the `>= 30` gate; it does not
replace the formula or introduce a second one), consistent with ADR-006 § Scoring model
verdict: "the formula is sound and stays unchanged as the single SSOT... mercure's
mechanisms as input rules under the one formula, not as parallel formulas."
<!-- GENERATED by scripts/build.ts from src/references/hunt/bug.md — do not hand-edit -->

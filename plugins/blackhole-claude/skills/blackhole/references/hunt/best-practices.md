# Hunt Kind: Best-Practices

Scan heuristics, calibration table, and scoring rule for the `best-practices` hunt kind
(`kaizen.kinds`, `config-template.md`). Ported from `x-analyze`'s SOLID/DRY/KISS/YAGNI audit
(ADR-006 § Hunt kinds).

## Scan heuristics

A `best-practices` wave checks each touched-or-scanned file against concrete, mechanical
triggers for the four SOLID principles this campaign enforces plus DRY, KISS, and YAGNI —
never a vague "looks bad" impression:

- **SRP (Single Responsibility)** — a class/file exceeds 300 lines, OR exposes more than 10
  methods, OR visibly mixes unrelated concerns (e.g. persistence + business logic + I/O in
  one module).
- **OCP (Open/Closed)** — a switch statement or if/else chain branches on a type tag, and
  that chain must be edited every time a new variant is added.
- **ISP (Interface Segregation)** — an interface or abstract base class exposes more than 7
  methods, forcing implementers to stub or no-op members they don't use.
- **DIP (Dependency Inversion)** — a module imports and instantiates a concrete class
  directly (e.g. `new ConcreteClient()`) instead of depending on an injected abstraction,
  blocking test doubles.
- **DRY** — a block of more than 5 lines is duplicated verbatim (or near-verbatim) 3 or more
  times across the corpus.
- **KISS** — a function's cyclomatic complexity exceeds 10.
- **YAGNI** — dead or speculative code: unused config flags, "future" parameters nothing
  reads yet, unreachable branches, single-consumer abstractions built "just in case."

Every finding is read-verified before it is reported: the hunter re-reads the cited
`file:line` and only reports `CONFIRMED` findings (`worker-schemas.md` § Hunter).

## Calibration table

| Heuristic | Trigger | Gain range | Effort range | Worked example |
|-----------|---------|------------|---------------|-----------------|
| SRP violation | Class/file >300 lines OR >10 methods OR mixed unrelated concerns | 5–8 | 4–7 | 480-line service class mixing DB access, validation, and email dispatch → gain 7, effort 5 → Priority 7 × (11 − 5) = 7 × 6 = 42 (moderate) |
| OCP violation | Switch/if-else chain branching on a type tag, edited for every new variant | 4–7 | 3–6 | 6-branch switch-on-type dispatch edited for every new payment provider → gain 6, effort 4 → Priority 6 × (11 − 4) = 6 × 7 = 42 (moderate) |
| ISP violation | Interface/abstract class with >7 methods; implementers stub unused members | 3–5 | 2–4 | 9-method interface where 3 implementers throw `NotImplementedError` on 4 methods → gain 4, effort 3 → Priority 4 × (11 − 3) = 4 × 8 = 32 (borderline) |
| DIP violation | Module imports a concrete class directly instead of an injected abstraction | 3–6 | 2–5 | Direct `new PostgresClient()` inside business logic, blocking test doubles → gain 5, effort 3 → Priority 5 × (11 − 3) = 5 × 8 = 40 (moderate) |
| DRY violation | >5-line block duplicated verbatim (or near-verbatim) 3+ times | 4–7 | 2–5 | Identical 8-line retry loop copy-pasted at 3 call sites → gain 6, effort 3 → Priority 6 × (11 − 3) = 6 × 8 = 48 (moderate) |
| KISS violation | Function cyclomatic complexity >10 | 4–6 | 3–6 | 14-branch validation function with no extracted helpers → gain 5, effort 4 → Priority 5 × (11 − 4) = 5 × 7 = 35 (borderline) |
| YAGNI violation | Dead or speculative code (unused flags, unread "future" params, unreachable branches) | 2–4 | 1–3 | Unused `enableExperimentalMode` flag with zero call sites reading it → gain 3, effort 1 → Priority 3 × (11 − 1) = 3 × 10 = 30 (borderline, files at the floor) |

`gain` and `effort` are each 1–10, matching the hunter output contract
(`worker-schemas.md` § Hunter, Finding shape). The ranges above are per-heuristic
calibration bands, not hard values — a hunter agent picks the specific score within the
listed range based on the concrete finding's actual scope.

## Wave-note reporting convention

Alongside its findings, a `best-practices` wave records a per-principle score in its wave
note: an approximate SRP / OCP / ISP / DIP / DRY / KISS / YAGNI percentage (0–100%)
reflecting how much of the scanned territory currently satisfies that principle. This is a
wave-note reporting convention for the (not-yet-built, #199) hunter agent — it is not part
of the `hunt_state` ledger schema (`findings-ledger.md`). Recording it lets a human
spot-audit calibration drift over time (mirrors ADR-006's Risk Assessment: "reviewer
independently audits... scores recorded in ledger rows for human spot-audit").

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending (`src/references/blackhole-vcodes.md`,
`V-PARETO-02`). This is the **only** scoring formula for the `best-practices` kind — no
alternate or per-kind formula is introduced, and the per-principle wave-note percentages
above are reporting context, not a second scoring input. The calibration table anchors this
kind's `gain`/`effort` inputs to the shared 1–10 scale; it does not replace the formula
(ADR-006 § Scoring model verdict: "the formula is sound and stays unchanged as the single
SSOT").
<!-- GENERATED by scripts/build.ts from src/references/hunt/best-practices.md — do not hand-edit -->

---
section: Confidence-Based Finding Filtering & Consolidation
vcodes: []
---
### Confidence-Based Finding Filtering & Consolidation
*   **Confidence bands**: score every finding's **finding-confidence** (0-100; distinct from `route.confidence` used elsewhere in this repo — never conflate the two) and self-apply this policy before returning findings:
    *   `> 80` (or no meaningful doubt): report normally, severity unchanged.
    *   `50–80`: report with an explicit caveat in `summary` (e.g. "low-confidence — verify before acting") and **never** as `BLOCK` — downgrade `BLOCK` findings in this band to `WARN`.
    *   `< 50`: suppress entirely — do not include in `findings` at all, and therefore never surface as `BLOCK` or any high severity.
*   **Confidence-raising signals**: (a) the finding matches a known vulnerability or anti-pattern signature; (b) the finding is statically confirmable from the diff alone, with no need for runtime context; (c) multiple independent indicators (e.g. missing test + missing error handling + duplicated logic) point to the same root cause.
*   **Confidence-lowering signals**: (a) the finding is test-code-only (not production logic); (b) the finding is runtime-context-dependent and cannot be confirmed by reading the diff alone.
*   **Same-root-cause consolidation**: when 2+ occurrences in the diff share one underlying defect (e.g. the same missing-validation pattern repeated at N call sites), emit **one** finding object carrying a `locations: [{ file, line }, ...]` array for the secondary occurrences instead of N separate finding objects. Keep the finding's primary `file`/`line` set to the first/most-representative occurrence — `scripts/review-aggregate.ts` dedup keys off that primary `file`/`line` only; `locations[]` is additive context.
*   **Backstop**: `scripts/review-aggregate.ts`'s `applyConfidenceGate` mechanically re-enforces the same band boundaries (`<50` drop, `50–80` downgrade+caveat, `>80` passthrough) as a deterministic safety net — self-scoring here does not replace it.

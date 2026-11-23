---
type: plan
summary: "Make detect-doc-schema.sh frontmatter mode compare mercure-only vs blackhole-only key counts so a real mercure ADR is classified mercure instead of ambiguous"
status: current
review_trigger: "on file change"
created: 2026-11-23
last_updated: 2026-11-23
---

# Plan - Issue #1398

## Objective
`scripts/detect-doc-schema.sh frontmatter` returns `schema=ambiguous` for a real mercure ADR
(ADR-123 carries mercure-only `number`/`title`/`source`/`scope`/`decision_signals`/
`tracking_initiative` plus the shared-name `last_updated`), so the planner falls back to
blackhole's schema in a mercure repo. Replace the exclusive-set test in `detect_frontmatter`
(`scripts/detect-doc-schema.sh:96-113`) with a count comparison: M = mercure-only keys present,
B = blackhole-only keys present; M>B -> mercure, B>M -> blackhole, tie (including 0=0) ->
ambiguous. Index mode is untouched. Priority 5 x (11-2) = 45 (issue's own estimate; design
re-verified, effort stays small).

## Touch-Paths
- `scripts/detect-doc-schema.sh` (decision block lines 96-113 and header comment lines 27-32)
- `scripts/detect-doc-schema.test.ts`

No `templates/hooks/**` touched, so no `package.json` version bump (V-PLUGIN-01 inert). The script
is not compiled into any dist tree (git ls-files shows no mirrored copy), so no build output
changes; prose citing it (`src/agents/planner.md`, `doc-governance.md`) cites it as SSOT without
restating the key rules and needs no edit.

## Documentation Impact
None - the header comment in the script is the SSOT for the discriminator rules
(`doc-governance.md` § Repo Convention Precedence defers to it); updating it is part of the change.

## Task Steps
1. Red first: add three tests to the `frontmatter mode` describe in
   `scripts/detect-doc-schema.test.ts`, run only that file, confirm (a) and (b) fail on main.
   - (a) verbatim mercure ADR-123 frontmatter (M=6, B=1: `last_updated`) -> `schema=mercure`.
     **AC**: fixture run returns stdout `schema=mercure\n`; fails with `ambiguous` before the fix.
   - (b) blackhole ADR with a stray `title:` plus `last_updated` and `review_trigger` (M=1, B=2)
     -> `schema=blackhole`. **AC**: stdout `schema=blackhole\n`; fails with `ambiguous` before.
   - (c) M=2, B=2 tie (e.g. `number`, `title`, `last_updated`, `review_trigger`) -> stays
     `schema=ambiguous`. **AC**: stdout `schema=ambiguous\n` before and after.
   The existing 1-vs-1 `number` + `last_updated` test stays `ambiguous` unchanged.
2. Green: in `detect_frontmatter`, replace the two booleans with two integer counters
   incremented per present key (same `has_key` helper, same key arrays), then
   `(( m > b )) && emit mercure; (( b > m )) && emit blackhole; emit ambiguous`.
   **AC**: all tests in `scripts/detect-doc-schema.test.ts` pass, including the pre-existing ones.
3. Update the header comment (lines 27-32) to state the count-comparison rule (tie or no
   discriminators -> ambiguous) so the SSOT matches behavior.
   **AC**: header no longer says "both sets present ... -> ambiguous"; describes M vs B counting.
4. Verification (local, minimal): `bash -n scripts/detect-doc-schema.sh`; `shellcheck` if
   installed; ONE scoped run `with-test-lock bun test scripts/detect-doc-schema.test.ts`. Full
   suite and `bun run verify` run in CI on the PR, never locally.

## Notes
- Scout check: record an Improvement Record on the changed block (e.g. `has_key` greps `^key:`
  unescaped; fine for the fixed key list, no change needed).
- Out of scope: #1389 (same script, new "foreign" outcome) and #1399 (build shipping) stay
  untouched; coordinate on merge order only if both touch the decision block.
- Known limitation, accepted: a repo with keys split exactly evenly stays ambiguous and falls
  back to blackhole's schema with the existing V-INT-01 WARN (visible, not silent).

## Rulings
`rulings_checked_at: 7`, `ruling_conflicts: []` (no active ruling in
`documentation/reference/product-principles.md` conflicts).

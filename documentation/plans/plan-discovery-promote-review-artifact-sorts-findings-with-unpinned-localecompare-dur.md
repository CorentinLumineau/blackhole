---
type: plan
summary: "Plan: fix unpinned localeCompare in promote-review-artifact.ts (issue #791)"
status: current
review_trigger: "on implementation"
created: 2026-09-03
last_updated: 2026-09-03
---

# Plan: issue #791 — unpinned `localeCompare` in `promote-review-artifact.ts`

## Objective

Replace the locale/ICU-dependent `String.prototype.localeCompare()` comparator at
`scripts/lib/promote-review-artifact.ts:103` with the byte-order-safe form already
established at `scripts/lib/check-common.ts:128` (`byPathByteOrder`, fixed by
PR #790/issue #743), add a regression test that a lowercase-hyphenated-only fixture
set cannot catch, and confirm no other `scripts/` `localeCompare` use needs the same
fix. `check-common.ts` is out of scope — its comparator is already fixed; do not
touch it.

## Touch-Paths

- `scripts/lib/promote-review-artifact.ts` — the comparator at line 103 (AC1)
- `scripts/promote-review-artifact.test.ts` — new regression test (AC2)
- `fixtures/promote-review-artifact/` — new fixture file(s) carrying a case-variant
  and an underscore `file` value (AC2)

No other file needs a code change. The AC3 sweep found no other live
`localeCompare` call in `scripts/` — `check-common.ts`/`check-common.test.ts` only
*mention* `localeCompare` in comments explaining why it was rejected there (issue
#743); they contain no call to fix or exempt.

## Task Steps

1. **AC1 — fix the comparator.** Replace
   `return a.file.localeCompare(b.file);` at
   `scripts/lib/promote-review-artifact.ts:103` with
   `return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;` (same shape as
   `scripts/lib/check-common.ts:128`'s `byPathByteOrder`).

2. **AC2 — regression test.** Add
   `fixtures/promote-review-artifact/case-and-underscore-ledger.json` with two
   `BLOCK` findings differing only in `file`: `"scripts/Zeta.ts"` and
   `"scripts/apple_file.ts"`. Add a test asserting byte-order output
   `['scripts/Zeta.ts', 'scripts/apple_file.ts']`. Verify it fails against
   `localeCompare` and passes after the fix (both directions recorded in the PR).

3. **AC3 — sweep result.** Exactly one live `.localeCompare(` call exists under
   `scripts/`: the AC1 target. The two other `localeCompare` mentions
   (`check-common.ts:122-124`, `check-common.test.ts:173`) are comment prose, not
   calls, and require no action. No exemptions were needed.

4. **AC4 — `check-common.ts` untouched.** Confirm zero diff to
   `scripts/lib/check-common.ts` / `scripts/lib/check-common.test.ts`; confirm both
   comparators now share the identical byte-order three-way shape.

## References

- Prior fix for the identical pattern: PR #790 / issue #743.

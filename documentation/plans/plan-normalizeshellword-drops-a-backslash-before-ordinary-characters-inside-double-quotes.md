---
type: plan
summary: "Make normalizeShellWord keep a backslash inside double quotes unless it precedes a dollar sign, backtick, double quote, backslash or newline, as bash does, with red-first verdict rows for the redirect form and the GIT_TRACE form"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: normalizeShellWord drops a backslash before ordinary characters inside double quotes (issue #1308)

## Objective
Inside `"..."` bash removes a backslash only before `$`, a backtick, `"`, `\` and newline; before any other character it keeps the backslash. `normalizeShellWord` (`templates/hooks/pretooluse/utils/worktree-removal-guard.js`, ~line 370 at the base) drops it before every character, so `"a\b"` becomes `ab` instead of `a\b` and `echo x > "<m>/.worktrees/\wt"` resolves to the wrong path and is allowed. After the fix the backslash survives unless it precedes one of those five characters.

## Base (stacked)
Stacks on PR #1258 head `blackhole/issue-1252-substitutions` (fd60d0f6), which carries #1257's round-10 guard. Both wait on owner decision PD-2; the owner's stacking exception covers a dependent on a PR waiting for the owner. The PR targets that branch, not main. It is a SIBLING of PR #1327 (#1295), not stacked on it: neither PR depends on the other.

## Root cause (V-FIX-01)
The double-quote branch of `normalizeShellWord` does `text += word[j + 1]` for any `\X`, i.e. the unquoted-backslash rule, inside the quote. Bash's double-quote rule is narrower. One function applies the wrong rule; every consumer inherits it.

## Design decisions (80/20)
- **One edit, in `normalizeShellWord`'s double-quote branch only**: when `word[j] === '\\'` and `word[j+1]` is one of `$`, backtick, `"`, `\`, newline, drop the backslash and take the next char (today's behavior, now restricted); otherwise append both characters. The `$`/backtick dynamic check stays after it, so `"\$HOME"` stays literal and `"$HOME"` stays dynamic. The unquoted `\X` branch (drops the backslash before any character) is correct and is not touched. Single quotes are not touched.
- **No new code in the consumers.** `unescapeTarget`, `asStaticWord` and `findGitTraceTargets` keep their code; only their input text changes. Do not add a second quote-removal helper (V-INT-04) and do not move the function into `shell-lexer.js` (ADR-040 keeps clause splitters separate; a relocation is out of scope, V-SCOPE-01).

## Consumers of normalizeShellWord (at fd60d0f6) and effect
`worktree-removal-guard.js`: command-word and `git`/`rm`/`worktree remove` token matching (`unquotedOrWord` ~419, ~440-442, ~659, ~811, ~859-863, ~941, ~970). `bash-write-target-guard.js` (imports it): `asStaticWord` (~435, option words and cp/mv/tee-style operands), `findGitTraceTargets` (~1039, ~1041), `unescapeTarget` (~1421, used by `add` ~1529 for every redirect, tee, cp/mv/install/dd target), `isCd`/cd-word reads (~1482, ~1486).
- **Redirect and cp/mv/tee targets** (`unescapeTarget`): `"<m>/.worktrees/\wt"` now yields `<m>/.worktrees/\wt`, an absolute literal (`isLiteralPathArg` accepts a backslash) outside the assigned worktree, so the verdict moves from allow to deny. This is the intended fix.
- **`asStaticWord`**: its text must match `^[\w.,:+=@%/-]+$`; a kept backslash fails that test, so the word is returned as written (quoted) instead of as a backslash-less static word. Verify with a test row that a quoted operand with `\x` is not read as the backslash-free path.
- **Removal guard**: `"g\it"` stops matching `git`, and `rm -rf "<wt>/\x"` no longer resolves to `<wt>/x`. Both now follow bash; no real removal is newly missed (the target bash deletes is the backslash path, not the stripped one).
- **GIT_TRACE (Tier-1 quote-only name path)**: not reached. The contract's exact-word rule (`OPAQUE_RE = /[$\`\\{}]/`, ~972) sends any word whose raw text holds a backslash to Tier 2, and `findGitTraceTargets` tests `OPAQUE_RE` on the raw word and on a plain assignment's value BEFORE calling `normalizeShellWord`. So `GIT_TRACE="<m>/.worktrees/\wt"` stays `bash-write-target-unresolvable` (WARN) with or without this change. The issue's claim that the GIT_TRACE path "inherits" the bug was true of the pre-contract code; at this base the contract already covers it.

## Contract closure rows (`.blackhole/plans/issue-1246-contract.md`, durable copy `documentation/investigations/issue-1246-guard-contract.md`)
- **Row 15** (`export "GIT_TRACE=<m>/.worktrees/\wt"`, allow -> WARN, T2-3): unchanged. Stays WARN; the new GIT_TRACE verdict row pins that.
- **Row 16** (`echo x > "<m>/.worktrees/\wt"`, allow, residual R9 #1308): flips allow -> deny. This is the deliberate resolution of the named residual, not a regression: it moves it from Tier 3 into Tier 1 (resolve exactly, block outside the worktree), consistent with the contract's Tier 1/2 text. The implementer updates row 16's verdict column and deletes R9 (and the "#1308 / F-00593" clause in the exact-word term) in the durable `documentation/investigations/issue-1246-guard-contract.md`, so docs match code (V-DOCSYNC-01).
- No other row is affected: every other row has no backslash inside double quotes, and the trace rows with a backslash are opaque before normalization. `contract_rows_affected`: row 16 (flips, intended); rows 1-15, 17-86, A1-A20 unchanged.

## Touch-Paths
- `templates/hooks/pretooluse/utils/worktree-removal-guard.js` (`normalizeShellWord` double-quote branch only)
- `scripts/hooks-bash-write-double-quote-backslash.test.ts` (new file; keeps off `scripts/hooks-bash-write-escapes.test.ts`, which PR #1327 edits)
- `documentation/investigations/issue-1246-guard-contract.md` (row 16 verdict, remove residual R9)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

**Overlap with PR #1327**: #1327 changes `commandPositions` in `bash-write-target-guard.js`, its test `scripts/hooks-bash-write-escapes.test.ts`, its own plan doc and `documentation/INDEX.md`, plus the generated copies. This plan edits `worktree-removal-guard.js`, not `bash-write-target-guard.js`, so source files do not overlap. Shared files are only the generated dist trees and `documentation/INDEX.md` (the new plan doc row, regenerated by the carry-step). Generated trees are rebuilt, never hand-merged: whichever PR lands second rebuilds. No version bump (owner waived V-PLUGIN-01).

## Documentation Impact
`documentation/investigations/issue-1246-guard-contract.md` (row 16 and R9, above). No public interface, config key or other documentation change.

## Task Steps (red first)
1. Tests first, in the new spec, using the sibling harness (`runPreToolUseHook`/`withLinkedWorktree`, `evaluateBashWriteTargets(command, worktree)` with `[label, (m, wt) => command]` rows). Deny rows (BLOCK `bash-outside-assigned-worktree`) for a target `"<m>/.worktrees/\wt"`: `echo x > "<m>/.worktrees/\wt"`; `echo x | tee "<m>/.worktrees/\wt"`; `cp a "<m>/.worktrees/\wt"`; `mv a "<m>/.worktrees/\wt"`. WARN row (`bash-write-target-unresolvable`) for the GIT_TRACE form: `GIT_TRACE="<m>/.worktrees/\wt" git status` and `export "GIT_TRACE=<m>/.worktrees/\wt"` (row 15). Unit rows on the exported `normalizeShellWord`: `"a\b"` -> `a\b`; `"a\$b"` -> `a$b`; `"a\"b"` -> `a"b`; `"a\\b"` -> `a\b`; `"a\<newline>b"` -> `ab`. Run the focused spec once; the redirect/tee/cp/mv deny rows and the `"a\b"` row must be red on fd60d0f6 (the GIT_TRACE WARN rows are already green there, which is the point: they pin that the fix does not flip Tier 2).
2. Edit the double-quote branch of `normalizeShellWord` as in Design decisions.
3. No-regression rows (green before and after): unquoted `\wt` target (backslash dropped, as today); `echo x > "<wt>/ok"` allowed; `echo x > "<m>/x"` and `echo x > "<m>/\$x"` still resolved as before (the second stays unresolvable/dynamic-safe); `"git"`, `g""it`, `\git` still normalize to `git`; single-quoted `'a\b'` stays `a\b`; `rm -rf "<m>/.worktrees/wt"` (no backslash) still refused by the removal guard.
4. `bun run build`; commit source, tests, contract doc and regenerated output together; branch from `blackhole/issue-1252-substitutions`; open the PR against that branch with `Closes #1308`.

## Task Breakdown / Acceptance Criteria
- T1 red rows - **AC**: the four redirect/tee/cp/mv deny rows and the `"a\b"` unit row fail on fd60d0f6 and pass after T2 (`bun test scripts/hooks-bash-write-double-quote-backslash.test.ts`, one focused run through with-test-lock).
- T2 GIT_TRACE - **AC**: the two GIT_TRACE rows return `bash-write-target-unresolvable` (WARN) before and after the change; contract row 15 is unchanged.
- T3 no regression - **AC**: every T3 row returns the same verdict before and after; the existing `scripts/hooks-bash-write-*.test.ts` and `scripts/hooks-validate-bash.test.ts` rows stay green in CI (`bun run verify`).
- T4 scope - **AC**: `git diff --stat origin/blackhole/issue-1252-substitutions...HEAD` lists only the Touch-Paths and generated trees, and the `worktree-removal-guard.js` diff is confined to `normalizeShellWord`'s double-quote branch (scope: that file, no exemptions).
- T5 docs - **AC**: `grep -n "R9\|1308" documentation/investigations/issue-1246-guard-contract.md` returns no residual-R9 row and row 16 reads deny (scope: that one file; the exact-word term may keep no #1308 clause).
- T6 build - **AC**: `bun run build` exits 0 and `bun run verify` finds no stale generated tree.

## Test Strategy
TDD, red first, through the guard's public verdict entry plus the exported `normalizeShellWord` for the five-character rule. Local: the one focused spec; full suite and verify run in CI.

## Stop conditions
- If a deny row stays green on fd60d0f6, stop: the row does not exercise `normalizeShellWord`; fix the row.
- If any contract closure row other than 16 changes verdict, stop and report it against #1257/#1246 instead of widening this PR.
- If the cp/mv `asStaticWord` row yields allow after the fix, stop: a consumer reads the quoted word another way; record it before widening beyond `normalizeShellWord`.
- If #1258 changes `normalizeShellWord` before this lands, rebase and re-run the red rows.

## Track / Classification
Quick; `task_type: bugfix`; `route.security_review_required: true`, size xs. Threat screen: touches the write-containment and worktree-removal guards, no auth, no user data, no endpoint added; STRIDE-lite answers: auth/authz no, user data no, endpoint no. `route.ui` false, so no UI gate.

## Pareto
Gain 5, Effort 2, Priority = 5 x 9 = 45 (>= 30). V-SEC-02.

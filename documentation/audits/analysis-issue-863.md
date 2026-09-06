---
type: analysis
status: current
created: 2026-09-06
last_updated: 2026-09-06
review_trigger: "on file change"
---


# Analysis — issue #863: extract one shell lexer for the three PreToolUse guards

`route.touch_paths` is empty for this issue (no `default_touch_paths` narrowing applies to a
`templates/hooks/**` refactor), so this catalogue is scoped directly to the three files and one
shared helper the issue body names, verified against the current tree rather than assumed from the
issue text (line numbers have drifted since #506/#616/#774/#803/#880 landed).

## Conventions Catalog

### 1. The three guards, verified

- `templates/hooks/pretooluse/utils/bash-write-target-guard.js` (348 lines) — #804/ADR-029, Bash
  write-target containment.
- `templates/hooks/pretooluse/utils/bash-context.js` (469 lines) — #488/#506, shell-syntax
  "described vs. executed" masking (`computeMaskedSpans`) consumed by both other guards.
- `templates/hooks/pretooluse/utils/worktree-removal-guard.js` (1212 lines) — #532/#774/#788/#803,
  `git worktree remove` / `rm -rf <worktree>` safety gate, most recently hardened over **four**
  review rounds on PR #880 (issue #803): F-00043 (`cd`-then-`rm` wrong-cwd resolution), F-00058
  (subshell-wrapped `cd`+`rm`), F-00059 (`||`-guarded `cd` ambiguity), F-00064/F-00065 (brace-group
  wrapping, generic transparent-wrapper walk).

### 2. Lexer-adjacent surface, per guard, with `file:line`

**`bash-write-target-guard.js`**
| Primitive | Lines | Role |
|---|---|---|
| `stripQuotes` | 69-78 | strip one matching quote pair |
| `tokenize` | 83-115 | quote-aware whitespace tokenizer (quoted spans kept as one token) |
| `splitClauses` | 124-167 | clause splitter: `;`, `\|`, `\n`, redirect-aware `&` (`&>`/`&>>`/`>&` excluded) |
| `positionalArgsBeforeRedirect` | 204-212 | stop-at-redirect argument scanner |
| `findRedirectTargets` | 177-197 | `>`/`>>`/`&>`/`&>>` target extraction (whole-command regex, not per-clause) |

**`bash-context.js`**
| Primitive | Lines | Role |
|---|---|---|
| `isEscapedQuote` | 62-70 | backslash-parity check before opening any quote span |
| `consumeBalanced` | 80-105 | `(`/`)` and `{`/`}` balanced-bracket walker (contains its own quote-skip) |
| `consumeBacktick` | 113-125 | backtick command-substitution walker |
| `maskLiteralSpan` | 139-166 | literal-text masker leaving `$(...)`/`` ` ``/`${...}` unmasked |
| `consumeDoubleQuotedPrintArg` | 176-185 | double-quoted echo/printf argument masker |
| `parseHeredocDelimiter` | 200-224 | heredoc delimiter word parser (quoted vs. bare) |
| `collectHeredocOperatorsOnLine` | 242-275 | multi-heredoc-per-line collector (contains its own quote-skip) |
| `consumeHeredoc` | 300-342 | heredoc body masker |
| `computeMaskedSpans` | 361-436 | top-level dispatcher — comments, quotes, heredocs (contains its own quote-skip, split by quote type) |

**`worktree-removal-guard.js`**
| Primitive | Lines | Role |
|---|---|---|
| `skipGitGlobalOptions` | 174-194 | git global-option-run skipper |
| `isCommandWordStart` | 202 | word-boundary predicate |
| `findClauseStartIndices` | 239-287 | clause-**start** splitter over `computeMaskedSpans`' masked array: `;`, `\n`, `(`, whitespace-bounded `{`/`}`, `\|` vs `\|\|`, redirect-aware `&`/`&&` |
| `normalizeShellWord` | 297-~335 | bash quote-removal reconstruction (`g""it` → `git`) |
| `skipDollarParenSpan` | 373-384 | `$(...)` balanced-paren skipper (distinct impl from `consumeBalanced` above) |
| `clauseTailFrom` | 398-437 | clause-**tail** extractor: `;`, `\|`, `\n`, `)`, whitespace-bounded `}`, redirect-aware `&`, plus trailing-redirect regex strip |
| `extractCdTargetText` | 454-~490 | `cd` target extraction for cwd tracking |
| `findRemovalInvocations` | 579-663 | the CERTAIN/UNCERTAIN cursor-advance wrapper walk, with the multi-candidate `cwdCandidates` set (verified: lines 582, 601, 623-630) |
| `isLiteralPathArg` | 679 | dynamic-argument rejection (already **imported** by `bash-write-target-guard.js:39` — see § Existing Precedent) |

### 3. Byte-identical vs. near-identical vs. unique — the (a)/(b) boundary

**The "5 copies of the quote-skip loop" are NOT where the (a)/(b) fork lives.** All five
implement the exact same algorithm — scan forward until the matching quote character, treating a
backslash + next-char as one consumed pair only inside double quotes:

- `bash-write-target-guard.js` `tokenize` (98-109) and `splitClauses` (131-142) are **byte-identical**
  modulo one identifier (`text[j]` vs `visible[j]`) — verified by direct diff. A true copy-paste.
- `bash-context.js` `consumeBalanced`'s quote-skip (90-99) and `collectHeredocOperatorsOnLine`'s
  quote-skip (262-270) are **near-identical** — same structure, `j`/`n` vs `p`/`scanEnd` naming.
- `bash-context.js`'s `computeMaskedSpans` inline quote branch (397-406) implements the **same
  algorithm** but shaped differently — split into two separate `while` loops per quote character
  instead of one loop parameterized on a `quote` variable.
- Across files, the `bash-write-target-guard.js` pair and the `bash-context.js` pair are also the
  same algorithm, just embedded in different surrounding logic (one slices/appends into an output
  token, one only returns an end index).

Because the underlying algorithm is identical everywhere (only variable names and the
end-of-buffer bound differ — `n` vs `scanEnd` vs implicit `command.length`), a single
`skipQuotedSpan(text, start, endBound)` extraction is **safe regardless of the (a)/(b) choice** —
this half of the issue is not actually a fork. This confirms the issue's literal ask
(`skipQuotedSpan`) is well-founded for the quote-skip piece specifically.

**The "3 clause splitters" ARE where the fork lives, and it's sharper than "byte-identical vs.
sophisticated":**

- `bash-write-target-guard.js`'s `splitClauses` (124-167) walks quoted spans **whole** — a
  `;`/`\|`/`&` character inside a quoted argument (e.g. a sed script `'s/a;b/c/'`) is never
  mistaken for a clause separator, because the walk treats the quote-opening character as entering
  an atomic span to skip over.
- `worktree-removal-guard.js`'s `findClauseStartIndices` (239-287) and `clauseTailFrom` (398-437)
  are **explicitly documented as quote-UNaware** — `findClauseStartIndices`'s own docstring (lines
  213-216): "A separator inside a quoted string is not distinguished from a real one here — the
  same naive, quote-unaware limitation `clauseTailFrom` below already has." This is an accepted,
  documented limitation for the `git worktree remove`/`rm -rf <worktree>` shape it defends
  (arguments to those two commands are essentially never quoted shell-script text), but it is a
  **real functional gap** for the shape `bash-write-target-guard.js` defends (`sed -i 's/.../.../'`
  scripts routinely contain `;`).
- Retrofitting `bash-write-target-guard.js` onto `worktree-removal-guard.js`'s clause-splitting
  model (the literal reading of option (b), "the newer guard's level of sophistication") would
  therefore **regress** `bash-write-target-guard.js`'s existing quote-safety for `sed`/`tee`
  target detection, not merely add sophistication — a semicolon inside a sed script would
  incorrectly split the clause, and `findSedTargets`/`hasUnresolvableCommand` would then scan the
  wrong token sets. **This is untested today** (see § Test Coverage below) — a naive (b)-style
  retrofit could pass every existing test and still ship this regression silently.
- Conversely, `worktree-removal-guard.js`'s brace-group (`{`/`}`), `\|` vs `\|\|`, and `(` handling
  are genuine capabilities `bash-write-target-guard.js`'s `splitClauses` lacks entirely (it splits
  only on `;`, `\|`, `\n`, and redirect-aware `&` — no `(`/`{`/`}` awareness at all).
- The two clause splitters inside `worktree-removal-guard.js` itself (`findClauseStartIndices` for
  clause **starts**, `clauseTailFrom` for clause **tails**) both re-implement the identical
  redirect-aware `&` disambiguation (`prev === '>' \|\| next === '>'`) independently — this
  duplication exists **within the "newer, sophisticated" file itself**, not only across files.

**Net finding**: a shared clause splitter that is quote-aware (bash-write-target-guard's property)
AND handles `(`/`{`/`}`/`\|\|` (worktree-removal-guard's property) is strictly better than either
current implementation — this is not really "(a) vs (b)," it's "neither current implementation is
individually correct enough to promote wholesale; the shared version needs to be the union of both
guards' safety properties, verified by new tests for each one before either guard is switched
over."

### 4. Behavioral dependencies today — does either guard rely on something a retrofit would change?

- `bash-context.js`'s `computeMaskedSpans` output (which spans are masked) is a **hard behavioral
  dependency** for both other guards — `bash-write-target-guard.js:37` and
  `worktree-removal-guard.js:145` both `require('./bash-context')` and call it directly. This is
  already the one genuinely shared, single-source-of-truth primitive in this trio; the issue does
  not ask to touch it, and this analysis found no reason to.
- `worktree-removal-guard.js`'s clause-boundary-finding is quote-**unaware** by design; retrofitting
  it under `bash-write-target-guard.js` (option (b), literally) would change `sed`/`tee` target
  detection for any command containing a quoted separator character — the concrete dependency is
  `findSedTargets`/`findTeeTargets`/`hasUnresolvableCommand` (all three iterate
  `splitClauses(visible)` output, `bash-write-target-guard.js:308-318`), and **no existing test
  covers this** (§ Test Coverage).
- `worktree-removal-guard.js`'s CERTAIN/UNCERTAIN wrapper walk and `cwdCandidates` multi-candidate
  set (`findRemovalInvocations`, 579-663) are **not lexer surface at all** — they are
  `git worktree remove`/`rm`-specific business logic (deciding which `cd` state is trustworthy,
  which token position is a certain vs. uncertain executable). Extracting them into a shared
  `shell-lexer.js` would misclassify business logic as lexing; they should stay in
  `worktree-removal-guard.js` regardless of which (a)/(b) direction is chosen for the clause
  splitter itself.
- `bash-context.js` has no dependency on either other guard — it is upstream of both, never
  downstream.

### 5. Existing precedent for cross-file lexer-adjacent reuse

`bash-write-target-guard.js:39` already does `const { isLiteralPathArg } = require('./worktree-removal-guard');`
— a working, shipped example of one guard importing a primitive from another guard file directly,
with no dedicated shared-lexer module. This is evidence that a `shell-lexer.js` module is not
strictly required to achieve DRY here (a direct cross-require already works in this codebase's
`require()`-based CommonJS layout), though centralizing behind one file is still the more
maintainable shape once the primitive count grows past one.

## Architecture Coherence

The issue's fix direction (`shell-lexer.js` exporting `skipQuotedSpan`, `splitClauses`,
`tokenize`) sits consistently with the existing module-boundary pattern in this hook tree:
`bash-context.js` is already the shared "masking" primitive both other guards consume via
`require()`; a `shell-lexer.js` for "tokenizing/clause-splitting" would be the same shape one level
down. No new pattern variant is introduced by the fix direction itself. The one place the fix
direction is under-specified relative to what this analysis found: `skipQuotedSpan`/`splitClauses`
as named would need explicit parameters for (i) the end-of-buffer bound (three different names —
`n`, `scanEnd`, implicit — are in use today) and (ii) whether clause-splitting is quote-aware,
since that is exactly the property that currently differs between the two guards that need a
shared splitter.

## Performance Baselines

Not applicable — `templates/hooks/pretooluse/utils/*.js` run synchronously inside a PreToolUse
hook subprocess on a single command string (typically well under 1KB), and no latency/throughput
figures are tracked or gated for this surface. `implementer.md` § Carry Staged Artifacts already
documents that these modules are structurally uninstrumentable for coverage (they execute only
inside a subprocess spawned by `runPreToolUseHook`); the same subprocess-only execution model
means no in-process performance baseline exists to cite. No number is fabricated here.

## Test Coverage (supplementary — informs the design decision directly)

- All three guards' behavior is exercised **exclusively** through
  `scripts/hooks-validate-bash.test.ts` (2862 lines, 130 `test(...)` cases across 17 `describe`
  blocks), which spawns the real `validate-bash-command.js` script as a subprocess
  (`runPreToolUseHook`) and asserts on its JSON decision output. Verified: this file contains
  **zero** direct imports of `bash-context.js`, `bash-write-target-guard.js`, or
  `worktree-removal-guard.js` — no test calls `tokenize`, `splitClauses`, `computeMaskedSpans`,
  `findClauseStartIndices`, `clauseTailFrom`, etc. directly. Every test exercises public
  behavior end-to-end, never lexer internals.
- Consequence for the issue's "test-preservation contract": **any** extraction (option (a) or (b))
  that preserves each guard's externally observable decisions will not orphan a single existing
  test, because none of them are wired to lexer internals in the first place. This lowers the
  mechanical risk of the refactor but does **not** validate the shared lexer's correctness beyond
  what these 130 black-box cases already probe.
- Coverage tooling cannot instrument these files at all (`bun test --coverage` never sees them —
  they only run inside the spawned subprocess), so `V-TEST-09`'s coverage-regression gate is
  structurally `unmeasurable` for this diff per `implementer.md` § Carry Staged Artifacts; the
  reviewable signal is the before/after count of these 130 behavioral cases plus whatever new
  lexer unit tests the fix direction adds, not a coverage percentage.
- **Concrete gap found**: no existing test exercises a clause separator character (`;`, `\|`, `&`)
  embedded inside a quoted argument for `bash-write-target-guard.js` (the closest test,
  `#804: sed -i editing a main-clone file` at line ~2711, uses `'s/a/b/'` — no embedded `;`).
  This is exactly the scenario where `worktree-removal-guard.js`'s quote-unaware clause-splitting
  model would silently diverge from `bash-write-target-guard.js`'s current quote-aware one (§
  Conventions Catalog, point 3). Whichever direction is chosen, this case needs a new regression
  test before or alongside the extraction — it is not a "nice to have," it is the one scenario
  that would let a (b)-shaped retrofit ship a silent regression through 130 passing tests.
  `scripts/lib/hook-event-triage.test.ts` (131 lines, 4 tests) and `hooks-validate-file.test.ts`
  (989 lines, 41 tests) do not touch Bash-command lexing at all — they cover the `Write`/`Edit`
  tool path and hook-event triage respectively, and are unaffected by this refactor either way.

## V-PLUGIN-01 / ADR-030 rollout-risk angle

`templates/hooks/**` changes ship inert to every already-installed campaign's plugin cache until
`package.json`'s version is bumped **and** the plugin is reinstalled (ADR-030,
`documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md`; enforced as `V-PLUGIN-01`
BLOCK in `reviewer.md`). Current `package.json` version: `0.21.4`. Two things elevate this
refactor's rollout risk above the historical pattern:

1. **ADR-030 exists precisely because of this failure class**: 3 prior guard security fixes
   (#506, #616, #774 — cited in the issue's own rationale) previously shipped and sat inert
   against version-keyed installed caches before ADR-030's gate closed that recurrence mechanism.
   This refactor is itself a `templates/hooks/**` diff and must bump the version in the same PR —
   the issue's fix direction already states this; this analysis confirms it against the live gate
   and version.
2. **Blast radius is wider than any single prior fix**: #506/#616/#774 each touched detection logic
   for *one* guard. A shared-lexer extraction that swaps the clause-splitting or quote-skip
   primitive underneath all three guards in one PR changes the detection path for **all three**
   pre-execution safety gates simultaneously. A subtle regression in the shared primitive (e.g.
   the untested quote-inside-clause-separator case above, if retrofitted under option (b)) would
   not degrade one guard — it would silently degrade whichever guards consume the changed
   primitive, in the same release, until the next version bump + reinstall cycle catches it. This
   argues for whatever new lexer unit tests are added (`shell-lexer.js`'s own test file, per the
   issue's fix direction) to be run against **all three guards' actual call sites**, not just the
   extracted module in isolation, before this PR merges.

## Bottom line for the design decision (not made here)

This refactor is worth doing — the underlying algorithms genuinely converge (5 quote-skip copies
implement one algorithm; the clause-splitting divergence is a real but small and precisely
characterized gap, not five independent designs). The evidence does not support "this refactor is
no longer worth doing." It does support narrowing the (a)/(b) framing: the quote-skip half is a
safe, low-risk parameterization regardless of which option is chosen; the clause-splitter half
needs the new shared implementation to be the union of `bash-write-target-guard.js`'s quote-safety
and `worktree-removal-guard.js`'s `(`/`{`/`}`/`\|\|` handling — not a straight promotion of either
guard's current splitter over the other — with a new regression test for the quoted-separator case
landing in the same PR regardless of direction.

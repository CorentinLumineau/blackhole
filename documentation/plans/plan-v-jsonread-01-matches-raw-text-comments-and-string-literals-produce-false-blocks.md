---
rulings_checked_at: 5
ruling_conflicts: []
type: plan
summary: "Fix V-JSONREAD-01 false BLOCKs from raw-text matching inside comments and string literals in read-json-file.check.ts"
status: current
review_trigger: "on merge of the PR implementing this plan"
created: 2026-09-06
last_updated: 2026-09-06
---

# Plan: issue #913 — V-JSONREAD-01 matches raw text: comments and string literals produce false BLOCKs

## Objective

`V-JSONREAD-01` (`scripts/checks/read-json-file.check.ts`) matches its bypass regex
(`BARE_PARSE_RE`) against raw file text, line by line, with no awareness of comments or string
literals. A `//` comment or a string literal that happens to contain the literal token sequence
`JSON.parse(...readFileSync(` produces a false BLOCK on a green tree — proven during PR #910's
review by mutation testing two scratch files (a comment-carrying file and a string-literal-carrying
file), both wrongly flagged. Fix: scrub each line's comment and string-literal content before
matching, so only a genuine call-expression shape is flagged, while a real bare-parse violation
stays caught.

## Touch-Paths

- `scripts/checks/read-json-file.check.ts`
- `scripts/verify.read-json-file.test.ts`

## Documentation Impact

None — this is a pure bugfix to an internal build-tooling check's regex-matching logic
(`scripts/checks/read-json-file.check.ts`). It changes no public interface, no config schema, no
ADR-significant decision, and no consumer-facing documentation. The one explicit decision this
issue's AC #3 demands (whether `jq-empty-guard.check.ts` gets the same treatment, and whether a
shared idiom is extracted) is recorded below in `## Design Decision` — not in
`documentation/decisions/`, since it is not architecturally significant (no cross-cutting
constraint, no rejected alternative binding future work beyond this one check).

## Design Decision

**Context**: The issue's own AC #3 was filed on the premise that `jq-empty-guard.check.ts` shares
`read-json-file.check.ts`'s raw-text false-positive defect, and asked for an explicit decision on
whether to fix both or extract a shared idiom. The owner's correction comment on issue #913
verified that premise is false and resolved the AC — this section records that resolution
explicitly, per the AC's own requirement that it be closed by a stated decision, not by silence.

**Why the two checks do not share this defect**: `jq-empty-guard.check.ts` (`scripts/checks/jq-empty-guard.check.ts:3`)
walks markdown prose via `walkMdFilesAbs` and asks "does a `jq empty` mention sit within N lines of
a negation word" — "is this token inside a `//` comment or a JS string literal" is not a
meaningful question against prose. `read-json-file.check.ts` (`scripts/checks/read-json-file.check.ts:4,38`)
is the only check in `scripts/checks/` that walks `.ts` **source** files
(`.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))`) and regex-matches a JS/TS
call-expression shape against raw lines — it is the only place this false-positive class can occur.

**Alternatives considered and rejected** (each closes at most half the failure, per the owner's
correction comment):
- Tighten the regex to exclude a `//`-prefixed match — closes the comment case, leaves string
  literals open.
- Require assignment/expression position — a string literal sits in an assignment RHS too
  (`const x = "JSON.parse(readFileSync(";`), so this does not discriminate at all.
- Skip comment-only lines — misses a trailing same-line comment, and does nothing for strings.

**Decision**:
1. Fix only `scripts/checks/read-json-file.check.ts`. Do not modify `jq-empty-guard.check.ts` —
   it has no instance of this defect to fix.
2. Do not extract a shared stripping idiom into `scripts/lib/`. The prose scanner
   (`jq-empty-guard.check.ts`) has no use for a comment/string stripper, so extracting one now
   would be a single-consumer abstraction (`V-YAGNI-03`). The ~3-line split-lines /
   regex-test / collect-violations skeleton the two checks share is well under the `V-DRY`
   >10-line duplication threshold (`V-DRY-01`), so there is nothing to deduplicate either.
3. AST parsing is off the table: `package.json` declares `dependencies: {}` and only
   `@types/node` in `devDependencies` — no `typescript`, no parser package is installed. Adding
   one for a single check's single regex is disproportionate (`V-KISS-01`/`V-YAGNI-01`). No
   existing stripper exists under `scripts/lib/` (nothing matching `strip*[Cc]omment`,
   `tokeniz`, or an AST import), so writing one does not collide with `V-INT-02`.
4. The fix is a small, scoped, single-line scrubber (see `## Task Steps` below) — line-scoped by
   design, matching the check's existing per-line scan shape. **Accepted, stated gaps**: it does
   not track a `/* ... */` block comment across multiple lines (an unterminated `/*` on one line
   is treated as running to end-of-line only, not into subsequent lines), and it does not resolve
   `${...}` interpolation inside a template literal. Both gaps already sit outside this check's
   pre-existing line-by-line design (it never tracked any cross-line state before this fix
   either) — this fix does not add new debt, but leaving the gap unstated would be a silent
   surprise for the next person reading this file, which is why it is recorded here.

## Task Steps

1. **TDD Baseline Verification**: Run the project's test suite
   (`bun test scripts/verify.read-json-file.test.ts`, then the full suite) to confirm the existing
   4 assertions in `describe('read-json-file runChecks() against the real scripts/ tree', ...)`
   and the 2 assertions in `describe('findBareJsonParseBypasses', ...)` are green before any
   change — establishes the pre-fix baseline. — **AC**: baseline run's pass/fail counts quoted in
   the completion evidence; all pre-existing assertions pass.

2. **Write Failing Tests (red-before-green)**: In `scripts/verify.read-json-file.test.ts`, inside
   the existing `describe('findBareJsonParseBypasses', ...)` block, add two new inline-fixture
   tests alongside the existing two (`'flags a bare JSON.parse(fs.readFileSync(...)) call at its
   line'` and `'does not flag a call using readJsonFile instead'`, both left unmodified):
   - `'does not flag a bare-parse token sequence inside a // comment'` — fixture:
     ```
     const commented = [
       'const load = (p: string) => {',
       "  // JSON.parse(fs.readFileSync(p, 'utf-8')) — do not do this, use readJsonFile",
       '};',
     ].join('\n');
     expect(findBareJsonParseBypasses(commented, 'fixture.ts')).toEqual([]);
     ```
   - `'does not flag a bare-parse token sequence inside a string literal'` — fixture:
     ```
     const stringLiteral = [
       'const load = (p: string) => {',
       '  const example = "JSON.parse(fs.readFileSync(p, \'utf-8\'))";',
       '};',
     ].join('\n');
     expect(findBareJsonParseBypasses(stringLiteral, 'fixture.ts')).toEqual([]);
     ```
   Run the suite now (before touching `read-json-file.check.ts`) and confirm both new tests
   **fail** with `Expected: [], Received: ["fixture.ts:2"]` — the raw-text regex matches both the
   comment line and the string-literal line unchanged, exactly reproducing the issue's reported
   false-BLOCK class. Confirm the pre-existing `'flags a bare ... call at its line'` test still
   **passes** unchanged (`['fixture.ts:2']`) — this is the true positive the fix must not
   collateral-damage. — **AC**: test run output quoted showing the two new tests failing with
   `Received: ["fixture.ts:2"]` and the existing true-positive test passing, before any production
   code change.

3. **Implement the scrubber**: In `scripts/checks/read-json-file.check.ts`, add a
   `stripCommentsAndStrings(line: string): string` function that walks the line's characters
   tracking whether the cursor is inside a `'`/`"`/`` ` `` string (with backslash-escape handling
   so `\'`/`\"`/`` \` `` does not end the string early), and:
   - while inside a string, does not emit the string's content (or its delimiting quotes) to the
     scrubbed output;
   - outside a string, on an unescaped `//`, truncates the rest of the line (a line comment runs
     to end-of-line);
   - outside a string, on an unescaped `/*`, looks for a same-line closing `*/`; if found, skips
     the whole `/* ... */` span and resumes scanning after it; if not found, truncates the rest of
     the line (the accepted multi-line-block-comment gap from `## Design Decision`).
   Change `findBareJsonParseBypasses` to test `BARE_PARSE_RE` against
   `stripCommentsAndStrings(line)` instead of the raw `line`. — **AC**: `stripCommentsAndStrings`
   is a named, independently readable function (not inlined into the `.forEach` callback);
   `findBareJsonParseBypasses`'s only behavioral change is testing the scrubbed line instead of
   the raw line.

4. **Verify Integrity**: Re-run `bun test scripts/verify.read-json-file.test.ts`, then the full
   `bun run verify` / test suite. Confirm: both new tests from Task 2 now **pass** (`toEqual([])`);
   the pre-existing true-positive test (`'flags a bare ... call at its line'`) still **passes**
   unchanged; the pre-existing `'does not flag a call using readJsonFile instead'` test still
   passes; the tree-level `describe('read-json-file runChecks() against the real scripts/ tree',
   ...)` block's 4 assertions (both exemption checks, the exactly-one-result check, and the
   full-migration-passes check) all still pass unmodified — this fix touches only the matching
   logic inside `findBareJsonParseBypasses`, not the file-walk/exemption filtering those
   assertions cover. Run lint/typecheck if configured. — **AC**: full suite green, lint clean
   (or "no lint configured" stated), both quoted in the completion evidence; zero tests weakened,
   skipped, or removed (`V-TEST-10`).

## Sprint Contract

Every task above carries its own machine-verifiable AC (see each `— **AC**:` line); there is no
task relying on the blanket "all tests and linters pass" fallback. Definition of done for this
plan: Task 2's two new tests transition from failing (`Received: ["fixture.ts:2"]`) to passing
(`[]`) solely because of Task 3's scrubber, the pre-existing true-positive test in the same
`describe` block never stops catching a real bare-parse call, and none of the four tree-level
assertions in the second `describe` block change behavior.

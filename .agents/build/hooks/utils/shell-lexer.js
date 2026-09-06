#!/usr/bin/env bun
'use strict';

/**
 * shell-lexer.js — the uniform, pure shell-scanning primitives that `bash-context.js`,
 * `bash-write-target-guard.js` and `worktree-removal-guard.js` each reimplemented independently
 * (issue #863). Extracted here: `skipQuotedSpan` (5 near-identical copies) and
 * `isRedirectAmpersand` (3 copies). Pure string scanning only — no `fs`, no `child_process`, no
 * `require` of any sibling module — every one of these three guards is a pre-execution safety
 * gate and this module sits underneath all three at once, so it stays trivially auditable on its
 * own.
 *
 * Deliberately NOT extracted here, and not a gap: the three guards' own CLAUSE SPLITTERS
 * (`bash-context.js`'s heredoc/masking scan, `bash-write-target-guard.js`'s `splitClauses`,
 * `worktree-removal-guard.js`'s `findClauseStartIndices` / `clauseTailFrom`). Their quote
 * policies are opposite by requirement, not by accident, and each is fail-closed for its own
 * guard's detection semantics — see `bash-write-target-guard.js`'s `splitClauses` and
 * `worktree-removal-guard.js`'s `findClauseStartIndices` docstrings for the `QUOTE POLICY:`
 * statement each one pins, and `documentation/decisions/ADR-040-shell-lexer-primitives-and-splitter-quote-policy.md`
 * for the full rejected-alternatives record. Unifying the splitters was evaluated and rejected:
 * a quote-unaware union reopens the F-00065 `eval`-wrapped-removal bypass
 * (`scripts/hooks-validate-bash.test.ts:2367`); a quote-aware union turns a `sed` script
 * containing a quoted separator against the main clone from deny into allow (the F-00034
 * incident class). This module holds only what is genuinely uniform across all three: it changes
 * no guard's externally observable deny/warn/allow decision on any input.
 *
 * The whitespace-bounded brace-group (`{`/`}`) reserved-word predicate is a third uniform
 * primitive by shape, but its 3 copies all live inside `worktree-removal-guard.js` alone — it is
 * de-duplicated as a file-private helper in that file instead of exported here, since a
 * single-consumer-file primitive gains nothing from living in a shared module (V-YAGNI-03).
 */

/**
 * Skips a quoted span starting at `start` (the index of the opening `'` or `"`), bounded by
 * `endBound` (never reads at or past it). Returns the index **just past** the matching closing
 * quote, or `endBound` when the span is unterminated within that bound.
 *
 * QUOTE POLICY: a backslash consumes the following character — extending the span past what
 * would otherwise be a closing quote — only when the span opened with `"`. A single-quoted span
 * (`'...'`) has no escape character at all to bash, so a backslash inside one is just another
 * literal character; this mirrors bash's own quoting rules, not an arbitrary design choice.
 *
 * Always returns a value strictly greater than `start`, including both degenerate inputs an
 * unbounded caller loop could otherwise spin on: an unterminated quote (returns `endBound`,
 * which by precondition exceeds `start`), and a quote character sitting at `endBound - 1` (the
 * scan finds nothing to consume and still returns `endBound`).
 */
const skipQuotedSpan = (text, start, endBound) => {
  const quote = text[start];
  let j = start + 1;
  if (quote === '"') {
    while (j < endBound && text[j] !== '"') {
      if (text[j] === '\\' && j + 1 < endBound) j += 2;
      else j++;
    }
  } else {
    while (j < endBound && text[j] !== quote) j++;
  }
  return j < endBound ? j + 1 : endBound;
};

/**
 * True when the `&` at index `i` in `text` belongs to a redirect operator (`&>`, `&>>`, `>&`,
 * `N>&`) rather than being a clause separator — exactly `text[i-1] === '>' || text[i+1] === '>'`,
 * with either neighbor out of range treated as `''` (never matches `'>'`).
 */
const isRedirectAmpersand = (text, i) => {
  const prev = i > 0 ? text[i - 1] : '';
  const next = i + 1 < text.length ? text[i + 1] : '';
  return prev === '>' || next === '>';
};

/**
 * Read-only vocabulary naming the characters that act as clause/token separators somewhere across
 * these guards. Each splitter selects its own subset — this constant does not imply any one of
 * them handles all of them, and is not itself consumed as shared control-flow logic (each
 * splitter's own separator handling stays inline, since the three treat these characters
 * differently by design — see the module docstring above).
 */
const SEPARATORS = Object.freeze({
  SEMICOLON: ';',
  PIPE: '|',
  NEWLINE: '\n',
  AMPERSAND: '&',
  PAREN_OPEN: '(',
  PAREN_CLOSE: ')',
  BRACE_OPEN: '{',
  BRACE_CLOSE: '}',
});

module.exports = { skipQuotedSpan, isRedirectAmpersand, SEPARATORS };

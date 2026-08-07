#!/usr/bin/env bun
'use strict';

/**
 * bash-context.js — shell-syntax context classifier for the Bash PreToolUse gate (#488).
 *
 * PR #470's round-2 boundary-character widening (`85a90f4`) closed the command-substitution
 * evasion class (F-00058) but is architecturally a single regex-on-whole-command-string match
 * with zero shell-syntax context: it cannot distinguish "this substring is the destructive
 * command being executed" from "this substring is text that merely describes it" (a `#` comment,
 * or a string literal handed to a command that only prints its argument). This module adds that
 * missing context layer as a *matching-time filter* — never a change to `bash-patterns.json`'s
 * regexes themselves (see .blackhole/plans/issue-488.md Root-Cause Decision Record).
 *
 * `computeMaskedSpans` marks two span kinds as non-executing, and only these two:
 *   (a) `#` shell comments — never executed under any circumstance in bash, so unconditional.
 *   (b) the literal-text portion of a single-/double-quoted string whose immediately preceding
 *       command word is exactly `echo` or `printf` (or a path ending `/echo`/`/printf`) — the two
 *       common commands whose entire job is to print their argument rather than execute it.
 * Quoted arguments to every other command (`rm -rf "/"`, `bash -c "..."`, `eval "..."`) are left
 * fully visible on purpose: an earlier "mask all quotes" design was proven by execution to
 * silently stop denying `bash -c "rm -rf /"` / `sh -c '...'` / `eval "..."` — trading the
 * false-positive fix for a strictly worse evasion. Masking is metadata over character positions;
 * it never deletes or rewrites the command string, so the regexes still see the real target text
 * (e.g. the `/` in `rm -rf "/"`, which is not masked because `rm` is not a print-only sink).
 *
 * Single quotes and double quotes are NOT interchangeable here (F-00082, review round 2): bash
 * suppresses all substitution inside single quotes, so a single-quoted print-only-sink argument is
 * masked in full. Double quotes suppress nothing except word-splitting/globbing — a `$(...)`,
 * `` `...` ``, or `${...}` run nested inside a double-quoted argument is still evaluated (and, for
 * the first two, executed) by bash before echo/printf ever sees the result. `(b)` above therefore
 * masks only literal text for a double-quoted span, leaving nested substitutions unmasked so the
 * matcher still sees them (`consumeDoubleQuotedPrintArg`). A quote character preceded by an
 * unescaped backslash (`\"`) is not a real quote to bash at all and never opens a span
 * (`isEscapedQuote`) — see that function's docstring for the round-2 dispatch bug this closes.
 */

/** True when `word` is exactly `echo`/`printf`, or a path ending in `/echo` or `/printf`. */
const isPrintOnlySink = (word) => /(^|\/)(echo|printf)$/.test(word);

/**
 * A quote char at index `i` is escaped — a literal character to bash, never a real quote-open —
 * when preceded by an odd number of consecutive backslashes (each adjacent backslash pair is one
 * literal backslash, so the parity of the run, not its mere presence, decides whether the final
 * backslash reaches the quote). F-00082 defect 2 (review round 2, bash-context.js:65 pre-fix): the
 * dispatch below used to open a real quoted span on ANY quote character with no such check, so
 * `\"...\"` (a literal quote, not real quoting — the text between is fully unquoted to bash) got
 * treated as a genuine double-quoted span; its own closing `\"` is equally escaped and so was
 * never recognized as the terminator either, masking everything up to end-of-string and hiding a
 * fully unquoted, executing command substitution from the matcher entirely.
 */
const isEscapedQuote = (command, i) => {
  let count = 0;
  let k = i - 1;
  while (k >= 0 && command[k] === '\\') {
    count++;
    k--;
  }
  return count % 2 === 1;
};

/**
 * Consumes a `(`/`)` or `{`/`}` balanced-bracket run starting at `openIdx` (the index of the open
 * bracket itself), returning the index one past the matching close (or `command.length` if
 * unterminated). A nested quoted span inside is skipped whole — its own bracket-shaped characters
 * must never perturb this depth count — but is never masked: this run is a command or parameter
 * substitution, text bash evaluates (and, for `$(...)`/`` `...` ``, executes) regardless of what
 * quotes it sits inside, so the matcher must still see it (F-00082 defect 1).
 */
const consumeBalanced = (command, openIdx, openChar, closeChar) => {
  const n = command.length;
  let depth = 1;
  let j = openIdx + 1;
  while (j < n && depth > 0) {
    const ch = command[j];
    if (ch === '\\' && j + 1 < n) {
      j += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      j++;
      while (j < n && command[j] !== quote) {
        if (quote === '"' && command[j] === '\\' && j + 1 < n) j += 2;
        else j++;
      }
      j = j < n ? j + 1 : j;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) depth--;
    j++;
  }
  return j;
};

/**
 * Consumes a backtick command-substitution run starting at `openIdx` (index of the opening
 * backtick), returning the index one past the matching closing backtick (or end-of-string). Never
 * masked — same F-00082 defect-1 rationale as `consumeBalanced`: backtick substitution executes
 * even inside a double-quoted argument.
 */
const consumeBacktick = (command, openIdx) => {
  const n = command.length;
  let j = openIdx + 1;
  while (j < n) {
    if (command[j] === '\\' && j + 1 < n) {
      j += 2;
      continue;
    }
    if (command[j] === '`') return j + 1;
    j++;
  }
  return n;
};

/**
 * Consumes a double-quoted print-only-sink argument starting at `openIdx` (index of the opening
 * `"`), masking only its literal text. Double quotes suppress nothing bash still evaluates before
 * echo/printf sees the argument — an embedded `$(...)`, `` `...` ``, or `${...}` run is left fully
 * unmasked via `consumeBalanced`/`consumeBacktick` (F-00082 defect 1: only single quotes suppress
 * substitution; double quotes do not). Returns the index one past the closing `"` (or
 * `command.length` if unterminated).
 */
const consumeDoubleQuotedPrintArg = (command, openIdx, masked) => {
  const n = command.length;
  masked[openIdx] = true;
  let j = openIdx + 1;
  while (j < n) {
    const ch = command[j];
    if (ch === '\\' && j + 1 < n) {
      masked[j] = true;
      masked[j + 1] = true;
      j += 2;
      continue;
    }
    if (ch === '"') {
      masked[j] = true;
      return j + 1;
    }
    if (ch === '$' && command[j + 1] === '(') {
      j = consumeBalanced(command, j + 1, '(', ')');
      continue;
    }
    if (ch === '$' && command[j + 1] === '{') {
      j = consumeBalanced(command, j + 1, '{', '}');
      continue;
    }
    if (ch === '`') {
      j = consumeBacktick(command, j);
      continue;
    }
    masked[j] = true;
    j++;
  }
  return j;
};

/**
 * One boolean per character index of `command`, true where that index falls inside a `#` comment
 * or the literal-text portion of a print-only-sink's quoted argument. A comment starts at a `#`
 * only when it begins a new shell word (preceded by start-of-string or whitespace) and runs to the
 * next newline or the end of the string. A quote character preceded by an unescaped backslash
 * (`isEscapedQuote`) never opens a span at all — it is literal text to bash, left in its default
 * unmasked state exactly like the executing text around it. A genuine single-quoted span run to a
 * print-only sink is masked in full (single quotes suppress all substitution, unconditionally); a
 * genuine double-quoted span to a print-only sink masks only its literal text, leaving any nested
 * `$(...)`, `` `...` ``, or `${...}` substitution unmasked via `consumeDoubleQuotedPrintArg`. A
 * quoted span to any other command is left entirely unmasked, as before. All span kinds skip their
 * own interior, so a `#` or quote character inside an already-open span is never reconsidered as
 * starting a new one.
 */
const computeMaskedSpans = (command) => {
  const n = command.length;
  const masked = new Array(n).fill(false);
  let i = 0;
  let lastWord = '';
  let currentWord = '';

  const flushWord = () => {
    if (currentWord) lastWord = currentWord;
    currentWord = '';
  };

  while (i < n) {
    const ch = command[i];

    if (ch === '#' && (i === 0 || /\s/.test(command[i - 1]))) {
      flushWord();
      const start = i;
      let j = i;
      while (j < n && command[j] !== '\n') j++;
      for (let k = start; k < j; k++) masked[k] = true;
      i = j;
      continue;
    }

    if ((ch === "'" || ch === '"') && !isEscapedQuote(command, i)) {
      const precedingWord = lastWord;
      const quote = ch;
      const start = i;

      if (quote === '"' && isPrintOnlySink(precedingWord)) {
        i = consumeDoubleQuotedPrintArg(command, start, masked);
        currentWord = '';
        continue;
      }

      let j = i + 1;
      if (quote === '"') {
        while (j < n && command[j] !== '"') {
          if (command[j] === '\\' && j + 1 < n) j += 2;
          else j++;
        }
      } else {
        while (j < n && command[j] !== "'") j++;
      }
      const end = j < n ? j + 1 : j;
      if (isPrintOnlySink(precedingWord)) {
        // Single-quoted: bash performs no substitution of any kind inside single quotes (not even
        // backslash-escaping), so the whole span is always inert to a print-only sink — unlike the
        // double-quoted case above, mask it unconditionally.
        for (let k = start; k < end; k++) masked[k] = true;
      }
      i = end;
      currentWord = '';
      continue;
    }

    if (/\s/.test(ch) || /[;|&()`$]/.test(ch)) {
      flushWord();
      i++;
      continue;
    }

    currentWord += ch;
    i++;
  }

  return masked;
};

/**
 * Context-aware sibling of `pattern-loader.js`'s `matchFirst`, scoped to `validate-bash-command.js`
 * only (see .blackhole/plans/issue-488.md Codebase Conventions for why this is not a change to
 * `matchFirst` itself). For each compiled pattern, repeatedly searches `command` and returns the
 * first entry with an unmasked match start; a pattern whose every match starts inside a masked
 * span is treated as non-matching. Returns `null` when nothing unmasked matches any pattern.
 */
const matchFirstIgnoringNonExecutingText = (command, compiled) => {
  if (!command) return null;
  const masked = computeMaskedSpans(command);

  for (const entry of compiled) {
    const flags = entry.regex.flags.includes('g') ? entry.regex.flags : `${entry.regex.flags}g`;
    const globalRegex = new RegExp(entry.regex.source, flags);
    let match = globalRegex.exec(command);
    let hit = false;
    while (match !== null) {
      if (!masked[match.index]) {
        hit = true;
        break;
      }
      if (globalRegex.lastIndex === match.index) {
        globalRegex.lastIndex += 1;
      }
      match = globalRegex.exec(command);
    }
    if (hit) return entry;
  }
  return null;
};

module.exports = { computeMaskedSpans, matchFirstIgnoringNonExecutingText };

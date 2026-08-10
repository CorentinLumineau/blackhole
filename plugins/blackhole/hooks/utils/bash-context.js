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
 *
 * (c) (#506) a heredoc body (`<<DELIM` / `<<-DELIM` through its terminator line) is never itself
 * executed by bash — it is data bash assembles and hands to the receiving command's stdin, the
 * same "described, not executed" relationship as (a)/(b) above. A **quoted** delimiter
 * (`<<'EOF'`/`<<"EOF"`) additionally suppresses every expansion bash would otherwise run over the
 * body, so the whole span is masked in full — same rule as a single-quoted print-only-sink
 * argument. An **unquoted** delimiter (`<<EOF`) still undergoes parameter/command substitution, so
 * only the literal surrounding text is masked and a nested `$(...)`/`` `...` ``/`${...}` run is
 * left unmasked (`consumeHeredoc`, sharing `maskLiteralSpan` with (b)'s double-quoted case — same
 * masking rule, different termination condition).
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
 * Masks a run of literal text as inert while leaving nested command/parameter substitutions
 * (`$(...)`, `` `...` ``, `${...}`) unmasked, since bash evaluates — and, for the first two,
 * executes — those regardless of what surrounding construct's literal text they sit inside.
 * Scans forward from `start` until `isEnd(index)` is true for the current index, treating a
 * backslash-escaped pair (`\X`) as two literal masked characters bash never re-examines for
 * substitution or as an end condition (mirrors `isEscapedQuote`'s escape-parity reasoning at a
 * single-character grain). Shared by `consumeDoubleQuotedPrintArg` (terminated by an unescaped
 * `"`) and `consumeHeredoc`'s unquoted-body masking (terminated by a known end index, #506) —
 * same masking rule, different termination condition (`V-INT-02`: one substitution-aware literal
 * masker, not two). Returns the index at which `isEnd` first held (or `command.length`).
 */
const maskLiteralSpan = (command, start, isEnd, masked) => {
  const n = command.length;
  let j = start;
  while (j < n && !isEnd(j)) {
    const ch = command[j];
    if (ch === '\\' && j + 1 < n) {
      masked[j] = true;
      masked[j + 1] = true;
      j += 2;
      continue;
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
 * Consumes a double-quoted print-only-sink argument starting at `openIdx` (index of the opening
 * `"`), masking only its literal text via `maskLiteralSpan`. Double quotes suppress nothing bash
 * still evaluates before echo/printf sees the argument — an embedded `$(...)`, `` `...` ``, or
 * `${...}` run is left fully unmasked (F-00082 defect 1: only single quotes suppress
 * substitution; double quotes do not). Returns the index one past the closing `"` (or
 * `command.length` if unterminated).
 */
const consumeDoubleQuotedPrintArg = (command, openIdx, masked) => {
  masked[openIdx] = true;
  const n = command.length;
  const j = maskLiteralSpan(command, openIdx + 1, (k) => command[k] === '"', masked);
  if (j < n) {
    masked[j] = true;
    return j + 1;
  }
  return j;
};

/**
 * Consumes a heredoc redirect (`<<`/`<<-`) starting at `startIdx` (index of the first `<`),
 * masking its body per the delimiter word's quoting (#506, see module docstring (c)):
 *   - **quoted** delimiter (`<<'EOF'` / `<<"EOF"`) — bash performs no expansion inside the body at
 *     all, so the whole body is data handed to the receiving command untouched; mask it in full.
 *   - **unquoted** delimiter (`<<EOF`) — bash still runs parameter/command substitution over the
 *     body before handing it over, so only the literal text is masked; a nested
 *     `$(...)`/`` `...` ``/`${...}` run stays unmasked via `maskLiteralSpan`.
 * `<<-` strips leading tabs from each body line (and the terminator line) before the delimiter
 * comparison only — masking itself never rewrites the command string, so those tabs stay part of
 * whatever span they fall into. The terminator is a line whose content, after that optional strip,
 * exactly equals the delimiter — a line that merely *contains* the delimiter text does not match,
 * so a body line like "this mentions EOF but is not the terminator" does not end the heredoc.
 * Sequential heredocs in one command are handled naturally: each call returns the index just past
 * its own terminator line, so the caller's forward scan reaches the next `<<` on its own. Two
 * heredocs sharing a single source line (an advanced, rarely-used shell form) are out of scope —
 * only the first is recognized, matching this module's scope of the common authoring pattern
 * (script bodies authored one heredoc per line) rather than full heredoc-queue parsing.
 * Returns the index one past the terminator line, or `command.length` if the heredoc is never
 * terminated (the remainder of the command is then treated as its body).
 */
const consumeHeredoc = (command, startIdx, masked) => {
  const n = command.length;
  let j = startIdx + 2;
  const stripTabs = command[j] === '-';
  if (stripTabs) j++;
  while (j < n && (command[j] === ' ' || command[j] === '\t')) j++;

  let quoted = false;
  let delimiter = '';
  if (command[j] === "'" || command[j] === '"') {
    quoted = true;
    const quote = command[j];
    j++;
    const start = j;
    while (j < n && command[j] !== quote) j++;
    delimiter = command.slice(start, j);
    if (j < n) j++;
  } else {
    const start = j;
    while (j < n && !/[\s;|&<>]/.test(command[j])) j++;
    delimiter = command.slice(start, j);
  }
  if (!delimiter) return j;

  const lineEnd = command.indexOf('\n', j);
  if (lineEnd === -1) return n;
  const bodyStart = lineEnd + 1;

  const maskBody = (end) => {
    if (quoted) {
      for (let k = bodyStart; k < end; k++) masked[k] = true;
    } else {
      maskLiteralSpan(command, bodyStart, (k) => k >= end, masked);
    }
  };

  let pos = bodyStart;
  while (pos <= n) {
    const nextNl = command.indexOf('\n', pos);
    const lineTextEnd = nextNl === -1 ? n : nextNl;
    const lineText = command.slice(pos, lineTextEnd);
    const compareText = stripTabs ? lineText.replace(/^\t+/, '') : lineText;
    if (compareText === delimiter) {
      maskBody(pos);
      return nextNl === -1 ? n : nextNl + 1;
    }
    if (nextNl === -1) break;
    pos = nextNl + 1;
  }

  maskBody(n);
  return n;
};

/**
 * One boolean per character index of `command`, true where that index falls inside a `#` comment,
 * the literal-text portion of a print-only-sink's quoted argument, or the masked portion of a
 * heredoc body (#506, see module docstring (c)). A comment starts at a `#` only when it begins a
 * new shell word (preceded by start-of-string or whitespace) and runs to the next newline or the
 * end of the string. A quote character preceded by an unescaped backslash (`isEscapedQuote`) never
 * opens a span at all — it is literal text to bash, left in its default unmasked state exactly
 * like the executing text around it. A genuine single-quoted span run to a print-only sink is
 * masked in full (single quotes suppress all substitution, unconditionally); a genuine
 * double-quoted span to a print-only sink masks only its literal text, leaving any nested
 * `$(...)`, `` `...` ``, or `${...}` substitution unmasked via `consumeDoubleQuotedPrintArg`. A
 * quoted span to any other command is left entirely unmasked, as before. A heredoc redirect
 * (`<<`/`<<-`, distinguished from a `<<<` here-string, which this scanner leaves untouched) is
 * consumed by `consumeHeredoc`, which applies the same quoted-vs-unquoted masking split. All span
 * kinds skip their own interior, so a `#`, quote, or `<<` sequence inside an already-open span is
 * never reconsidered as starting a new one.
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

    if (ch === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      flushWord();
      i = consumeHeredoc(command, i, masked);
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

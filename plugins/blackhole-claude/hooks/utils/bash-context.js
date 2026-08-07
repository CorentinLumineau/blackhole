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
 *   (b) single-/double-quoted strings whose immediately preceding command word is exactly `echo`
 *       or `printf` (or a path ending `/echo`/`/printf`) — the two common commands whose entire
 *       job is to print their argument rather than execute it.
 * Quoted arguments to every other command (`rm -rf "/"`, `bash -c "..."`, `eval "..."`) are left
 * fully visible on purpose: an earlier "mask all quotes" design was proven by execution to
 * silently stop denying `bash -c "rm -rf /"` / `sh -c '...'` / `eval "..."` — trading the
 * false-positive fix for a strictly worse evasion. Masking is metadata over character positions;
 * it never deletes or rewrites the command string, so the regexes still see the real target text
 * (e.g. the `/` in `rm -rf "/"`, which is not masked because `rm` is not a print-only sink).
 */

/** True when `word` is exactly `echo`/`printf`, or a path ending in `/echo` or `/printf`. */
const isPrintOnlySink = (word) => /(^|\/)(echo|printf)$/.test(word);

/**
 * One boolean per character index of `command`, true where that index falls inside a `#` comment
 * or a print-only-sink's quoted argument. A comment starts at a `#` only when it begins a new
 * shell word (preceded by start-of-string or whitespace) and runs to the next newline or the end
 * of the string. A quoted span runs from its opening quote to the matching unescaped closing
 * quote (or the end of the string, if unterminated); double-quote escapes (`\"`) do not end the
 * span early. Both span kinds are scanned linearly and skip their own interior, so a `#` or quote
 * character inside an already-open span is never reconsidered as starting a new one.
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

    if (ch === "'" || ch === '"') {
      const precedingWord = lastWord;
      const quote = ch;
      const start = i;
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

---
type: research
summary: "Backslash-escaped and quoted words reached the write-target guard in their raw spelling, including an escaped space and an ANSI-C escaped quote; root cause, fix and residual risks"
status: current
created: 2026-11-18
last_updated: 2026-11-18
review_trigger: "on file change"
issue: 1243
---

# Issue #1243: backslash-escaped and quoted words

## Bypass class

The shell removes quotes and backslashes before a command sees its words, so `> \/etc/x`,
`'sed' -i`, `sed '-i'`, `\cp` and `$'tee'` write exactly where the plain spelling does. The guard
read the raw spelling and gave those commands no verdict. Two shapes survived the first fix:

- `cp a <main>/x\ y` (also `install`, `ln`, `rsync`): the tokenizer split the word on the escaped
  space, so the destination token was `<main>/x\`, which is not the path the shell writes.
- `echo $'\''; cp a <main>/x`: the lexer closed the ANSI-C span at the escaped quote, so the text
  after it read as quoted and the `; cp …` clause was never scanned.

## Root cause

- `tokenize` handled quotes but not a backslash outside quotes, so an escaped space ended the word.
- `skipQuotedSpan` (shared lexer, `shell-lexer.js`) treated every `'…'` span as having no escape
  character. That holds for a plain single-quoted span but not for ANSI-C `$'…'`, where `\'` is an
  escaped quote.

## Fix

- `tokenize` keeps a backslash and the character after it in the current word, so `x\ y` is one
  word; `unescapeTarget` then reads it as `x y`.
- `skipQuotedSpan` lets a backslash consume the next character in a `$'…'` span. `isAnsiCQuote`
  accepts the `'` only when the run of unescaped `$` before it has odd length. A `$` is escaped by an
  odd number of backslashes (`\$'` is plain, `\\$'` is ANSI-C), and `$$` is the process id (`$$'` is
  plain, `$$$'` is ANSI-C).
- The command finder reads quoted, escaped and ANSI-C spellings of a command name through
  `commandName`/`findCommand`, only at positions where a command runs, so a quoted grep pattern
  stays allowed.

Tests: `scripts/hooks-bash-write-escapes.test.ts`.

## Residual risks

- A backslash-newline line continuation inside a word is not joined by the tokenizer; #1252 handles
  it for command substitutions only.
- A `$` before the quote that is itself the result of an expansion (`$$'…'`) keeps the plain
  single-quote reading, which can only over-read the span; an escaped backslash before the `$` no
  longer hides the ANSI-C span.
- Any other ANSI-C escape that names a quote (`\x27`, `\047`) is decoded for a command name but
  not when it appears inside a masked span.

#!/usr/bin/env bun
'use strict';

/**
 * shell-invocation-scan.js — the Bash command scanner shared by the main-clone git guard
 * (`git-main-clone-guard.js`) and the Bash write-target guard (`bash-write-target-guard.js`).
 *
 * It splits a command into clauses (`findClauseStartIndices`, `clauseTailFrom`), tracks the
 * directory a `cd` chain leaves the shell in (`findRemovalInvocations`, which returns one
 * `resolutionCwds` candidate set per invocation), skips git global options and recognises a
 * quoted, escaped or path-qualified executable (`normalizeShellWord`). Nothing here decides
 * whether a command is allowed: the callers do.
 *
 * A clause's tail stops at the first unmasked `;`, `&`, `|`, `)` or newline; heredoc bodies are
 * blanked (`computeHeredocBodyMask`) so their prose never becomes tokens. A `cd` whose target is
 * dynamic, or that follows `||`, widens the candidate set rather than being guessed at; the walk
 * is bounded by `MAX_CLAUSE_SCAN_CHARS` and `MAX_CWD_CANDIDATES`, and exceeding either yields a
 * `SCAN_BUDGET_EXCEEDED` entry the caller refuses on.
 */

const path = require('path');
const { computeMaskedSpans, computeHeredocBodyMask } = require('./bash-context');
const { isRedirectAmpersand } = require('./shell-lexer');

/** Global git options that consume a separate following token as their value (`-C <path>`,
 * `-c name=value`, `--git-dir <path>`, …) — distinct from the attached `--name=value` form, which
 * `skipGitGlobalOptions` recognizes generically via the literal `=`. Not exhaustive against every
 * long option `git --help` lists (`--exec-path`, `--namespace`, etc. are included; obscure ones
 * are not) — a long option missing from this set that turns out to need a separate value would
 * make the walk stop one token early and correctly fail to match `worktree remove`, never the
 * other way around, so an incomplete set cannot create a false allow. */
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--exec-path',
  '--config-env',
]);

/** Advances past a run of git global options starting at token index `start` (the token right
 * after the leading `git`), returning the index of the first token that is not a recognized
 * global option — the subcommand position, e.g. `worktree`. Any bare `--xxx` long flag not in
 * `GIT_GLOBAL_OPTIONS_WITH_VALUE` is treated as taking no value (git's own dispatcher never
 * treats a `--`-prefixed token before the subcommand as anything BUT a global option, so this
 * cannot manufacture a false `worktree remove` match — it can only walk past an option this set
 * does not separately track). Returns -1 when no subcommand token exists: a value-taking option
 * with no following token (the clause ends mid-option), or only global options (or nothing) after
 * `git` — the caller treats that exactly like "not a worktree remove invocation here", not a
 * match. */
const skipGitGlobalOptions = (tokens, start) => {
  let i = start;
  while (i < tokens.length) {
    const token = unquoteWord(tokens[i]);
    if (token.startsWith('--') && token.includes('=')) {
      i += 1;
      continue;
    }
    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
      if (i + 1 >= tokens.length) return -1;
      i += 2;
      continue;
    }
    if (token.startsWith('-')) {
      i += 1;
      continue;
    }
    break;
  }
  return i < tokens.length ? i : -1;
};

/** The three git global options that change WHICH repository an invocation targets — distinct
 * from `-c`/`--namespace`/etc., which change git's behavior within a repo, not which repo it is.
 * A separate set from `GIT_GLOBAL_OPTIONS_WITH_VALUE` above (a subset of it) because this one
 * drives `extractGitRepoOverride`'s value-capture, not `skipGitGlobalOptions`' skip-only walk. */
const REPO_TARGETING_OPTIONS = new Set(['-C', '--git-dir', '--work-tree']);

/** Reads the value of the LAST `-C` / `--git-dir` / `--work-tree` option (separate-token or
 * `--name=value` form) in the git global-option run starting at `start` — the same option run
 * `skipGitGlobalOptions` above walks, read additively rather than by modifying that function
 * (ADR-043 § Decision part 3: `skipGitGlobalOptions` stays separate from this reader, since the removal-path
 * caller above never needed these values). `git-main-clone-guard.js` (#897) is this function's
 * only consumer: `-C <path>` is the form this campaign's own protocol mandates for every git
 * invocation (#528), so an effective-repo check keyed on `cwd` alone would misresolve exactly the
 * commands that check actually needs to see. Returns `null` when none of the three appear —
 * "no override", not "override to the empty string". Malformed input (a value-taking option with
 * no following token) stops the walk and returns whatever was captured so far, mirroring
 * `skipGitGlobalOptions`' own `-1` "clause ends mid-option" contract at the caller's expense, not
 * a thrown error here. */
const extractGitRepoOverride = (tokens, start) => {
  let i = start;
  let override = null;
  while (i < tokens.length) {
    const token = unquoteWord(tokens[i]);
    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=');
      if (REPO_TARGETING_OPTIONS.has(token.slice(0, eq))) override = token.slice(eq + 1);
      i += 1;
      continue;
    }
    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
      if (i + 1 >= tokens.length) return override;
      if (REPO_TARGETING_OPTIONS.has(token)) override = unquoteWord(tokens[i + 1]);
      i += 2;
      continue;
    }
    if (token.startsWith('-')) {
      i += 1;
      continue;
    }
    break;
  }
  return override;
};

/** True when the character immediately before `index` is a real shell word boundary — start of
 * string, whitespace, or a command separator (`;`, `&`, `|`, `(`, `{`, `}`, newline) — not merely
 * "any non-word character". Used below only as a defensive assertion that a clause-start index
 * really is one (`findClauseStartIndices` guarantees this by construction), not as the primary
 * detection mechanism — see that function's docstring for why scanning for `git`-shaped substrings
 * directly (this predicate's original #532 role) cannot cover every executable spelling (#788). */
const isCommandWordStart = (command, index) => index === 0 || /[\s;&|(){}\n]/.test(command[index - 1]);

/** True when the `{` at `index` opens a whitespace-bounded brace group (`{ cmd1; cmd2; }`) rather
 * than a `${VAR}` parameter expansion or the start of a `file{a,b}` brace expansion: preceded by
 * a real word boundary (`isCommandWordStart`) and followed by whitespace, both of which real bash
 * syntax already requires of a brace-group's own opening token. File-private: this predicate has
 * a single consumer file (`findClauseStartIndices` below), so it is not exported from
 * `shell-lexer.js` (V-YAGNI-03) even though it is one of three near-identical brace-boundary
 * checks in this file — see `isBraceGroupClose` for the other two. */
const isBraceGroupOpen = (command, index) =>
  command[index] === '{' && isCommandWordStart(command, index) && /\s/.test(command[index + 1] ?? '');

/** True when the `}` at `index` closes a brace group — preceded by whitespace, the mirror
 * requirement real bash syntax imposes on a brace-group's own closing token (`{ cmd; }` needs
 * that trailing space; `{ cmd;}` is a syntax error) — which excludes it from `${VAR}` and
 * `{a,b}`, neither of which has whitespace before its own `}`. Shared by `findClauseStartIndices`
 * and `clauseTailFrom` below, the other two of this file's three brace-boundary copies. */
const isBraceGroupClose = (text, index) => text[index] === '}' && index > 0 && /\s/.test(text[index - 1]);

/** Every position in `command` that begins a new clause: index 0 (after any leading whitespace),
 * and the first non-whitespace, unmasked position following each unmasked clause separator (`;`,
 * a non-redirect `&`, `|`, `(`, a whitespace-bounded `{`/`}` brace-group reserved word (F-00064,
 * see below), or newline). Deliberately narrower than `isCommandWordStart`'s own boundary set:
 * plain whitespace also appears there, but whitespace alone separates two tokens of the SAME
 * clause (an argument, never a new command) — admitting it here would let an argument like
 * `--git-dir=/x/git` (basename coincidentally `git`, no `.git` suffix) be misread as a second
 * invocation, the exact collision a plain "any word start" scan would reintroduce. Restricting the
 * executable-word search below to a clause's own first token makes that collision impossible by
 * construction, with no per-argument exemption list needed. A separator inside a quoted string is
 * not distinguished from a real one here — the same naive, quote-unaware limitation
 * `clauseTailFrom` below already has for the clause tail it returns; this only affects where a
 * clause is judged to START, the mirror image of that pre-existing, accepted limitation.
 *
 * `{` opens a brace group — `{ cmd1; cmd2; }` — exactly the way `(` opens a subshell, so it
 * triggers the same `skipToStart` a clause boundary does. It is recognized ONLY when it is itself
 * a whitespace-bounded reserved word (preceded by a real word boundary per `isCommandWordStart`,
 * and followed by whitespace) — real bash syntax already requires both, since `{` must be its own
 * token to open a group. This is what keeps it from colliding with `${VAR}` parameter expansion
 * (there `{` is preceded by `$`, never whitespace) or a `file{a,b}` brace expansion (there `{` is
 * preceded by a word character, and followed by none): neither is whitespace-adjacent, so neither
 * is ever mistaken for a group-open. `}` closes a brace group and is recognized the mirror way —
 * preceded by whitespace, the same requirement real bash syntax imposes on it (`{ cmd; }` needs
 * that trailing space; `{ cmd;}` is itself a syntax error) — which excludes it from `${VAR}` and
 * `{a,b}` the same way.
 *
 * Returns `{ index, precededByOr }` entries rather than bare indices (F-00059): `precededByOr` is
 * true only when the separator immediately before this clause is `||`, distinguished here from a
 * single `|` (an ordinary pipe) exactly the way `&&` is already distinguished from a single `&`
 * below — a two-character lookahead at the boundary, not a growing exemption list. Every other
 * separator (`;`, `\n`, `(`, `{`, `}`, `&`, `&&`, a lone `|`) is reported as `precededByOr: false`,
 * including the very first clause (nothing precedes it). `findRemovalInvocations` is the only
 * reader of this field, and only for a `cd` clause — see its docstring for why `||` alone needs
 * this and `&&`/`;` do not.
 *
 * QUOTE POLICY: this walk is quote-UNAWARE by requirement, not by omission — a separator
 * character inside a quoted string is not distinguished from a real one (documented above and
 * repeated on `clauseTailFrom` below). This is load-bearing for this guard's own threat model:
 * `bash-context.js` deliberately does not mask `eval`'s quoted argument, so the `&&` inside
 * `eval "cd <parent> && rm -rf <basename>"` stays a visible character, and only a quote-unaware
 * splitter finds the `rm -rf` clause it hides — a quote-aware walk would skip that whole quoted
 * span and never see it, reopening the F-00065 bypass. Pinned by
 * `scripts/hooks-validate-bash.test.ts:2367`'s `deny: eval "cd <parent> && rm -rf <basename>" …
 * (F-00065)` case. Do not make this quote-aware to match `bash-write-target-guard.js`'s
 * `splitClauses` — that guard needs the opposite policy for its own, equally load-bearing reason
 * (see that function's own `QUOTE POLICY:` note).
 */
const findClauseStartIndices = (command, masked) => {
  const n = command.length;
  const clauses = [];

  const skipToStart = (from, precededByOr) => {
    let i = from;
    while (i < n && (masked[i] || /\s/.test(command[i]))) i += 1;
    if (i < n) clauses.push({ index: i, precededByOr });
    return i;
  };

  let i = skipToStart(0, false);
  while (i < n) {
    if (masked[i]) {
      i += 1;
      continue;
    }
    const ch = command[i];
    if (ch === ';' || ch === '\n' || ch === '(') {
      i = skipToStart(i + 1, false);
      continue;
    }
    if (isBraceGroupOpen(command, i)) {
      i = skipToStart(i + 1, false);
      continue;
    }
    if (isBraceGroupClose(command, i)) {
      i = skipToStart(i + 1, false);
      continue;
    }
    if (ch === '|') {
      const isOr = command[i + 1] === '|';
      i = skipToStart(isOr ? i + 2 : i + 1, isOr);
      continue;
    }
    if (ch === '&') {
      if (isRedirectAmpersand(command, i)) {
        i += 1; // 2>&1, >&, &>file, … — a redirect, not a clause separator
        continue;
      }
      i = skipToStart(command[i + 1] === '&' ? i + 2 : i + 1, false);
      continue;
    }
    i += 1;
  }
  return clauses;
};

/** Reconstructs the literal text bash's own quote-removal would produce from `word`, concatenating
 * adjacent quoted/unquoted/escaped fragments exactly as bash does — `g""it` -> `git`, `\git` ->
 * `git`, `"/usr/bin/git"` -> `/usr/bin/git`. This is the normalize-then-basename-compare step that
 * replaces the old exact `tokens[0] !== 'git'` comparison (#788): one code path covering every
 * measured bypass spelling, not a growing list of predecessor-character exemptions. Cannot resolve
 * a `$(...)`, backtick, `${...}`, or bare `$VAR` reference statically — returns
 * `{ text: null, dynamic: true }` for those (a single-quoted `$`/backtick is never dynamic: single
 * quotes suppress all substitution, so it never reaches the top-level `$`/backtick check below). */
const normalizeShellWord = (word) => {
  let text = '';
  let i = 0;
  const n = word.length;
  while (i < n) {
    const ch = word[i];
    if (ch === '\\' && i + 1 < n) {
      text += word[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'") {
      const close = word.indexOf("'", i + 1);
      const end = close === -1 ? n : close;
      text += word.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n && word[j] !== '"') {
        if (word[j] === '\\' && j + 1 < n) {
          const next = word[j + 1];
          // Inside double quotes bash drops a backslash only before `$`, a backtick, `"`, `\`
          // or a newline (a backslash-newline pair vanishes); before any other character it stays.
          if (next === '\n') {
            j += 2;
            continue;
          }
          if (next === '$' || next === '`' || next === '"' || next === '\\') {
            text += next;
            j += 2;
            continue;
          }
          text += word[j];
          j += 1;
          continue;
        }
        if (word[j] === '$' || word[j] === '`') return { text: null, dynamic: true };
        text += word[j];
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === '$' || ch === '`') return { text: null, dynamic: true };
    text += ch;
    i += 1;
  }
  return { text, dynamic: false };
};

/** `normalizeShellWord`'s text for `word`, or `word` unchanged when it cannot be resolved
 * statically. Applied where tokens are consumed for literal comparison (git global options,
 * subcommand, subcommand arguments) so `git 'reset' '--hard'` classifies exactly like the
 * unquoted spelling. ANSI-C quoting (`$'reset'`) is a deliberate fail-open: `normalizeShellWord`
 * reports it dynamic, so the raw token is kept and no refusal fires. Refusing it would need an
 * ANSI-C escape decoder to tell `$'reset'` from `$'\x72eset'` (a second quote-removal
 * implementation) or a blanket deny of every `$'...'` git word, which also blocks benign
 * `git commit -m $'a\nb'`; the spelling is not a spelling an agent emits by accident. */
const unquoteWord = (word) => {
  const { text, dynamic } = normalizeShellWord(word);
  return dynamic ? word : text;
};

/** True when `token` is a leading `NAME=value` environment-variable assignment — the shape bash
 * itself treats as a prefix to the command it precedes, never as the command itself
 * (`GIT_AUTHOR_NAME=foo git worktree remove x` invokes `git`, not `GIT_AUTHOR_NAME=foo`). */
const isEnvAssignmentToken = (token) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

/** True when `tokens`, from `fromIndex` on, contains `worktree` immediately followed by `remove`
 * — the bounded "looks-dynamic + worktree/remove tokens present" heuristic (Execution Strategy
 * step 2) for an executable position that could not be resolved statically. Each candidate token
 * is normalized via `normalizeShellWord` before comparison — the same normalize-then-compare
 * discipline applied to the executable token itself — so a quoted or escaped spelling (`"remove"`,
 * `remo\ve`) is detected exactly like the literal form; a token whose own normalization is dynamic
 * (`$(...)`, a backtick, `$VAR`) never matches, since dynamic text can't equal a literal string.
 * Narrow by construction: it only ever fires alongside a dynamic executable token (checked by the
 * caller), so it cannot turn an ordinary command that merely mentions these two words into a
 * denial on its own. */
const containsWorktreeRemoveTokens = (tokens, fromIndex) => {
  for (let i = fromIndex; i < tokens.length - 1; i++) {
    const first = normalizeShellWord(tokens[i]);
    if (first.dynamic || first.text !== 'worktree') continue;
    const second = normalizeShellWord(tokens[i + 1]);
    if (second.dynamic || second.text !== 'remove') continue;
    return true;
  }
  return false;
};

/** Skips a `$(...)` command-substitution span starting at `text[start]` (the `$`), honoring
 * nested `(...)`/`$(...)` by simple depth counting over `(`/`)` characters, and returns the index
 * just past its matching closing `)` (or `text.length` if unterminated). Naive and quote-unaware,
 * the same accepted limitation `clauseTailFrom` already has for the separators it stops at — a
 * substitution containing a quoted `)` is not distinguished from a real one. Exists so
 * `clauseTailFrom`'s `)`-boundary stop (F-00058, immediately below) does not ALSO swallow tokens
 * that legitimately follow a `$(...)` executable position in the SAME clause: `$(which git)
 * worktree remove <target>` is one clause whose first word happens to be a command substitution,
 * not two clauses split at that substitution's own closing paren (#788's executable-indirection
 * coverage — the two `)` roles look identical to a naive scan and must not be conflated).
 *
 * `heredocMasked`, when given, is `computeHeredocBodyMask`'s output aligned 1:1 with
 * `text` (the caller slices the full-command array to match `text`'s own slice offset) — a
 * position where it is `true` is skipped without counting toward paren depth, so prose
 * parentheses inside a heredoc body (e.g. "(command substitution or environment-variable
 * indirection)") can never perturb this naive counter into closing the span early or late. */
const skipDollarParenSpan = (text, start, heredocMasked) => {
  let depth = 0;
  let i = start + 1; // the '(' immediately after '$'
  for (; i < text.length; i++) {
    if (heredocMasked && heredocMasked[i]) continue;
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
};

/** The substring of `command` starting at `index` up to (not including) the next shell separator
 * (`;`, `&` when not part of a redirect, `|`, `)`, newline), or to the end of the string — the same
 * clause-scoping as before, now with redirect-aware `&` handling and trailing redirect
 * tokens stripped so `>/dev/null`, `2>/dev/null`, and `2>&1` do not become spurious path args.
 * `)` stops a clause's tail exactly like `;`/`|`/newline already do (F-00058): a subshell's closing
 * paren is not part of the clause it closes, so `(cd a && rm -rf b)` must not let a bare trailing
 * `)` ride into `rm`'s own last token as `b)`. A `$(...)` span is skipped whole via
 * `skipDollarParenSpan` before this check ever sees its interior — its own closing paren is not a
 * clause boundary, only a plain subshell-grouping `(...)`'s is. Naive and quote-unaware otherwise,
 * exactly like the other three separators this function already stops at — a literal `)` inside a
 * quoted argument is not distinguished from a real subshell close, the same accepted limitation
 * `;`/`|`/newline already have (see `findClauseStartIndices`'s docstring on this function).
 *
 * `heredocMasked`, when given, is `computeHeredocBodyMask`'s output over the FULL
 * `command` string (not `rest` — this function slices it to `rest`'s own offset itself). Once
 * `end` is found by the separator scan above — UNCHANGED by this parameter, so a real `;`/`&`/
 * `|`/`)`/`\n` boundary is still found exactly where it always was, even one that happens to sit
 * past a heredoc body — every heredoc-body character in the returned clause text is blanked to a
 * single space before the trailing-redirect strip runs. This is what keeps a heredoc's prose
 * (e.g. containing the literal words `worktree`/`remove`) from contributing tokens to
 * `findRemovalInvocations`'s `.split(/\s+/)` token stream: those characters are spaces by the
 * time this function returns, not merely excluded from the clause's own extent. */
/** Ceiling on the summed length of every clause tail one `findRemovalInvocations` call
 * tokenizes. Disjoint clauses sum to the command length; only deeply nested openers (`((((…`,
 * `{ { { …`, `$($(…`) re-tokenize the same text once per level, so a legitimate command stays
 * orders of magnitude below this while an adversarial one is cut off in ~60 ms. */
const MAX_CLAUSE_SCAN_CHARS = 4_000_000;

/** `findRemovalInvocations` entry (the last one it returns) marking that `MAX_CLAUSE_SCAN_CHARS`
 * was exceeded and the walk stopped; every consumer maps it to `scanBudgetExceededDecision`. */
const SCAN_BUDGET_EXCEEDED = 'scan-budget-exceeded';

/** Most directories `findRemovalInvocations` tracks as a relative path's possible base. */
const MAX_CWD_CANDIDATES = 16;

/** True when the character at `i` ends a clause tail on its own account, ignoring the one
 * position-relative case `clauseTailFrom` handles itself (a clause's very first character). */
const isClauseTailBoundary = (command, i) => {
  const ch = command[i];
  if (ch === ';' || ch === '|' || ch === '\n' || ch === ')') return true;
  // A brace group's closing `}` (F-00064), the `}` counterpart to `)` above: guarded on a
  // preceding whitespace character — the same structural requirement real bash syntax already
  // imposes on this reserved word (`findClauseStartIndices`'s docstring) — so it never
  // truncates a `${VAR}` parameter expansion or a `file{a,b}` brace expansion, neither of
  // which has whitespace before its own `}`.
  if (isBraceGroupClose(command, i)) return true;
  // `&&` and a bare background `&` end the clause; a redirect (2>&1, >&, &>file, &>>file, …) does not.
  return ch === '&' && !isRedirectAmpersand(command, i);
};

/** For every position `i`, the index where a clause tail scanned from `i` ends (`ends[i]`), built
 * in ONE right-to-left pass so `clauseTailFrom` is O(1) per clause instead of a fresh forward
 * scan: a run of `(` or `{ ` opens a clause at every position yet has no boundary to stop any of
 * their tails, which made the per-clause scan quadratic (#1197). A `$(...)` span jumps to its
 * matching `)` exactly like `skipDollarParenSpan`'s depth counting, precomputed here for every
 * `(` with a single stack so the jump is O(1) too. Also returns `nextMasked`, so a clause that
 * holds no heredoc body skips the per-character blanking pass. */
const buildClauseEndTable = (command, heredocMasked) => {
  const n = command.length;
  const closeOf = new Int32Array(n).fill(n); // matching `)` per unmasked `(`; n when unterminated
  const open = [];
  for (let i = 0; i < n; i++) {
    if (heredocMasked && heredocMasked[i]) continue;
    if (command[i] === '(') open.push(i);
    else if (command[i] === ')' && open.length > 0) closeOf[open.pop()] = i;
  }
  const ends = new Int32Array(n + 1);
  const nextMasked = new Int32Array(n + 1); // first heredoc-body position at or after `i`, else n
  ends[n] = n;
  nextMasked[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    nextMasked[i] = heredocMasked && heredocMasked[i] ? i : nextMasked[i + 1];
    if (command[i] === '$' && command[i + 1] === '(') {
      // A masked `(` right after `$` is the one shape the stack above does not model — defer to
      // the depth-counting original for it.
      const past = heredocMasked && heredocMasked[i + 1]
        ? skipDollarParenSpan(command, i, heredocMasked)
        : closeOf[i + 1] === n ? n : closeOf[i + 1] + 1;
      ends[i] = ends[past];
    } else {
      ends[i] = isClauseTailBoundary(command, i) ? i : ends[i + 1];
    }
  }
  return { ends, nextMasked };
};

const TRAILING_REDIRECT_TOKEN_RE = /^(?:2>&1|>&\d*|>>?[^\s;&|]+|\d>>?[^\s;&|]+|&>>?[^\s;&|]+)$/;

const clauseTailFrom = (command, index, heredocMasked, { ends, nextMasked }) => {
  // A clause's own first character has no predecessor within the clause, so `}` is never its
  // closing brace and `&` is a redirect only when `>` follows it.
  let end;
  if (command[index] === '}') end = ends[index + 1];
  else if (command[index] === '&') end = command[index + 1] === '>' ? ends[index + 1] : index;
  else end = ends[index];
  let clause = command.slice(index, end).trimEnd();
  if (heredocMasked && nextMasked[index] < index + clause.length) {
    const chars = new Array(clause.length);
    for (let i = 0; i < clause.length; i++) {
      chars[i] = heredocMasked[index + i] ? ' ' : clause[i];
    }
    clause = chars.join('');
  }
  // Strip one or more trailing shell redirects (2>&1, >/dev/null, 2>/dev/null, &>file, …): the
  // clause's last whitespace-delimited token, when it is one. Checking only that token keeps this
  // linear — an unanchored `\s+(?:…)\s*$` regex retried from every whitespace in a long run.
  while (true) {
    let start = clause.length;
    while (start > 0 && !/\s/.test(clause[start - 1])) start -= 1;
    if (start === 0 || !TRAILING_REDIRECT_TOKEN_RE.test(clause.slice(start))) break;
    clause = clause.slice(0, start).trimEnd();
  }
  return clause;
};

/**
 * Extracts one `cd` clause's own target text (everything after the `cd` executable itself),
 * skipping leading flags (`-L`, `-P`, `-e`, …) — the base-independent half of what used to be
 * `resolveCdTarget`, split out (F-00059) so `findRemovalInvocations` can resolve the SAME target
 * text against more than one candidate base when a `||` makes which prior `cd` actually ran
 * ambiguous (see that function's docstring).
 *
 * Returns the literal target string, or `null` when the target cannot be tracked at all: a
 * dynamic argument ($VAR, $(...), a backtick), `cd -` (the previous-directory shorthand — this
 * module does not track OLDPWD), or a bare `cd` with no argument at all (goes to $HOME, likewise
 * not tracked). `null` is deliberately not a refusal by itself: see `findRemovalInvocations` for
 * how it collapses into the existing, accepted, regression-tested dynamic-`cd` bypass (issue #803
 * AC2) — this split changes what a resolvable target fans out to, never what an unresolvable one
 * falls back to.
 */
const extractCdTargetText = (argTokens) => {
  for (const rawToken of argTokens) {
    const { text, dynamic } = normalizeShellWord(rawToken);
    if (dynamic) return null;
    if (text.startsWith('-') && text.length > 1) continue; // -L, -P, -e, … — flags, not the target
    if (!text || text === '-') return null; // `cd -` (OLDPWD) or an empty target — not tracked
    return text;
  }
  return null; // bare `cd` with no positional argument at all — goes to $HOME, not tracked
};

/** Resolves one `cd` target's literal `text` against one candidate `base` directory — an absolute
 * target ignores `base` entirely, matching `cd`'s own semantics. */
const resolveAgainstBase = (text, base) => (path.isAbsolute(text) ? text : path.resolve(base, text));

/**
 * Every worktree-removing invocation in `command`, in either spelling this guard covers. For the
 * `git worktree remove` spelling the walk is tolerant of global options between `git` and
 * `worktree` (`-C <path>`, `-c k=v`, `--no-pager`, `--git-dir=<path>`, combinations), of more than
 * one such invocation in a chained command, and of leading `NAME=value` assignments before the
 * executable. Each entry is one of:
 *   - `{ kind: 'git', argTokens, resolutionCwds }` — the tokens following `remove` (flags and the
 *     path argument).
 *   - `{ kind: 'git', unresolvableExecutable: true, resolutionCwds }` — the executable position
 *     itself could not be resolved statically (#788 Execution Strategy step 2).
 *   - `{ kind: 'rm', argTokens, resolutionCwds }` — the tokens following an `rm` executable, ready
 *     for a caller to parse. Emitted for EVERY `rm` clause, recursive or not and whatever its
 *     target.
 * Naive whitespace tokenization for everything after the executable token, matching this module's
 * existing convention for the post-`remove` tail (a quoted path containing a literal space is not
 * resolved either way — not a regression, the original code had the same limitation for that
 * argument).
 *
 * `resolutionCwds` (plural, F-00059) is the SET of directories a relative removal-path argument
 * might resolve against — `[cwd]` until (and unless) a `cd` clause earlier in the same command
 * changes it. A `cd` NOT immediately preceded by `||` always runs if the walk reaches it at all
 * (an earlier failed `&&`-chain link means the whole chain, including any dangerous removal later
 * in it, never runs either — nothing left to track), so it REPLACES the tracked set with its own
 * resolved target(s), exactly like the old single-value `effectiveCwd` did. A `cd` immediately
 * preceded by `||` is genuinely ambiguous — bash's exit status decides whether it runs, and this
 * guard does not execute anything to find out — so it instead UNIONS its resolved target(s) into
 * the existing set: the prior candidates remain possible (this `cd` never ran) alongside the new
 * one (it did). A `cd` whose own target cannot be resolved statically (dynamic, `cd -`, bare)
 * collapses to the pre-F-00059 fallback: for a non-`||` `cd` the set resets to `[cwd]` outright
 * (identical to the old `effectiveCwd = null` behavior); for a `||`-guarded `cd` the harness `cwd`
 * is unioned in as a stand-in for "ran but landed somewhere unverifiable" rather than discarding
 * the prior candidates, since the OTHER branch of the `||` may be the one that actually ran and its
 * resolution must not be lost. Either way this can only ever ADD candidates, never silently narrow
 * the set to something an ordinary non-`||` command would already have produced — the same
 * no-new-false-block guarantee `resolveCdTarget`'s dynamic-`cd` fallback already had.
 *
 * A SIXTH case (F-00064/F-00065, PR #880 round 3) is the root cause the first five cases were each
 * one symptom of: `findRemovalInvocations` only ever inspected a clause's OWN first token
 * (`tokens[execIndex]`, right after any `NAME=value` prefixes) as the candidate `cd`/`rm`/`git`.
 * Any other leading word abandoned the whole clause without looking further — so `{ cd <parent> &&
 * rm -rf <basename>; }` (a brace group; `{` was not yet a recognized clause separator) and `eval
 * "cd <parent> && rm -rf <basename>"` (the executable position is textually `eval`, not `cd`) both
 * silently allowed. The fix is deliberately NOT a wrapper name list (`eval`, `command`, `env`,
 * `nohup`, `time`, `builtin`, …): that is the same losing shape as the discriminator blocklist PR
 * #854 abandoned after five iterations — it requires enumerating every wrapper, and the next
 * unlisted one reopens the hole. Instead the walk inverts its own default: when the token at the
 * current cursor is not itself `cd`/`rm`/`git` (and not a dynamic executable position), it no
 * longer abandons the clause — it advances the cursor by one token and tries again, treating the
 * unrecognized word as a possible transparent wrapper rather than as proof there is nothing here.
 * This is closed by construction: an unlisted wrapper is just another token the walk scans past,
 * not a gap in a list. The scan is bounded and terminates the instant it finds `cd`, `rm`, a
 * dynamic executable position, or a CERTAIN `git` (the clause's own first token) whose subcommand
 * check runs to completion, matched or not — once any of those is identified, the tokens after it
 * are that command's OWN arguments, not a second command to keep hunting through (so a `git commit
 * -m "git worktree remove /x"` clause still stops cleanly at `commit`, never re-scanning into the
 * commit message text for a second, spurious match). An UNCERTAIN `git` (found only after skipping
 * unrecognized leading tokens) whose subcommand ISN'T `worktree remove` is the one case the walk
 * does NOT stop at: it resumes scanning instead, because at an uncertain position the walk cannot
 * even be sure `git` is the executable rather than some other command's plain argument (`sudo -u
 * git rm -rf <worktree>` — `git` here is a username, `-u`'s value, not a command) — stopping there
 * would let a coincidental token hide the real `rm` that follows, the identical under-detection
 * this whole fix exists to close, one token later.
 *
 * This generality creates one asymmetry the walk must account for: a `cd`/`rm`/`git` match found at
 * the clause's own first token (cursor 0, after any env-assignment prefix) is CERTAIN to run if the
 * clause runs at all — the same guarantee cases 1-5 above already relied on. A match found only
 * after skipping ≥1 unrecognized leading token is UNCERTAIN, because this walk cannot tell a
 * genuine transparent wrapper (`nohup rm -rf x` really does run `rm`) from an ordinary command whose
 * own arguments merely contain the literal words `cd <path>` (`echo "cd /tmp"` prints text; it does
 * not change directory — and its quoted argument is not masked here the way it would be for
 * `bash-patterns.json`'s regex matcher, so the token walk sees `"cd` and `/tmp"` as ordinary
 * whitespace-split tokens). An uncertain `rm`/`git` match is evaluated exactly like a certain one —
 * finding one to check can only ADD scrutiny a real removal might need, never remove it, so treating
 * it as fully real is safe in the direction this guard already favors (over-tighten, never
 * under-detect). An uncertain `cd` match is different: trusting it to REPLACE the tracked cwd
 * candidate set the way a certain `cd` does could make a later removal resolve against a directory
 * the shell never actually stood in (the `echo` case above), silently losing track of the real one —
 * an under-detection this guard must not introduce. So an uncertain `cd` match's resolved target is
 * UNIONED into the existing candidate set instead, the identical never-narrow discipline case 5
 * above already applies to a `||`-guarded `cd`: the prior candidates are never discarded, only
 * possibly widened, so a real removal at the original, correct cwd is never missed even when the
 * "wrapper" preceding the `cd` turns out to have been an ordinary print/data command all along.
 *
 * Two smaller, mechanical fixes travel with the same round: `{` and `}` join `(`/`)`/`;`/`|`/newline
 * as clause boundaries in `findClauseStartIndices` (so a brace group decomposes into its own
 * clauses at all) and in `clauseTailFrom` (so a brace group's closing `}` cannot ride into a
 * clause's own trailing token the same way an unhandled `)` once could, F-00058). Both are guarded
 * on whitespace immediately before `{`/`}` (and whitespace immediately after `{`) — the same
 * structural requirement real bash syntax already imposes on a brace-group reserved word — so
 * neither collides with `${VAR}` parameter expansion or a `file{a,b}` brace expansion, where the
 * brace is never whitespace-adjacent.
 */
const findRemovalInvocations = (command, cwd) => {
  const masked = computeMaskedSpans(command);
  const heredocMasked = computeHeredocBodyMask(command);
  const clauseTable = buildClauseEndTable(command, heredocMasked);
  const invocations = [];
  let cwdCandidates = [cwd];
  let scannedChars = 0;
  for (const { index: clauseStart, precededByOr } of findClauseStartIndices(command, masked)) {
    if (!isCommandWordStart(command, clauseStart)) continue; // defensive: clause starts are always real word starts
    scannedChars += clauseTable.ends[clauseStart] - clauseStart;
    if (scannedChars > MAX_CLAUSE_SCAN_CHARS) {
      invocations.push({ kind: SCAN_BUDGET_EXCEEDED });
      break;
    }
    const tokens = clauseTailFrom(command, clauseStart, heredocMasked, clauseTable).trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    let cursor = 0;
    while (cursor < tokens.length && isEnvAssignmentToken(tokens[cursor])) cursor += 1;
    if (cursor >= tokens.length) continue;

    // The clause's own first token (post-assignments) is a CERTAIN executable position — it runs
    // if the clause runs at all, the same guarantee every earlier fix case relied on. Any position
    // reached only by scanning past ≥1 unrecognized leading token is UNCERTAIN — this walk cannot
    // tell a genuine transparent wrapper from an ordinary command whose own arguments merely
    // contain the literal words `cd <path>` (see the module docstring's SIXTH case).
    const certainCursor = cursor;

    while (cursor < tokens.length) {
      const { text: executable, dynamic } = normalizeShellWord(tokens[cursor]);
      const resolutionCwds = cwdCandidates;

      if (dynamic) {
        if (containsWorktreeRemoveTokens(tokens, cursor + 1)) {
          invocations.push({ kind: 'git', unresolvableExecutable: true, resolutionCwds });
        }
        break; // a dynamic executable position is terminal — nothing further to resolve here
      }
      if (!executable) {
        cursor += 1; // an empty-normalized token (e.g. a stray `""`) — keep scanning past it
        continue;
      }

      const basename = path.basename(executable);
      const isUncertain = cursor > certainCursor;

      if (basename === 'cd') {
        const text = extractCdTargetText(tokens.slice(cursor + 1));
        if (isUncertain) {
          // Uncertain match: UNION only, never replace — a spurious wrapper misread can only add
          // a candidate, never lose track of the real one (module docstring, SIXTH case).
          if (text !== null) {
            const resolved = cwdCandidates.map((base) => resolveAgainstBase(text, base));
            cwdCandidates = [...new Set([...cwdCandidates, ...resolved])];
          }
        } else if (text === null) {
          cwdCandidates = precededByOr ? [...new Set([...cwdCandidates, cwd])] : [cwd];
        } else {
          const resolved = cwdCandidates.map((base) => resolveAgainstBase(text, base));
          cwdCandidates = precededByOr ? [...new Set([...cwdCandidates, ...resolved])] : [...new Set(resolved)];
        }
        // Each `||`-guarded or uncertain `cd` can double the candidate set (a `cd d0 || cd d1 || …`
        // chain is 2^n directories); past the cap the verdict is fail-closed, not a longer walk.
        if (cwdCandidates.length > MAX_CWD_CANDIDATES) {
          invocations.push({ kind: SCAN_BUDGET_EXCEEDED });
          return invocations;
        }
        break; // `cd`'s own remaining tokens are its target/flags, not a second command to scan
      }

      if (basename === 'rm') {
        invocations.push({ kind: 'rm', argTokens: tokens.slice(cursor + 1), resolutionCwds });
        break; // `rm`'s own remaining tokens are its arguments, not a second command to scan
      }

      if (basename === 'git') {
        const subcommandIndex = skipGitGlobalOptions(tokens, cursor + 1);
        const subcommandWord = subcommandIndex === -1 ? null : normalizeShellWord(tokens[subcommandIndex]);
        const actionWord =
          subcommandIndex === -1 || subcommandIndex + 1 >= tokens.length
            ? null
            : normalizeShellWord(tokens[subcommandIndex + 1]);
        if (
          subcommandWord && actionWord &&
          !subcommandWord.dynamic && !actionWord.dynamic &&
          subcommandWord.text === 'worktree' && actionWord.text === 'remove'
        ) {
          invocations.push({ kind: 'git', argTokens: tokens.slice(subcommandIndex + 2), resolutionCwds });
          break; // identified `git worktree remove` — its own tail is the path argument, not a second command
        }
        // ADR-043 (#897): a second subcommand match, admitted only from the CERTAIN executable
        // position — an UNCERTAIN `git` (reached only by skipping unrecognized leading tokens,
        // e.g. `gh pr comment --body "... git checkout -- ."`) never emits this invocation, so a
        // PR comment quoting a destructive git command is not itself treated as one (design note
        // § Adversarial Evaluation mitigation 2). The subcommand→tier decision itself is entirely
        // git-main-clone-guard.js's — this walk hands over every non-"worktree remove" CERTAIN git
        // subcommand unfiltered, so the one subcommand vocabulary stays single-sourced there.
        if (!isUncertain && subcommandIndex !== -1) {
          invocations.push({
            kind: 'git-mutation',
            subcommand: unquoteWord(tokens[subcommandIndex]),
            argTokens: tokens.slice(subcommandIndex + 1).map(unquoteWord),
            repoOverride: extractGitRepoOverride(tokens, cursor + 1),
            resolutionCwds,
          });
          break; // identified a git subcommand — its own tail is its arguments, not a second command
        }
        if (!isUncertain) break; // a CERTAIN `git` with an unparseable global-option run (subcommandIndex === -1)
        // An UNCERTAIN `git` that isn't `worktree remove` might not even be the executable at all —
        // e.g. `sudo -u git rm -rf <worktree>`, where `git` is a flag's VALUE (a username), not a
        // command. Stopping here would let the wrapper walk itself hide the real `rm` that follows.
        // Keep scanning rather than let a coincidental token stand in for "nothing here" (same
        // "not yet found, not proven absent" discipline the whole walk applies to leading tokens).
        cursor += 1;
        continue;
      }

      // Unrecognized token — possibly a transparent wrapper (`eval`, `command`, `env`, `nohup`,
      // `time`, `builtin`, or one not yet named): keep scanning rather than abandoning the clause
      // (F-00064/F-00065, module docstring SIXTH case).
      cursor += 1;
    }
  }
  return invocations;
};

/** True when `arg` is a literal path this hook can resolve without executing anything — no shell
 * variable (`$VAR`, `${VAR}`), command substitution (`$(...)`, `` `...` ``), glob metacharacter,
 * parenthesis, or quote character. A dynamic argument cannot be resolved by static inspection, so
 * the unpushed-commit check below has nothing to run against — same "cannot verify, must refuse"
 * posture pattern-loader.js takes for a pattern file it cannot parse. `(`/`)` are rejected here as
 * defense in depth (F-00058): after `clauseTailFrom`'s own fix, an unmasked `)` can no longer reach
 * a token via that path at all, but a path argument built any other way (e.g. a future tokenizer
 * change) should not silently treat a stray paren as an ordinary path character either. `'`/`"` are
 * rejected the same way, for the same reason: a stray quote reaching this check should not be
 * silently accepted as an ordinary path character;
 * no real filesystem path ever legitimately contains one. */
const isLiteralPathArg = (arg) => arg.length > 0 && !/['"$`*?[\]{}()]/.test(arg);

module.exports = {
  SCAN_BUDGET_EXCEEDED,
  MAX_CWD_CANDIDATES,
  isLiteralPathArg,
  findRemovalInvocations,
  extractCdTargetText,
  skipGitGlobalOptions,
  extractGitRepoOverride,
  isCommandWordStart,
  findClauseStartIndices,
  normalizeShellWord,
};

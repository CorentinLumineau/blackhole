#!/usr/bin/env bun
'use strict';

/**
 * worktree-removal-guard.js — dynamic PreToolUse check for `git worktree remove` (#532).
 *
 * Everything else in this hook tree is a static regex against the command string
 * (`bash-patterns.json` + `pattern-loader.js`). This check cannot be: "is it safe to remove this
 * worktree" depends on the pushed/unpushed state of its branch, which no regex over the command
 * text can see — it requires actually shelling out to `git log` against the worktree in question.
 * That is why this lives in its own module rather than as another `bash-patterns.json` entry.
 *
 * `git worktree remove` refuses on a dirty working tree (uncommitted or untracked changes) by
 * default — git's own native check. `--force` bypasses that refusal, which is why this module
 * adds a mechanical `git status --porcelain` check of its own, gated on `force` (issue #777):
 * the one removal path with no native safety net at all (issue #532 item 1) now gets one here
 * instead. Neither form of the command refuses on committed-but-unpushed history
 * (`blackhole-protocol.md` § Branch & Worktree Hygiene, `recovery-protocol.md` §6(c)) — the
 * orchestrator lost a real commit this way (F-00117) before that gap was closed with prose
 * alone (#526). This module makes both checks mechanical: it denies the removal (V-HOOK-01)
 * when the worktree's branch carries commits its remote does not have, for `--force` exactly
 * as for a plain removal, and it denies a `--force` removal separately when the working tree
 * itself is unclean.
 *
 * `@{u}` is not enough on its own: this campaign creates worktrees with `--no-track` and pushes
 * by an explicit refspec, never `-u` (#516) — so "no upstream configured" is the ROUTINE case for
 * a campaign worktree, not a rare edge. A naive implementation that treats an `@{u}` resolution
 * failure as "nothing unpushed" would silently allow every removal. `git push` still updates the
 * branch's remote-tracking ref opportunistically even without `-u` (git >= 1.8.4), so
 * `refs/remotes/origin/<branch>` is the reliable fallback comparison point once `@{u}` is absent.
 * A *resolvable* `@{u}` is also not automatically trustworthy: it is validated against the branch
 * name before use (its remote-tracking path must end in `/<branch>`), because a misconfigured or
 * stale upstream can resolve to a DIFFERENT branch's remote-tracking ref and produce a false
 * `'unpushed'` verdict on a branch that is actually fully pushed under its own name (#781). A
 * mistracked `@{u}` falls back to the same `refs/remotes/origin/<branch>` ref as the "no upstream"
 * case above.
 *
 * Matching detail (review round on #532's own PR): a plain `\bgit\s+worktree\s+remove\b` regex
 * requires `git` and `worktree` to sit whitespace-adjacent, so ANY git global option between them
 * — `-C <path>`, `-c k=v`, `--no-pager`, `--git-dir=<path>` — bypassed detection entirely. That
 * form is not exotic: #528/`0dc64ec` mandates `git -C <path> ...` campaign-wide, so the bypassing
 * form is the one the campaign now *always* uses. This module instead walks CLAUSE STARTS
 * (`findClauseStartIndices` below — the position right after `;`, a non-redirect `&`, `|`, `(`,
 * or a newline, never plain whitespace, which only ever separates two tokens of the SAME clause):
 * at each clause's own first token, normalize it (`normalizeShellWord`) and compare its basename
 * against `git`, then skip recognized global options (`skipGitGlobalOptions`) and check whether
 * `worktree remove` follows. Restricting the executable search to a clause's first token — never
 * any later token — is what makes an argument like `--git-dir=/x/git` (basename coincidentally
 * `git`) impossible to mistake for a second invocation, with no per-argument exemption needed.
 * The same walk also fixes a second bug: the original code inspected only the first match in a
 * command and returned, so a second `git worktree remove` in a chained command (`cmd1 && cmd2`)
 * was never checked. `evaluateWorktreeRemoval` now inspects every invocation found in the command
 * and denies if ANY of them is unsafe.
 *
 * A clause's first token is normalized via `normalizeShellWord` — reconstructing what bash's own
 * quote-removal would produce (concatenating adjacent quoted/unquoted/escaped fragments, e.g.
 * `g""it` -> `git`) — before its basename is compared against `git`: one code path covering every
 * literal spelling (`\git`, `"git"`, `'git'`, `"/usr/bin/git"`, `g""it`, …), not a growing list of
 * per-spelling exemptions. A clause's first token whose executable position is itself dynamic
 * (`$(...)`, a backtick, or a bare `$VAR`/`${VAR}`
 * reference — `normalizeShellWord`'s `dynamic: true` result) can never be resolved statically;
 * `$(which git)` / `GIT=... $GIT` indirection is refused outright via
 * `worktree-remove-unresolvable-path` rather than silently allowed, following the same
 * "cannot verify, must refuse" posture as an unresolvable path argument. A leading `NAME=value`
 * assignment (or a run of them) is skipped before the executable check, matching how bash itself
 * reads `GIT_AUTHOR_NAME=foo git worktree remove x` — the assignment is not the executable.
 *
 * A recursive `rm` straight at the worktree directory reaches the same destruction by a different
 * spelling, and until #803 it was the one removal path guarded on nothing at all — so every
 * refusal class above raised the incentive to use it. It is recognized by the same clause walk and
 * the same `normalizeShellWord` basename comparison, and once its target resolves to a registered
 * LINKED worktree (`isRegisteredLinkedWorktree`) it runs the identical check functions, never a
 * second copy of them. Two asymmetries against the `git worktree remove` path are deliberate, both
 * for the same reason — an `rm` argument is an ordinary path until proven otherwise, where a `git
 * worktree remove` argument is a worktree by the command's own declaration:
 *   - The dirty-tree check always applies (`RM_REMOVAL_SHAPE.checkDirty`), not only under a force
 *     flag: `rm -r` has no native refusal for git to bypass, making it strictly weaker than a
 *     plain `git worktree remove`.
 *   - A target that cannot be resolved statically (`$VAR`, a glob, a command substitution) or
 *     whose worktree registration cannot be read is ALLOWED, the opposite of the fail-closed
 *     posture every check below takes. Refusing what cannot be verified is right when the command
 *     is already known to target a worktree; applied to `rm` it would attach a new refusal to
 *     every `rm -rf "$dir"` in the repo, which is the over-tightening this guard must not
 *     introduce (issue #803 AC2). The residual bypass — a recursive rm whose worktree target is
 *     spelled dynamically — is accepted knowingly, and pinned by its own regression test.
 *
 * A THIRD case looked like the same accepted bypass but was not: `cd <real-parent> && rm -rf
 * <basename>`, a fully STATIC relative path, was resolved against the harness's pre-execution
 * `cwd` rather than the `cd` destination the shell would actually be standing in when `rm` ran —
 * so a literal, resolvable target was reported as "not a registered worktree" purely because it
 * was resolved against the wrong directory (F-00043, review round on PR #880; the `git worktree
 * remove` counterpart happened to fail closed on the same wrong resolution only because a
 * nonexistent `-C` target makes every check function error out to `'unknown'`, not because it was
 * actually verifying anything). `findRemovalInvocations` now simulates a resolvable `cd` between
 * clauses of the SAME command (`resolveCdTarget`) and resolves each later invocation's relative
 * argument against that tracked cwd instead. Only a `cd` whose own target is itself dynamic (or
 * `cd -`, or bare `cd`) falls back to the original `cwd` — collapsing into the existing, accepted,
 * regression-tested dynamic-target bypass immediately above, deliberately, so this fix cannot turn
 * an ordinary `cd "$BUILD_DIR" && rm -rf dist` into a new false block.
 *
 * A FOURTH case surfaced on the same PR #880 review round (F-00058): `(cd <parent> && rm -rf
 * <basename>)` — the identical fix-three shape wrapped in a subshell, an ordinary idiom for
 * running cleanup without mutating the caller's own cwd, not an adversarial spelling. Before this
 * fix, `clauseTailFrom` had no notion of `)` as a boundary at all, so the closing paren rode into
 * the `rm` clause's own tail and became part of its last token — `wt-803)` rather than `wt-803` —
 * which then matched no registered worktree and was silently allowed, the same asymmetry F-00043
 * reported, just reached through a different command shape. `clauseTailFrom` now stops a clause's
 * tail at the first unmasked `)`, exactly as it already does for `;`, `|`, and newline — a genuine
 * parsing-model fix (a paren can no longer be absorbed into ANY clause's trailing token, not just
 * this one shape), not an enumerated fix for this one spelling. `isLiteralPathArg` additionally
 * rejects a literal `(`/`)` in a path argument as defense in depth, though after the
 * `clauseTailFrom` fix no unmasked paren can reach a token via that path at all — see that
 * function's docstring. Nested and `$(...)`-command-substitution parens get the same flat,
 * non-balance-tracking treatment `(` already had as a clause-start trigger — no new asymmetry
 * introduced between the two paren roles.
 *
 * A FIFTH case is control-flow-blind `cd` tracking itself: `cd <real-parent> || cd <anything> &&
 * rm -rf <basename>` (F-00059). Bash groups `&&`/`||` left-to-right at equal precedence, so this
 * is `(cd <real-parent> || cd <anything>) && rm -rf <basename>` — when the first `cd` succeeds,
 * the second one never runs at all, and the shell is left standing in `<real-parent>` when `rm`
 * runs. The pre-fix walk applied every `cd` clause in textual order with no model of `&&`/`||`/`;`
 * at all, so it applied BOTH `cd`s unconditionally and resolved `rm`'s target against `<anything>`
 * — a directory that was never actually the shell's cwd — finding no registered worktree there and
 * allowing the removal. Which branch of a `||` a real shell takes is undecidable from static text
 * alone (it depends on the exit status of a command this guard does not execute), so
 * `findRemovalInvocations` does not attempt to resolve it. Instead it tracks a SET of candidate
 * cwds rather than one: a `cd` clause immediately preceded by `||` unions its own resolved target
 * into the running set alongside every cwd already tracked (the outcome if that `cd` never ran),
 * rather than replacing it outright the way a `;`/`&&`/first-clause `cd` still does (those are
 * never ambiguous — if an earlier command in a `&&` chain fails, the chain simply never reaches the
 * dangerous final command at all, so there is nothing left to fear from the cwd it would have
 * produced). `evaluateOneInvocation`/`evaluateRmInvocation` then resolve a relative removal target
 * against EVERY candidate in the set and block if ANY of them names an unsafe registered worktree.
 * This is deliberately narrower than a blanket "refuse whenever more than one `cd` could apply"
 * rule: an ordinary `cmd1 && cd real && rm -rf x` still resolves to exactly one candidate (no `||`
 * anywhere in it), so it is exactly as permissive as before. The ambiguity-widening fires only for
 * a `||`-guarded `cd`, and even then only ever escalates to a block when one of the resulting
 * candidates actually names a registered worktree with unsafe state — it can never turn an
 * ordinary, worktree-unrelated `||`-guarded `cd` into a new false block.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { computeMaskedSpans } = require('./bash-context');

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
 * does not separately track). Returns -1 when a value-taking option has no following token (the
 * clause ends mid-option) — the caller treats that exactly like "not a worktree remove
 * invocation here", not a match. */
const skipGitGlobalOptions = (tokens, start) => {
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];
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
  return i;
};

/** True when the character immediately before `index` is a real shell word boundary — start of
 * string, whitespace, or a command separator (`;`, `&`, `|`, `(`, newline) — not merely "any
 * non-word character". Used below only as a defensive assertion that a clause-start index really
 * is one (`findClauseStartIndices` guarantees this by construction), not as the primary detection
 * mechanism — see that function's docstring for why scanning for `git`-shaped substrings directly
 * (this predicate's original #532 role) cannot cover every executable spelling (#788). */
const isCommandWordStart = (command, index) => index === 0 || /[\s;&|(\n]/.test(command[index - 1]);

/** Every position in `command` that begins a new clause: index 0 (after any leading whitespace),
 * and the first non-whitespace, unmasked position following each unmasked clause separator (`;`,
 * a non-redirect `&`, `|`, `(`, or newline). Deliberately narrower than `isCommandWordStart`'s own
 * boundary set: plain whitespace also appears there, but whitespace alone separates two tokens of
 * the SAME clause (an argument, never a new command) — admitting it here would let an argument
 * like `--git-dir=/x/git` (basename coincidentally `git`, no `.git` suffix) be misread as a
 * second invocation, the exact collision a plain "any word start" scan would reintroduce.
 * Restricting the executable-word search below to a clause's own first token makes that collision
 * impossible by construction, with no per-argument exemption list needed. A separator inside a
 * quoted string is not distinguished from a real one here — the same naive, quote-unaware
 * limitation `clauseTailFrom` below already has for the clause tail it returns; this only affects
 * where a clause is judged to START, the mirror image of that pre-existing, accepted limitation.
 *
 * Returns `{ index, precededByOr }` entries rather than bare indices (F-00059): `precededByOr` is
 * true only when the separator immediately before this clause is `||`, distinguished here from a
 * single `|` (an ordinary pipe) exactly the way `&&` is already distinguished from a single `&`
 * below — a two-character lookahead at the boundary, not a growing exemption list. Every other
 * separator (`;`, `\n`, `(`, `&`, `&&`, a lone `|`) is reported as `precededByOr: false`, including
 * the very first clause (nothing precedes it). `findRemovalInvocations` is the only reader of this
 * field, and only for a `cd` clause — see its docstring for why `||` alone needs this and `&&`/`;`
 * do not.
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
    if (ch === '|') {
      const isOr = command[i + 1] === '|';
      i = skipToStart(isOr ? i + 2 : i + 1, isOr);
      continue;
    }
    if (ch === '&') {
      const prev = i > 0 ? command[i - 1] : '';
      const next = i + 1 < n ? command[i + 1] : '';
      if (prev === '>' || next === '>') {
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
          text += word[j + 1];
          j += 2;
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
 * coverage — the two `)` roles look identical to a naive scan and must not be conflated). */
const skipDollarParenSpan = (text, start) => {
  let depth = 0;
  let i = start + 1; // the '(' immediately after '$'
  for (; i < text.length; i++) {
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
 * `;`/`|`/newline already have (see `findClauseStartIndices`'s docstring on this function). */
const clauseTailFrom = (command, index) => {
  const rest = command.slice(index);
  let end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '$' && rest[i + 1] === '(') {
      i = skipDollarParenSpan(rest, i) - 1; // loop's own i++ lands just past the matched ')'
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n' || ch === ')') {
      end = i;
      break;
    }
    if (ch === '&') {
      const prev = i > 0 ? rest[i - 1] : '';
      const next = i + 1 < rest.length ? rest[i + 1] : '';
      if (prev === '>') continue; // 2>&1, >&, >>&
      if (next === '>') continue; // &>file, &>>file
      end = i; // &&, bare background &, or other non-redirect &
      break;
    }
  }
  let clause = rest.slice(0, end).trimEnd();
  // Strip one or more trailing shell redirects (2>&1, >/dev/null, 2>/dev/null, &>file, …).
  const TRAILING_REDIRECT_RE =
    /\s+(?:2>&1|>&\d*|>>?[^\s;&|]+|\d>>?[^\s;&|]+|&>>?[^\s;&|]+)\s*$/;
  while (TRAILING_REDIRECT_RE.test(clause)) {
    clause = clause.replace(TRAILING_REDIRECT_RE, '').trimEnd();
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
 *     path argument), ready for `parseWorktreeRemoveArgs`.
 *   - `{ kind: 'git', unresolvableExecutable: true, resolutionCwds }` — the executable position
 *     itself could not be resolved statically (#788 Execution Strategy step 2).
 *   - `{ kind: 'rm', argTokens, resolutionCwds }` — the tokens following an `rm` executable, ready
 *     for `parseRmRemovalArgs`. Emitted for EVERY `rm` clause, recursive or not and whatever its
 *     target: whether it removes a registered worktree is a question only
 *     `evaluateRmInvocation` can answer, since it needs the resolved path.
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
 */
const findRemovalInvocations = (command, cwd) => {
  const masked = computeMaskedSpans(command);
  const invocations = [];
  let cwdCandidates = [cwd];
  for (const { index: clauseStart, precededByOr } of findClauseStartIndices(command, masked)) {
    if (!isCommandWordStart(command, clauseStart)) continue; // defensive: clause starts are always real word starts
    const tokens = clauseTailFrom(command, clauseStart).trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    let execIndex = 0;
    while (execIndex < tokens.length && isEnvAssignmentToken(tokens[execIndex])) execIndex += 1;
    if (execIndex >= tokens.length) continue;

    const { text: executable, dynamic } = normalizeShellWord(tokens[execIndex]);
    const resolutionCwds = cwdCandidates;

    if (dynamic) {
      if (containsWorktreeRemoveTokens(tokens, execIndex + 1)) {
        invocations.push({ kind: 'git', unresolvableExecutable: true, resolutionCwds });
      }
      continue;
    }
    if (!executable) continue;

    const basename = path.basename(executable);

    if (basename === 'cd') {
      const text = extractCdTargetText(tokens.slice(execIndex + 1));
      if (text === null) {
        cwdCandidates = precededByOr ? [...new Set([...cwdCandidates, cwd])] : [cwd];
      } else {
        const resolved = cwdCandidates.map((base) => resolveAgainstBase(text, base));
        cwdCandidates = precededByOr ? [...new Set([...cwdCandidates, ...resolved])] : [...new Set(resolved)];
      }
      continue;
    }

    if (basename === 'rm') {
      invocations.push({ kind: 'rm', argTokens: tokens.slice(execIndex + 1), resolutionCwds });
      continue;
    }
    if (basename !== 'git') continue;

    const subcommandIndex = skipGitGlobalOptions(tokens, execIndex + 1);
    if (subcommandIndex === -1) continue;
    if (tokens[subcommandIndex] !== 'worktree' || tokens[subcommandIndex + 1] !== 'remove') continue;
    invocations.push({ kind: 'git', argTokens: tokens.slice(subcommandIndex + 2), resolutionCwds });
  }
  return invocations;
};

/** True when `arg` is a literal path this hook can resolve without executing anything — no shell
 * variable (`$VAR`, `${VAR}`), command substitution (`$(...)`, `` `...` ``), glob metacharacter, or
 * parenthesis. A dynamic argument cannot be resolved by static inspection, so the unpushed-commit
 * check below has nothing to run against — same "cannot verify, must refuse" posture
 * pattern-loader.js takes for a pattern file it cannot parse. `(`/`)` are rejected here as defense
 * in depth (F-00058): after `clauseTailFrom`'s own fix, an unmasked `)` can no longer reach a token
 * via that path at all, but a path argument built any other way (e.g. a future tokenizer change)
 * should not silently treat a stray paren as an ordinary path character either. */
const isLiteralPathArg = (arg) => arg.length > 0 && !/[$`*?[\]{}()]/.test(arg);

/** Splits the token array following `worktree remove` into `{ force, pathArg }`. `--force` or
 * `-f` may appear before or after the path. Anything else — a second flag, `--`, no path, more
 * than one positional argument — leaves `pathArg` null, and the caller treats that exactly like a
 * dynamic argument: nothing static to verify, so refuse. */
const parseWorktreeRemoveArgs = (argTokens) => {
  let force = false;
  const positional = [];
  for (const token of argTokens) {
    if (token === '--force' || token === '-f') {
      force = true;
    } else {
      positional.push(token);
    }
  }
  if (positional.length !== 1) return { force, pathArg: null };
  return { force, pathArg: positional[0] };
};

/** Splits the token array following an `rm` executable into `{ recursive, positional }`. Only the
 * recursive flag is extracted, in every spelling that enables it (`-r`, `-R`, any cluster
 * containing one such as `-rf`/`-fr`/`-rv`, a split `-r -f`, and the long `--recursive`): without
 * it `rm` cannot remove a directory at all, so a non-recursive call can never remove a worktree
 * and is left alone. `-f` is deliberately NOT tracked — unlike `git worktree remove`'s `--force`
 * it gates nothing here (see `RM_REMOVAL_SHAPE`). Every token is put through `normalizeShellWord`
 * first, the same discipline the executable token gets, so a quoted or escaped flag or path is
 * read exactly like its bare spelling. Unlike `parseWorktreeRemoveArgs` this keeps EVERY
 * positional argument rather than requiring exactly one: `rm -rf a b c` is an ordinary shape, and
 * a worktree among several targets must still be found. A token whose own normalization is
 * dynamic is dropped rather than refused — see the module docstring on why this path allows what
 * it cannot resolve. */
const parseRmRemovalArgs = (argTokens) => {
  let recursive = false;
  const positional = [];
  let afterDoubleDash = false;
  for (const rawToken of argTokens) {
    const { text, dynamic } = normalizeShellWord(rawToken);
    if (dynamic) continue;
    if (afterDoubleDash) {
      positional.push(text);
      continue;
    }
    if (text === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (text.startsWith('--')) {
      if (text === '--recursive') recursive = true;
      continue;
    }
    if (text.startsWith('-') && text.length > 1) {
      if (/[rR]/.test(text.slice(1))) recursive = true;
      continue;
    }
    positional.push(text);
  }
  return { recursive, positional };
};

const git = (args, cwd) =>
  execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], cwd }).trim();

/** The canonical form of `candidate` for comparing a command's path argument against a path `git
 * worktree list` printed: trailing slashes dropped, symlinks resolved when the path exists. Falls
 * back to the trimmed string when it does not — an unresolvable target cannot match a registered
 * worktree either way, so the fallback only ever produces a non-match. */
const canonicalPath = (candidate) => {
  const trimmed = candidate.replace(/\/+$/, '') || '/';
  try {
    return fs.realpathSync(trimmed);
  } catch {
    return trimmed;
  }
};

/**
 * True when `resolvedPath` is a registered LINKED worktree — the exact set `git worktree remove`
 * itself can target, resolved the only way it can be (`git worktree list --porcelain`; this is
 * why the whole module exists outside `bash-patterns.json`). The listing is taken from the target
 * path itself, not from `cwd`, so a worktree belonging to a repo the caller is not standing in is
 * still recognized; `cwd` is only the spawn directory, which must be a real one.
 *
 * The main working tree is excluded — it is `git worktree list`'s documented first entry, and
 * `git worktree remove` refuses it outright ("is a main working tree"), so there is no check to
 * mirror for it. Including it would instead attach a brand-new refusal to `rm -rf <any clone
 * root>`, exactly the over-tightening this must not introduce. A path INSIDE a worktree is not the
 * worktree either: removing files under it is not removing it.
 *
 * `allWorktreeRoots` (hook-event-log.js) is deliberately not reused despite running the same git
 * command: its own docstring records that it is NOT every registered worktree but a narrowed
 * containment-trust list (main-clone- and scratchpad-nested only), because trusting an arbitrary
 * registered worktree there would widen a write allow-list (#510/F-00088). Reusing it here would
 * invert that narrowing into an under-detection — a worktree it filters out would be silently
 * removable — so the two ask genuinely different questions of the same output.
 *
 * Fail-OPEN by design, the opposite posture to every check below: anything unresolvable (path
 * gone, not a git repo, git unavailable) is reported as "not a worktree". See the module docstring.
 */
const isRegisteredLinkedWorktree = (resolvedPath, cwd) => {
  let listing;
  try {
    listing = git(['-C', resolvedPath, 'worktree', 'list', '--porcelain'], cwd);
  } catch {
    return false;
  }
  const registered = listing
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
  const target = canonicalPath(resolvedPath);
  return registered.slice(1).some((root) => canonicalPath(root) === target);
};

/**
 * Resolves whether a detached-HEAD `worktreePath` is safe to remove — the reachability rung
 * `checkUnpushedCommits` falls into below when there is no branch name to compare at all.
 * A review worktree (`phase-review.md`) is *always* detached by construction — `git worktree add
 * --no-track origin/<branch>` is rejected outright by git, so `--detach` is the only way to check
 * out a PR head — so this is the routine shape of every review worktree, not an edge case.
 *
 * Deliberately checks `refs/remotes/` only, never `refs/heads/`: `checkUnpushedCommits`'s
 * named-branch path immediately below never treats "some other local branch also points here" as
 * proof of "pushed" — only a remote-tracking ref counts. Accepting `refs/heads/` containment here
 * would make a detached worktree *more* permissive than a named-branch worktree in the identical
 * repo state (HEAD reachable only from another local branch, never pushed) — an inconsistency in
 * the guard's own safety bar, not a generalization of it. Both paths must ask the identical
 * question: "is this commit known-pushed?"
 *
 * Two outcomes:
 *  - `{ status: 'clean' }` — HEAD is reachable from at least one `refs/remotes/` ref. Allow.
 *  - `{ status: 'unknown', detached: true, detail }` — HEAD could not be resolved, or is reachable
 *    from no remote-tracking ref at all (never pushed anywhere). Deny — fail-closed exactly as
 *    the named-branch path below.
 */
const checkDetachedReachability = (worktreePath) => {
  let sha;
  try {
    sha = git(['-C', worktreePath, 'rev-parse', 'HEAD'], worktreePath);
  } catch (error) {
    return { status: 'unknown', detached: true, detail: `could not resolve HEAD in ${worktreePath} (${error.message})` };
  }

  let containingRemotes;
  try {
    containingRemotes = git(
      ['-C', worktreePath, 'for-each-ref', '--contains', sha, '--format=%(refname)', 'refs/remotes/'],
      worktreePath,
    );
  } catch (error) {
    return {
      status: 'unknown',
      detached: true,
      detail: `could not check remote-tracking refs containing ${sha} in ${worktreePath} (${error.message})`,
    };
  }
  if (containingRemotes) {
    return { status: 'clean' };
  }
  return {
    status: 'unknown',
    detached: true,
    detail: `${sha} in ${worktreePath} is not reachable from any refs/remotes/ ref`,
  };
};

/**
 * Resolves whether `worktreePath`'s working tree has uncommitted or untracked changes — the
 * state a single `--force` bypasses at the git level (`git help worktree`: "Only clean
 * worktrees (no untracked files and no modification in tracked files) can be removed...
 * remove refuses to remove an unclean worktree unless --force is used"). Runs `git status
 * --porcelain` in its default mode (untracked files included, not `--untracked-files=no`):
 * a single `--force` discards untracked-only dirt exactly as it discards tracked
 * modifications, so excluding untracked files here would make this check strictly narrower
 * than the git behavior it exists to backstop (issue #777).
 *
 * Three outcomes:
 *  - `{ status: 'dirty', detail }` — porcelain output is non-empty. Deny.
 *  - `{ status: 'clean' }` — porcelain output is empty. Allow (falls through to
 *    checkUnpushedCommits/checkDetachedReachability).
 *  - `{ status: 'unknown', detail }` — could not run `git status` (bad path, not a repo at
 *    that path). Deny — fail-closed, same posture as checkUnpushedCommits's own 'unknown'
 *    outcome. Reuses the same `pattern_id` as the confirmed-dirty case rather than minting a
 *    second one: this outcome names the same risk (cannot confirm the worktree is safe to
 *    discard), just from a different cause, and the issue's own AC1 asks for exactly one new
 *    `pattern_id` for this check — the `reason` string still carries the specific cause.
 */
const checkDirtyWorktree = (worktreePath) => {
  let porcelain;
  try {
    porcelain = git(['-C', worktreePath, 'status', '--porcelain'], worktreePath);
  } catch (error) {
    return {
      status: 'unknown',
      detail: `could not run git status in ${worktreePath} (${error.message})`,
    };
  }
  if (porcelain) {
    return { status: 'dirty', detail: porcelain.split('\n').slice(0, 5).join('; ') };
  }
  return { status: 'clean' };
};

/**
 * Resolves whether `worktreePath`'s current branch carries commits its remote does not have.
 * Three outcomes:
 *  - `{ status: 'unpushed', detail }` — HEAD has commits the remote lacks. Deny.
 *  - `{ status: 'clean' }` — HEAD matches (or is behind) the remote. Allow.
 *  - `{ status: 'unknown', detail }` — could not be determined: bad path, or the branch was never
 *    pushed at all (no `@{u}` AND no matching `refs/remotes/origin/<branch>`). Deny. This
 *    deliberately diverges from `validate-file-changes.js`'s "fail-open, per-check" convention
 *    for its git-containment sub-check: that convention is safe because a Write/Edit call can
 *    legitimately happen outside any git context at all, so skipping a git-dependent sub-check
 *    there degrades to "the other, git-independent checks still ran". A `git worktree remove`
 *    call is *always* in a git context by definition — an unresolvable state here is not "check
 *    inapplicable", it is exactly the highest-risk case this guard exists to catch (a branch that
 *    was never pushed anywhere is, by definition, 100% unpushed). A detached HEAD (no branch name
 *    at all) is delegated to `checkDetachedReachability` above rather than treated as
 *    unconditionally unknown (#761).
 */
const checkUnpushedCommits = (worktreePath) => {
  let branch;
  try {
    branch = git(['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
  } catch (error) {
    return { status: 'unknown', detail: `could not resolve HEAD in ${worktreePath} (${error.message})` };
  }
  if (!branch || branch === 'HEAD') {
    return checkDetachedReachability(worktreePath);
  }

  let upstream = null;
  try {
    upstream = git(['-C', worktreePath, 'rev-parse', '--symbolic-full-name', '@{u}'], worktreePath);
  } catch {
    // No upstream configured — the routine case for a --no-track campaign worktree (#516), not
    // an error by itself. Fall back to the branch's remote-tracking ref below.
  }

  // A resolvable `@{u}` is not sufficient on its own: it may point at a DIFFERENT branch's
  // remote-tracking ref (misconfigured or stale tracking config), which would compare HEAD
  // against the wrong history and produce a false 'unpushed' verdict on a branch that is
  // actually fully pushed under its own name (#781). Trust `upstream` only when its own
  // remote-tracking path segment names this branch; otherwise fall back to the constructed
  // ref exactly as when no upstream is configured at all.
  const upstreamTracksThisBranch = upstream !== null && upstream.endsWith(`/${branch}`);
  const compareRef = upstreamTracksThisBranch ? upstream : `refs/remotes/origin/${branch}`;
  let unpushed;
  try {
    unpushed = git(['-C', worktreePath, 'log', '--oneline', `${compareRef}..HEAD`], worktreePath);
  } catch (error) {
    return {
      status: 'unknown',
      detail: `${compareRef} does not exist — branch "${branch}" has no known pushed state (${error.message})`,
    };
  }
  if (unpushed) {
    return { status: 'unpushed', detail: unpushed.split('\n').slice(0, 5).join('; ') };
  }
  return { status: 'clean' };
};

/**
 * Shared prose for a `status: 'unknown'` refusal below — the dirty-worktree, detached-HEAD and
 * named-branch outcomes share an identical opening clause and closing clause and differ only in
 * what could not be verified (`claim`) and the remedy paragraph appended after this by the
 * caller.
 */
const unverifiableRefusalOpener = (resolvedPath, claim, detail) =>
  `Could not verify ${resolvedPath} ${claim} (${detail}) — refusing rather than risk silent ` +
  `data loss.`;

const GITHUB_RETAINS_PR_HEADS_NOTE =
  '(GitHub retains PR head refs permanently, so this gives a true answer instead of bypassing the ' +
  'check)';

const NEVER_PUSHED_ANYWHERE_SUFFIX =
  'was genuinely never pushed anywhere has no non-destructive fix — push it first.';

/** Block decision for a `{ unresolvableExecutable: true }` invocation (#788 Execution Strategy
 * step 2) — a `$(...)`, backtick, or `$VAR`/`${VAR}` executable position sitting immediately
 * before literal `worktree remove` tokens. Reuses `worktree-remove-unresolvable-path`'s shape
 * (block tier, same "cannot verify, must refuse" posture) rather than inventing a second
 * "can't tell" outcome — the guard already has one refusal for "this cannot be verified
 * statically", and the reason it cannot be verified (a dynamic path vs. a dynamic executable)
 * does not change what the caller must do about it. */
const unresolvableExecutableDecision = () => ({
  tier: 'block',
  pattern_id: 'worktree-remove-unresolvable-path',
  reason:
    'git worktree remove executable could not be resolved statically (command substitution or ' +
    'environment-variable indirection) — cannot confirm this is git, or rule it out, before ' +
    'removal. Remedy: re-run as a standalone command naming the literal `git` executable (no ' +
    '$(...), backticks, or $VAR indirection).',
});

/** The pattern ids and the two prose clauses that differ between the removal spellings this guard
 * covers. Everything else — the check functions run, the order they run in, the resolved path they
 * run against — is shared, so the durable event still distinguishes a refused `git worktree
 * remove` from a refused `rm -rf` without a ledger reader having to parse the recorded command. */
const gitRemovalShape = (force) => ({
  checkDirty: force,
  dirtyId: 'worktree-remove-force-dirty',
  dirtyDiscardClause: 'that --force would discard permanently',
  dirtyUnknownId: 'worktree-remove-force-unreadable',
  unpushedId: force ? 'worktree-remove-force-unpushed' : 'worktree-remove-unpushed',
  unpushedNote: force ? "; --force also bypasses git's own dirty-tree refusal" : '',
  detachedId: 'worktree-remove-detached-unreachable',
  unverifiableId: 'worktree-remove-unverifiable',
});

/** `checkDirty` is unconditionally true here, with no force flag gating it: `rm -r` has no native
 * dirty-tree refusal for a force flag to bypass, which makes it strictly weaker than even a plain
 * `git worktree remove`. Gating the check on `-f` would leave `rm -r <dirty worktree>` — which
 * destroys the same work — unguarded. */
const RM_REMOVAL_SHAPE = {
  checkDirty: true,
  dirtyId: 'rm-worktree-dirty',
  dirtyDiscardClause: 'that a recursive rm would discard permanently',
  dirtyUnknownId: 'rm-worktree-unreadable',
  unpushedId: 'rm-worktree-unpushed',
  unpushedNote: '; a recursive rm performs none of the checks git worktree remove performs',
  detachedId: 'rm-worktree-detached-unreachable',
  unverifiableId: 'rm-worktree-unverifiable',
};

/** Runs the guard's three check functions against an already-resolved worktree path, returning a
 * block decision or null when this path is safe. The single place either removal spelling reaches
 * a verdict: the decision logic exists once and `shape` supplies only the pattern ids and prose
 * that legitimately differ, so the two spellings cannot drift into two different safety bars. */
const evaluateResolvedWorktree = (resolvedPath, shape) => {
  if (shape.checkDirty) {
    const dirty = checkDirtyWorktree(resolvedPath);
    if (dirty.status === 'dirty') {
      return {
        tier: 'block',
        pattern_id: shape.dirtyId,
        reason:
          `Worktree at ${resolvedPath} has uncommitted or untracked changes (${dirty.detail}) ` +
          `${shape.dirtyDiscardClause}. Remedy: commit or stash the changes, or run 'git ` +
          `clean' deliberately first if they are genuinely disposable.`,
      };
    }
    if (dirty.status === 'unknown') {
      return {
        tier: 'block',
        pattern_id: shape.dirtyUnknownId,
        reason:
          `${unverifiableRefusalOpener(resolvedPath, 'is clean', dirty.detail)} Remedy: confirm ` +
          `the path exists and is a valid git worktree (not already removed, moved, or corrupted), ` +
          `then retry.`,
      };
    }
  }

  const result = checkUnpushedCommits(resolvedPath);

  if (result.status === 'unpushed') {
    return {
      tier: 'block',
      pattern_id: shape.unpushedId,
      reason:
        `Worktree at ${resolvedPath} has commits not on its remote (${result.detail}) — removal would discard them permanently` +
        shape.unpushedNote,
    };
  }
  if (result.status === 'unknown') {
    if (result.detached) {
      return {
        tier: 'block',
        pattern_id: shape.detachedId,
        reason:
          `${unverifiableRefusalOpener(resolvedPath, 'has no unpushed commits', result.detail)} This worktree's HEAD is detached ` +
          `and not reachable from any known remote-tracking ref. Remedy: fetch a ref that contains this ` +
          `commit (e.g. its PR head) into a remote-tracking ref, then retry: git fetch origin ` +
          `refs/pull/<PR>/head:refs/remotes/origin/<name> ${GITHUB_RETAINS_PR_HEADS_NOTE}. A commit that ` +
          NEVER_PUSHED_ANYWHERE_SUFFIX,
      };
    }
    return {
      tier: 'block',
      pattern_id: shape.unverifiableId,
      reason:
        `${unverifiableRefusalOpener(resolvedPath, 'has no unpushed commits', result.detail)} Remedy: if this is a pushed PR ` +
        `branch this worktree checked out under a local name that doesn't match its own remote ` +
        `branch name, fetch its head into the tracking ref this check falls back to, then retry: ` +
        `git fetch origin refs/pull/<PR>/head:refs/remotes/origin/<branch> ${GITHUB_RETAINS_PR_HEADS_NOTE}. ` +
        `A branch that ` +
        NEVER_PUSHED_ANYWHERE_SUFFIX,
    };
  }
  return null; // clean — this invocation alone does not block
};

/** Evaluates one `git worktree remove` invocation's `{ argTokens }` against `resolutionCwds` — the
 * invocation's own tracked SET of candidate cwds (`findRemovalInvocations`'s `cd` simulation, plural
 * since F-00059: a `||`-guarded `cd` earlier in the command can leave more than one directory
 * plausible), not necessarily just the harness's original `cwd` — returning a block decision or
 * null when EVERY candidate resolution is safe (`clean`). Tries each candidate base only until a
 * relative `pathArg` resolves to a path already tried (an absolute `pathArg` resolves to the same
 * path regardless of base, so it is only ever tried once). `evaluateWorktreeRemoval` below decides
 * what "safe overall" means across every invocation in the command. */
const evaluateOneInvocation = (argTokens, resolutionCwds) => {
  const { force, pathArg } = parseWorktreeRemoveArgs(argTokens);
  if (!pathArg || !isLiteralPathArg(pathArg)) {
    return {
      tier: 'block',
      pattern_id: 'worktree-remove-unresolvable-path',
      reason:
        'git worktree remove target could not be resolved statically (missing, dynamic, or multiple ' +
        'arguments) — cannot verify unpushed commits before removal. Remedy: re-run as a standalone ' +
        'command with exactly one literal absolute path (no shell variable, no glob, no chained ' +
        '&&/; call).',
    };
  }

  const shape = gitRemovalShape(force);
  const tried = new Set();
  for (const base of resolutionCwds) {
    const resolvedPath = path.isAbsolute(pathArg) ? pathArg : path.resolve(base, pathArg);
    if (tried.has(resolvedPath)) continue;
    tried.add(resolvedPath);
    const decision = evaluateResolvedWorktree(resolvedPath, shape);
    if (decision) return decision;
  }
  return null;
};

/** Evaluates one `rm` clause's `{ argTokens }`, resolving any relative positional argument against
 * EVERY candidate in `resolutionCwds` (the invocation's own tracked cwd set — see
 * `evaluateOneInvocation`'s docstring) and checking registration against `spawnCwd` (the harness's
 * original, guaranteed-real `cwd`, needed only as a valid directory to spawn `git` from —
 * `isRegisteredLinkedWorktree` targets the resolved path itself via `-C`, so this never needs to
 * equal any entry of `resolutionCwds`). Returns a block decision for the first of its targets,
 * under the first candidate base, that is an unsafe registered worktree, or null. Three gates
 * stand between an ordinary `rm` and any check at all — no recursive flag, no statically resolvable
 * target, or a target that is not a registered linked worktree — each of which returns "nothing to
 * check" rather than a refusal, which is what keeps `rm -rf` on ordinary paths exactly as it was. */
const evaluateRmInvocation = (argTokens, resolutionCwds, spawnCwd) => {
  const { recursive, positional } = parseRmRemovalArgs(argTokens);
  if (!recursive) return null;

  for (const pathArg of positional) {
    if (!isLiteralPathArg(pathArg)) continue;
    const tried = new Set();
    for (const base of resolutionCwds) {
      const resolvedPath = path.isAbsolute(pathArg) ? pathArg : path.resolve(base, pathArg);
      if (tried.has(resolvedPath)) continue;
      tried.add(resolvedPath);
      if (!isRegisteredLinkedWorktree(resolvedPath, spawnCwd)) continue;
      const decision = evaluateResolvedWorktree(resolvedPath, RM_REMOVAL_SHAPE);
      if (decision) return decision;
    }
  }
  return null;
};

/**
 * Entry point for `validate-bash-command.js`. Returns null when `command` contains no worktree-
 * removing invocation in either spelling (nothing to check). Otherwise inspects EVERY invocation
 * found (see `findRemovalInvocations`'s docstring — a chained command can carry more than one)
 * and returns a decision: `{ tier: 'block', pattern_id, reason }` for the first unsafe one found,
 * or `{ tier: 'allow' }` once none of them is unsafe. Never `'warn'` — unpushed history at removal
 * time is not a "risky but sometimes legitimate" call (V-HOOK-02's vocabulary); there is no
 * legitimate reason to discard commits that exist nowhere else, so this mirrors the static
 * blockPatterns' philosophy (V-HOOK-01) rather than the warnPatterns' one.
 */
const evaluateWorktreeRemoval = (command, cwd) => {
  const invocations = findRemovalInvocations(command, cwd);
  if (invocations.length === 0) return null;

  for (const invocation of invocations) {
    let decision;
    if (invocation.kind === 'rm') {
      decision = evaluateRmInvocation(invocation.argTokens, invocation.resolutionCwds, cwd);
    } else if (invocation.unresolvableExecutable) {
      decision = unresolvableExecutableDecision();
    } else {
      decision = evaluateOneInvocation(invocation.argTokens, invocation.resolutionCwds);
    }
    if (decision) return decision;
  }
  return { tier: 'allow' };
};

module.exports = {
  evaluateWorktreeRemoval,
  checkUnpushedCommits,
  checkDetachedReachability,
  checkDirtyWorktree,
  parseWorktreeRemoveArgs,
  parseRmRemovalArgs,
  isLiteralPathArg,
  isRegisteredLinkedWorktree,
  findRemovalInvocations,
  extractCdTargetText,
  skipGitGlobalOptions,
  isCommandWordStart,
  findClauseStartIndices,
  normalizeShellWord,
};

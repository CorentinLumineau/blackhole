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
 * `git worktree remove` (with or without `--force`) refuses on a dirty working tree but NOT on
 * committed-but-unpushed history (`blackhole-protocol.md` § Branch & Worktree Hygiene,
 * `recovery-protocol.md` §6(c)) — the orchestrator lost a real commit this way (F-00117) before
 * that gap was closed with prose alone (#526). This module makes the check mechanical: it denies
 * the removal (V-HOOK-01) when the worktree's branch carries commits its remote does not have,
 * for `--force` exactly as for a plain removal — `--force` already bypasses git's own dirty-tree
 * refusal, so it is the one removal path with no native safety net at all (issue #532 item 1).
 *
 * `@{u}` is not enough on its own: this campaign creates worktrees with `--no-track` and pushes
 * by an explicit refspec, never `-u` (#516) — so "no upstream configured" is the ROUTINE case for
 * a campaign worktree, not a rare edge. A naive implementation that treats an `@{u}` resolution
 * failure as "nothing unpushed" would silently allow every removal. `git push` still updates the
 * branch's remote-tracking ref opportunistically even without `-u` (git >= 1.8.4), so
 * `refs/remotes/origin/<branch>` is the reliable fallback comparison point once `@{u}` is absent.
 *
 * Matching detail (review round on #532's own PR): a plain `\bgit\s+worktree\s+remove\b` regex
 * requires `git` and `worktree` to sit whitespace-adjacent, so ANY git global option between them
 * — `-C <path>`, `-c k=v`, `--no-pager`, `--git-dir=<path>` — bypassed detection entirely. That
 * form is not exotic: #528/`0dc64ec` mandates `git -C <path> ...` campaign-wide, so the bypassing
 * form is the one the campaign now *always* uses. This module instead walks tokens: find every
 * unmasked, word-boundary-real `git` command word (`isCommandWordStart` below — not just any
 * `\bgit\b` match, which also fires on the harmless "git" fragment inside `--git-dir=/x/.git`),
 * skip recognized global options (`skipGitGlobalOptions`), and check whether `worktree remove`
 * follows. The same walk also fixes a second bug: the original code inspected only the first
 * match in a command and returned, so a second `git worktree remove` in a chained command
 * (`cmd1 && cmd2`) was never checked. `evaluateWorktreeRemoval` now inspects every invocation
 * found in the command and denies if ANY of them is unsafe.
 */

const { execFileSync } = require('child_process');
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
 * non-word character", which is all `\b` alone checks. `\bgit\b` also matches the "git" fragment
 * inside `--git-dir=/main/.git` (preceded by `.`, a non-word char, so `\b` fires there too) —
 * accepting that as a real command word is exactly the "denies by accident" bug flagged in
 * review: it only happens to deny when a `--git-dir=` value happens to end in `.git`, and it
 * would have made a genuine leading-`git`-with-global-options invocation match twice (once for
 * real, once for the embedded fragment) rather than being the actual fix. */
const isCommandWordStart = (command, index) => index === 0 || /[\s;&|(\n]/.test(command[index - 1]);

const GIT_WORD_RE = /\bgit\b/g;

/** Every index in `command` where a real (unmasked, real-word-boundary) `git` command word
 * starts. */
const findGitWordIndices = (command, masked) => {
  const indices = [];
  GIT_WORD_RE.lastIndex = 0;
  let m = GIT_WORD_RE.exec(command);
  while (m !== null) {
    if (!masked[m.index] && isCommandWordStart(command, m.index)) indices.push(m.index);
    if (GIT_WORD_RE.lastIndex === m.index) GIT_WORD_RE.lastIndex += 1;
    m = GIT_WORD_RE.exec(command);
  }
  return indices;
};

/** The substring of `command` starting at `index` up to (not including) the next shell separator
 * (`;`, `&`, `|`, newline), or to the end of the string — the same clause-scoping `[^;&|\n]*`
 * used before, now applied per `git` occurrence rather than only to the first. */
const clauseTailFrom = (command, index) => {
  const rest = command.slice(index);
  const sep = /[;&|\n]/.exec(rest);
  return sep ? rest.slice(0, sep.index) : rest;
};

/**
 * Every `git worktree remove` invocation in `command`, tolerant of global options between `git`
 * and `worktree` (`-C <path>`, `-c k=v`, `--no-pager`, `--git-dir=<path>`, combinations) and of
 * more than one such invocation in a chained command. Each entry is `{ argTokens }` — the tokens
 * following `remove` (flags and the path argument), ready for `parseWorktreeRemoveArgs`. Naive
 * whitespace tokenization, matching this module's existing convention for the post-`remove` tail
 * (a quoted path containing a literal space is not resolved either way — not a regression, the
 * original code had the same limitation for that argument).
 */
const findWorktreeRemoveInvocations = (command) => {
  const masked = computeMaskedSpans(command);
  const invocations = [];
  for (const gitIndex of findGitWordIndices(command, masked)) {
    const tokens = clauseTailFrom(command, gitIndex).trim().split(/\s+/).filter(Boolean);
    if (tokens[0] !== 'git') continue; // defensive: gitIndex is always a real word start
    const subcommandIndex = skipGitGlobalOptions(tokens, 1);
    if (subcommandIndex === -1) continue;
    if (tokens[subcommandIndex] !== 'worktree' || tokens[subcommandIndex + 1] !== 'remove') continue;
    invocations.push({ argTokens: tokens.slice(subcommandIndex + 2) });
  }
  return invocations;
};

/** True when `arg` is a literal path this hook can resolve without executing anything — no shell
 * variable (`$VAR`, `${VAR}`), command substitution (`$(...)`, `` `...` ``), or glob metacharacter.
 * A dynamic argument cannot be resolved by static inspection, so the unpushed-commit check below
 * has nothing to run against — same "cannot verify, must refuse" posture pattern-loader.js takes
 * for a pattern file it cannot parse. */
const isLiteralPathArg = (arg) => arg.length > 0 && !/[$`*?[\]{}]/.test(arg);

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

const git = (args, cwd) =>
  execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], cwd }).trim();

/**
 * Resolves whether `worktreePath`'s current branch carries commits its remote does not have.
 * Three outcomes:
 *  - `{ status: 'unpushed', detail }` — HEAD has commits the remote lacks. Deny.
 *  - `{ status: 'clean' }` — HEAD matches (or is behind) the remote. Allow.
 *  - `{ status: 'unknown', detail }` — could not be determined: bad path, detached HEAD, or the
 *    branch was never pushed at all (no `@{u}` AND no matching `refs/remotes/origin/<branch>`).
 *    Deny. This deliberately diverges from `validate-file-changes.js`'s "fail-open, per-check"
 *    convention for its git-containment sub-check: that convention is safe because a Write/Edit
 *    call can legitimately happen outside any git context at all, so skipping a git-dependent
 *    sub-check there degrades to "the other, git-independent checks still ran". A
 *    `git worktree remove` call is *always* in a git context by definition — an unresolvable
 *    state here is not "check inapplicable", it is exactly the highest-risk case this guard
 *    exists to catch (a branch that was never pushed anywhere is, by definition, 100% unpushed).
 */
const checkUnpushedCommits = (worktreePath) => {
  let branch;
  try {
    branch = git(['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
  } catch (error) {
    return { status: 'unknown', detail: `could not resolve HEAD in ${worktreePath} (${error.message})` };
  }
  if (!branch || branch === 'HEAD') {
    return { status: 'unknown', detail: `${worktreePath} is in detached HEAD state` };
  }

  let upstream = null;
  try {
    upstream = git(['-C', worktreePath, 'rev-parse', '--symbolic-full-name', '@{u}'], worktreePath);
  } catch {
    // No upstream configured — the routine case for a --no-track campaign worktree (#516), not
    // an error by itself. Fall back to the branch's remote-tracking ref below.
  }

  const compareRef = upstream || `refs/remotes/origin/${branch}`;
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

/** Evaluates one `{ argTokens }` invocation against `cwd`, returning a block decision or null
 * when this single invocation is safe (`clean`) — `evaluateWorktreeRemoval` below decides what
 * "safe overall" means across every invocation in the command. */
const evaluateOneInvocation = (argTokens, cwd) => {
  const { force, pathArg } = parseWorktreeRemoveArgs(argTokens);
  if (!pathArg || !isLiteralPathArg(pathArg)) {
    return {
      tier: 'block',
      pattern_id: 'worktree-remove-unresolvable-path',
      reason:
        'git worktree remove target could not be resolved statically (missing, dynamic, or multiple ' +
        'arguments) — cannot verify unpushed commits before removal. Remedy: re-run as a standalone ' +
        'command with exactly one literal absolute path (no shell variable, no glob, no chained ' +
        '&&/; call) and no trailing redirect — a bare & inside 2>&1 or similar is parsed as a second ' +
        'argument.',
    };
  }

  const resolvedPath = path.isAbsolute(pathArg) ? pathArg : path.resolve(cwd, pathArg);
  const result = checkUnpushedCommits(resolvedPath);

  if (result.status === 'unpushed') {
    return {
      tier: 'block',
      pattern_id: force ? 'worktree-remove-force-unpushed' : 'worktree-remove-unpushed',
      reason:
        `Worktree at ${resolvedPath} has commits not on its remote (${result.detail}) — removal would discard them permanently` +
        (force ? "; --force also bypasses git's own dirty-tree refusal" : ''),
    };
  }
  if (result.status === 'unknown') {
    return {
      tier: 'block',
      pattern_id: 'worktree-remove-unverifiable',
      reason:
        `Could not verify ${resolvedPath} has no unpushed commits (${result.detail}) — refusing rather ` +
        `than risk silent data loss. Remedy: if this is a pushed PR branch this worktree checked out ` +
        `under a local name that doesn't match its own remote branch name, fetch its head into the ` +
        `tracking ref this check falls back to, then retry: git fetch origin refs/pull/<PR>/head:` +
        `refs/remotes/origin/<branch> (GitHub retains PR head refs permanently, so this gives a true ` +
        `answer instead of bypassing the check). A branch that was genuinely never pushed anywhere ` +
        `has no non-destructive fix — push it first.`,
    };
  }
  return null; // clean — this invocation alone does not block
};

/**
 * Entry point for `validate-bash-command.js`. Returns null when `command` contains no
 * `git worktree remove` invocation anywhere (nothing to check). Otherwise inspects EVERY
 * invocation found (see `findWorktreeRemoveInvocations`'s docstring — a chained command can carry
 * more than one) and returns a decision: `{ tier: 'block', pattern_id, reason }` for the first
 * unsafe one found, or `{ tier: 'allow' }` only once every invocation in the command is safe.
 * Never `'warn'` — unpushed history at removal time is not a "risky but sometimes legitimate"
 * call (V-HOOK-02's vocabulary); there is no legitimate reason to discard commits that exist
 * nowhere else, so this mirrors the static blockPatterns' philosophy (V-HOOK-01) rather than the
 * warnPatterns' one.
 */
const evaluateWorktreeRemoval = (command, cwd) => {
  const invocations = findWorktreeRemoveInvocations(command);
  if (invocations.length === 0) return null;

  for (const { argTokens } of invocations) {
    const decision = evaluateOneInvocation(argTokens, cwd);
    if (decision) return decision;
  }
  return { tier: 'allow' };
};

module.exports = {
  evaluateWorktreeRemoval,
  checkUnpushedCommits,
  parseWorktreeRemoveArgs,
  isLiteralPathArg,
  findWorktreeRemoveInvocations,
  skipGitGlobalOptions,
  isCommandWordStart,
};

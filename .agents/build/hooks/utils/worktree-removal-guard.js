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
 */

const { execFileSync } = require('child_process');
const path = require('path');
const { computeMaskedSpans } = require('./bash-context');

/** Matches a `git worktree remove` invocation and captures everything up to the next shell
 * separator (`;`, `|`, `&`, or newline) as its raw argument tail — scoped so a chained later
 * command is never swept into the argument list. */
const WORKTREE_REMOVE_RE = /\bgit\s+worktree\s+remove\b([^;&|\n]*)/gi;

/** First unmasked match of `WORKTREE_REMOVE_RE` in `command`, or null. Reuses
 * `computeMaskedSpans` directly (the same primitive `matchFirstIgnoringNonExecutingText` in
 * bash-context.js is built on) rather than that function itself, because this check needs the
 * match's captured tail — position and groups — and that function discards both, returning only
 * the matched pattern entry (`V-INT-02`: one masking primitive, two independent consumers). */
const findWorktreeRemoveMatch = (command) => {
  const masked = computeMaskedSpans(command);
  WORKTREE_REMOVE_RE.lastIndex = 0;
  let match = WORKTREE_REMOVE_RE.exec(command);
  while (match !== null) {
    if (!masked[match.index]) return match;
    if (WORKTREE_REMOVE_RE.lastIndex === match.index) WORKTREE_REMOVE_RE.lastIndex += 1;
    match = WORKTREE_REMOVE_RE.exec(command);
  }
  return null;
};

/** True when `arg` is a literal path this hook can resolve without executing anything — no shell
 * variable (`$VAR`, `${VAR}`), command substitution (`$(...)`, `` `...` ``), or glob metacharacter.
 * A dynamic argument cannot be resolved by static inspection, so the unpushed-commit check below
 * has nothing to run against — same "cannot verify, must refuse" posture pattern-loader.js takes
 * for a pattern file it cannot parse. */
const isLiteralPathArg = (arg) => arg.length > 0 && !/[$`*?[\]{}]/.test(arg);

/** Splits the raw argument tail after `git worktree remove` into `{ force, pathArg }`. `--force`
 * or `-f` may appear before or after the path. Anything else — a second flag, `--`, no path, more
 * than one positional argument — leaves `pathArg` null, and the caller treats that exactly like a
 * dynamic argument: nothing static to verify, so refuse. */
const parseWorktreeRemoveArgs = (tail) => {
  const tokens = tail.trim().split(/\s+/).filter(Boolean);
  let force = false;
  const positional = [];
  for (const token of tokens) {
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

/**
 * Entry point for `validate-bash-command.js`. Returns null when `command` contains no unmasked
 * `git worktree remove` invocation (nothing to check). Otherwise returns a decision:
 * `{ tier: 'block', pattern_id, reason }` or `{ tier: 'allow' }`. Never `'warn'` — unpushed
 * history at removal time is not a "risky but sometimes legitimate" call (V-HOOK-02's
 * vocabulary); there is no legitimate reason to discard commits that exist nowhere else, so this
 * mirrors the static blockPatterns' philosophy (V-HOOK-01) rather than the warnPatterns' one.
 */
const evaluateWorktreeRemoval = (command, cwd) => {
  const match = findWorktreeRemoveMatch(command);
  if (!match) return null;

  const { force, pathArg } = parseWorktreeRemoveArgs(match[1]);
  if (!pathArg || !isLiteralPathArg(pathArg)) {
    return {
      tier: 'block',
      pattern_id: 'worktree-remove-unresolvable-path',
      reason:
        'git worktree remove target could not be resolved statically (missing, dynamic, or multiple arguments) — cannot verify unpushed commits before removal',
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
      reason: `Could not verify ${resolvedPath} has no unpushed commits (${result.detail}) — refusing rather than risk silent data loss`,
    };
  }
  return { tier: 'allow' };
};

module.exports = {
  evaluateWorktreeRemoval,
  checkUnpushedCommits,
  parseWorktreeRemoveArgs,
  isLiteralPathArg,
  findWorktreeRemoveMatch,
};

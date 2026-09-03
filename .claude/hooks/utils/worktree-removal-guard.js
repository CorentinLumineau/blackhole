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

/** True when a `git` word match at `index` is a path-qualified real invocation — the "git" in
 * `/usr/bin/git` or `./git` — rather than a fragment embedded in an `=`-attached option value,
 * the "git" in `--git-dir=/main/.git`. `isCommandWordStart` above rejects both alike, because a
 * `/` is no more a shell word boundary than the `.` it was written to exclude; that is the
 * fail-open this predicate closes. The distinguishing signal is position, not merely "preceded by
 * a slash": walk backward from the character before `index` (which must be `/`, or this is not
 * path-qualified at all) to the nearest real command-word boundary. Reaching that boundary
 * without crossing `=` means the whole path token starts at a genuine command position — accept.
 * Crossing `=` first means the path lives inside an attached option value (`--flag=/some/path`) —
 * reject, preserving the fragment exclusion isCommandWordStart was introduced for. A `git` that
 * is merely an interior path segment (`-C /home/user/git/repo`) is admitted here but cannot form
 * an invocation: its clause tail begins `git/repo`, which findWorktreeRemoveInvocations' token
 * check below discards. */
const isPathQualifiedGitWordStart = (command, index) => {
  if (index === 0 || command[index - 1] !== '/') return false;
  let i = index - 1;
  while (i > 0 && !/[\s;&|(\n]/.test(command[i - 1])) {
    if (command[i - 1] === '=') return false;
    i -= 1;
  }
  return true;
};

const GIT_WORD_RE = /\bgit\b/g;

/** Every index in `command` where a real (unmasked) `git` command word starts — either at a shell
 * word boundary or at the end of a path-qualified executable token. */
const findGitWordIndices = (command, masked) => {
  const indices = [];
  GIT_WORD_RE.lastIndex = 0;
  let m = GIT_WORD_RE.exec(command);
  while (m !== null) {
    if (
      !masked[m.index] &&
      (isCommandWordStart(command, m.index) || isPathQualifiedGitWordStart(command, m.index))
    ) {
      indices.push(m.index);
    }
    if (GIT_WORD_RE.lastIndex === m.index) GIT_WORD_RE.lastIndex += 1;
    m = GIT_WORD_RE.exec(command);
  }
  return indices;
};

/** The substring of `command` starting at `index` up to (not including) the next shell separator
 * (`;`, `&` when not part of a redirect, `|`, newline), or to the end of the string — the same
 * clause-scoping as before, now with redirect-aware `&` handling and trailing redirect
 * tokens stripped so `>/dev/null`, `2>/dev/null`, and `2>&1` do not become spurious path args. */
const clauseTailFrom = (command, index) => {
  const rest = command.slice(index);
  let end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === ';' || ch === '|' || ch === '\n') {
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
 * Resolves whether a detached-HEAD `worktreePath` is safe to remove — the reachability rung
 * `checkUnpushedCommits` falls into below when there is no branch name to compare at all (#761).
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
 * Shared prose for a `status: 'unknown'` refusal below — the detached-HEAD and named-branch
 * outcomes share an identical opening clause and closing clause and differ only in the remedy
 * paragraph between them.
 */
const unverifiableRefusalOpener = (resolvedPath, detail) =>
  `Could not verify ${resolvedPath} has no unpushed commits (${detail}) — refusing rather ` +
  `than risk silent data loss.`;

const GITHUB_RETAINS_PR_HEADS_NOTE =
  '(GitHub retains PR head refs permanently, so this gives a true answer instead of bypassing the ' +
  'check)';

const NEVER_PUSHED_ANYWHERE_SUFFIX =
  'was genuinely never pushed anywhere has no non-destructive fix — push it first.';

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
        '&&/; call).',
    };
  }

  const resolvedPath = path.isAbsolute(pathArg) ? pathArg : path.resolve(cwd, pathArg);

  if (force) {
    const dirty = checkDirtyWorktree(resolvedPath);
    if (dirty.status !== 'clean') {
      return {
        tier: 'block',
        pattern_id: 'worktree-remove-force-dirty',
        reason:
          dirty.status === 'dirty'
            ? `Worktree at ${resolvedPath} has uncommitted or untracked changes (${dirty.detail}) that --force would discard permanently. Remedy: commit or stash the changes, or run 'git clean' deliberately first if they are genuinely disposable.`
            : `Could not verify ${resolvedPath} is clean (${dirty.detail}) — refusing rather than risk silent data loss.`,
      };
    }
  }

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
    if (result.detached) {
      return {
        tier: 'block',
        pattern_id: 'worktree-remove-detached-unreachable',
        reason:
          `${unverifiableRefusalOpener(resolvedPath, result.detail)} This worktree's HEAD is detached ` +
          `and not reachable from any known remote-tracking ref. Remedy: fetch a ref that contains this ` +
          `commit (e.g. its PR head) into a remote-tracking ref, then retry: git fetch origin ` +
          `refs/pull/<PR>/head:refs/remotes/origin/<name> ${GITHUB_RETAINS_PR_HEADS_NOTE}. A commit that ` +
          NEVER_PUSHED_ANYWHERE_SUFFIX,
      };
    }
    return {
      tier: 'block',
      pattern_id: 'worktree-remove-unverifiable',
      reason:
        `${unverifiableRefusalOpener(resolvedPath, result.detail)} Remedy: if this is a pushed PR ` +
        `branch this worktree checked out under a local name that doesn't match its own remote ` +
        `branch name, fetch its head into the tracking ref this check falls back to, then retry: ` +
        `git fetch origin refs/pull/<PR>/head:refs/remotes/origin/<branch> ${GITHUB_RETAINS_PR_HEADS_NOTE}. ` +
        `A branch that ` +
        NEVER_PUSHED_ANYWHERE_SUFFIX,
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
  checkDetachedReachability,
  checkDirtyWorktree,
  parseWorktreeRemoveArgs,
  isLiteralPathArg,
  findWorktreeRemoveInvocations,
  skipGitGlobalOptions,
  isCommandWordStart,
  isPathQualifiedGitWordStart,
};

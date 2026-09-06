#!/usr/bin/env bun
'use strict';

/**
 * git-main-clone-guard.js — dynamic PreToolUse check refusing a working-tree-mutating `git`
 * subcommand when its effective repository is the main clone (issue #897, ADR-043).
 *
 * `bash-write-target-guard.js` has zero `git` vocabulary (ADR-029 covers file-write shapes:
 * redirects, `sed -i`, `cp`/`mv`, the `UNRESOLVABLE_WRITE_COMMANDS` list — never a `git`
 * subcommand). Finding F-00034 is a reviewer running `git checkout <PR-branch> -- .` in the main
 * clone and staging ~60 files over the user's uncommitted work — a shape neither guard sees.
 *
 * Detection is not re-derived here: `findRemovalInvocations` (`worktree-removal-guard.js`) already
 * walks clause starts, simulates `cd` (including `||`-guarded and UNCERTAIN-wrapper unions),
 * normalizes executable spellings, and dispatches on git subcommand at exactly the point
 * `skipGitGlobalOptions` returns. This module only adds POLICY on top of the `kind: 'git-mutation'`
 * invocations that walk already emits — the subcommand→tier table, effective-repo identity, and
 * refusal prose (V-SOLID-01/V-PAT-01: the removal guard does not gain a second policy).
 *
 * Severity tracks recoverability, not "writes to disk" (design note § Context recoverability
 * table): `clean` (untracked files, no object ever created) and `checkout -- <path>`/`restore`
 * (prior uncommitted state never captured) are never recoverable; `reset --hard`/`--merge` is
 * partially recoverable (commits survive via reflog, uncommitted/staged changes do not); `apply`/
 * `am` apply an arbitrary patch with no snapshot first; a forced `checkout`/`switch` bypasses
 * git's own unforced-path dirty-tree refusal. All five block. `stash` persists in `refs/stash`
 * (retrievable via `fsck --unreachable` even after `drop`) and only warns.
 *
 * Effective repository resolution mirrors ADR-041 Decision point 2's discipline exactly:
 * `mainCloneRoot(dir)` throws on an anomalous (not merely "outside any repository") git failure,
 * and this module — like `recordEvent` before it — wraps its OWN call in a local `try/catch`
 * rather than letting the throw propagate to the validator's top-level `failClosed()`, which would
 * turn a transient broken-git-dir condition into a deny for every subsequent call. The resolution
 * is: not identified as main clone → `main-clone-target-unresolvable`, warn tier, never a block.
 * `mainCloneRoot`/`worktreeRoot` themselves are untouched — this is a second caller applying an
 * already-established pattern at its own call site, not a new exception to their contract.
 *
 * The identity read (a real `git` subprocess) is gated behind the subcommand match: `classify`
 * below is a pure, in-memory table lookup with no I/O, so a non-matching subcommand (`log`,
 * `fetch`, `diff`, …) returns `null` and never reaches `resolveDecision` at all — no extra latency
 * on the PreToolUse wrapper's fail-open timeout for the vast majority of git invocations.
 */

const path = require('path');
const { findRemovalInvocations, extractGitRepoOverride } = require('./worktree-removal-guard');
const { worktreeRoot, mainCloneRoot } = require('./hook-event-log');

/** True when `argTokens` carries any of `longNames` verbatim, or a bundled short-option token
 * (`-fd`, `-xdf`, …) containing `shortLetter` — the same "single token, several bundled flags"
 * shape `git clean -fd`/`git checkout -f` use. Never matches inside `--` (long options are
 * checked by exact string, not letter membership). */
const hasFlag = (argTokens, shortLetter, longNames) =>
  argTokens.some((t) => {
    if (longNames.includes(t)) return true;
    if (shortLetter && /^-[a-zA-Z]+$/.test(t) && t.includes(shortLetter)) return true;
    return false;
  });

/** `git restore` blocks by default (an unstaged working-tree restore is the same irrecoverable
 * shape as `checkout -- <path>`), EXCEPT a staged-only restore (`--staged`/`-S` present, without
 * `--worktree`/`-W`) — that only unstages, which is trivially undone with `git add` again. */
const isRestoreBlocked = (argTokens) => {
  const staged = hasFlag(argTokens, 'S', ['--staged']);
  const worktree = hasFlag(argTokens, 'W', ['--worktree']);
  return !(staged && !worktree);
};

/** `git checkout <ref> -- <path>` / `git checkout -- <path>` — the pathspec-restore form, always
 * identifiable by a literal `--` separator token (git's own syntax requires it to disambiguate a
 * pathspec from a branch name in this form). This is F-00034's exact shape. */
const isCheckoutPathForm = (argTokens) => argTokens.includes('--');

/** A forced `checkout <branch>` / `switch <branch>` bypasses git's own unforced-path dirty-tree
 * refusal — the one member of this table with a native safety net that only `--force` defeats. */
const isForcedBranchSwitch = (argTokens) => hasFlag(argTokens, 'f', ['--force', '--discard-changes']);

/** The subcommand → tier table (design note § Decision). Pure and I/O-free: returns `null`
 * immediately for any subcommand this issue's recoverability table does not name (`log`, `fetch`,
 * `diff`, `show`, `merge-base`, `rev-parse`, `grep`, `clone`, `ls-remote`, `worktree`, `add`,
 * `commit`, `merge`, `rebase`, `cherry-pick`, `push`, `pull`, …) — every one of those is
 * recoverable or already covered by its own mechanism (`git add`/`commit`: content enters the
 * object store; `merge`/`rebase`/`cherry-pick`: reflog-recoverable, and git's own dirty-tree
 * refusal covers the precursor state; `worktree remove`: `findRemovalInvocations`'s OTHER branch
 * already owns it) and is deliberately excluded per the design note's Consequences (F-00034's
 * `git add` leg stays open by design, not by omission). */
const classify = (subcommand, argTokens) => {
  switch (subcommand) {
    case 'clean':
      if (!hasFlag(argTokens, 'f', ['--force'])) return null;
      return { tier: 'block', patternId: 'main-clone-clean' };
    case 'checkout':
    case 'switch':
      if (isCheckoutPathForm(argTokens)) return { tier: 'block', patternId: 'main-clone-checkout-path' };
      if (isForcedBranchSwitch(argTokens)) return { tier: 'block', patternId: 'main-clone-checkout-force' };
      return null;
    case 'restore':
      if (!isRestoreBlocked(argTokens)) return null;
      return { tier: 'block', patternId: 'main-clone-restore' };
    case 'reset':
      if (!argTokens.includes('--hard') && !argTokens.includes('--merge')) return null;
      return { tier: 'block', patternId: 'main-clone-reset-destructive' };
    case 'apply':
    case 'am':
      return { tier: 'block', patternId: 'main-clone-apply' };
    case 'stash':
      return { tier: 'warn', patternId: 'main-clone-stash' };
    default:
      return null;
  }
};

const REMEDY = 'Remedy: re-run this inside your own wt-<issue> worktree, or target the worktree ' +
  'explicitly with `git -C <worktree-abs-path> ...` instead of the main clone.';

const REASON_BY_PATTERN = {
  'main-clone-clean': `git clean would permanently delete untracked files in the main clone — no git object is ever created for them, so this is never recoverable. ${REMEDY}`,
  'main-clone-checkout-path': `git checkout/restore of a pathspec in the main clone would overwrite uncommitted working-tree state with no snapshot taken first — F-00034's exact shape. ${REMEDY}`,
  'main-clone-restore': `git restore would overwrite uncommitted working-tree state in the main clone with no snapshot taken first. ${REMEDY}`,
  'main-clone-reset-destructive': `git reset --hard/--merge in the main clone would discard uncommitted and staged changes (commits alone survive via reflog). ${REMEDY}`,
  'main-clone-apply': `git apply/am in the main clone applies a patch directly to the working tree with no snapshot taken first. ${REMEDY}`,
  'main-clone-checkout-force': `A forced checkout/switch in the main clone bypasses git's own dirty-tree refusal and discards uncommitted changes. ${REMEDY}`,
  'main-clone-stash': 'git stash in the main clone is recoverable (it persists in refs/stash, retrievable via ' +
    "fsck --unreachable even after drop) — allowed and recorded rather than blocked, but worth a worker's own " +
    'second look before it runs unattended.',
};

/** Resolves `repoOverride`/`resolutionCwds` (the same candidate set `worktree-removal-guard.js`
 * already computed for this invocation) to the set of directories this command could actually
 * target, in identity-check order. `repoOverride` (a `-C`/`--git-dir`/`--work-tree` value) takes
 * precedence over every `cd`-simulated candidate when present — the campaign's own protocol
 * (#528) always spells `git -C <path>`, and that value is what actually selects the repository,
 * not the invoking shell's cwd. A relative override is resolved against each candidate cwd in
 * turn (git itself resolves a relative `-C` against its own invocation cwd); an absolute override
 * collapses to a single directory regardless of how many cwd candidates exist. */
const effectiveDirs = (repoOverride, resolutionCwds) => {
  if (!repoOverride) return [...new Set(resolutionCwds)];
  if (path.isAbsolute(repoOverride)) return [repoOverride];
  return [...new Set(resolutionCwds.map((base) => path.resolve(base, repoOverride)))];
};

/** Resolves identity for `match` against every effective directory, preferring a CONFIRMED main-
 * clone verdict over a merely-unresolvable one (the same "confirmed beats cannot-verify"
 * precedent `evaluateOneInvocation` already applies in the sibling removal guard) — a `||`-guarded
 * `cd` can widen the candidate set to include a directory this command does NOT end up running in,
 * so scanning every candidate and preferring the confirmed-unsafe outcome is what keeps this from
 * denying (or allowing) by coincidence rather than by verification. Returns `null` when no
 * candidate is confirmed the main clone and none was anomalous — an ordinary worktree target. */
const resolveDecision = (match, repoOverride, resolutionCwds) => {
  let anomalous = false;
  for (const dir of effectiveDirs(repoOverride, resolutionCwds)) {
    let mcRoot;
    try {
      mcRoot = mainCloneRoot(dir);
    } catch {
      anomalous = true;
      continue;
    }
    if (!mcRoot) continue; // outside any repository at all — not this guard's concern
    if (worktreeRoot(dir) === mcRoot) {
      return { tier: match.tier, pattern_id: match.patternId, reason: REASON_BY_PATTERN[match.patternId] };
    }
  }
  if (!anomalous) return null;
  return {
    tier: 'warn',
    pattern_id: 'main-clone-target-unresolvable',
    reason:
      'Could not determine whether this git command targets the main clone or a worktree ' +
      '(anomalous git failure resolving repository identity) — allowed and recorded for review ' +
      'rather than risking a false block on a transient condition.',
  };
};

/**
 * Entry point for `validate-bash-command.js`. Returns `null` when nothing in `command` matches
 * the recoverability table, or when every match resolves to a linked worktree (not the main
 * clone). Otherwise returns `{ tier: 'block' | 'warn', pattern_id, reason }` for the first
 * matched, resolved invocation — mirroring `evaluateBashWriteTargets`'s `evaluateX(command, cwd)`
 * shape (ADR-029's established convention).
 */
const evaluateGitMainCloneMutation = (command, cwd) => {
  const invocations = findRemovalInvocations(command, cwd);
  for (const invocation of invocations) {
    if (invocation.kind !== 'git-mutation') continue;
    const match = classify(invocation.subcommand, invocation.argTokens);
    if (!match) continue;
    const decision = resolveDecision(match, invocation.repoOverride, invocation.resolutionCwds);
    if (decision) return decision;
  }
  return null;
};

module.exports = {
  evaluateGitMainCloneMutation,
};

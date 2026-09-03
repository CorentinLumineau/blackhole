#!/usr/bin/env bun
'use strict';

/**
 * validate-file-changes.js — PreToolUse gate for the Write and Edit tools.
 *
 * Blocked: system paths, `../` traversal, and any target resolving outside every worktree of the
 * calling repo family (the main clone plus its linked worktrees, plus the payload's own `cwd`
 * worktree and an opt-in `BLACKHOLE_SCRATCHPAD_DIR` — #507/#729, see `allWorktreeRoots`'s
 * docstring in `utils/hook-event-log.js` for the full root set), or — outside a git context —
 * outside the payload's own `cwd` subtree (#512, see the containment block below for the decision
 * record). Recorded-but-allowed: sensitive filenames. That split is deliberate — a coarse
 * filename regex has real false-positive risk (`.env.example`), and stalling an unattended worker
 * with nobody watching to unblock it is a worse outcome than a flagged-but-permitted write.
 */

const { loadFilePatterns, matchFirst } = require('./utils/pattern-loader');
const {
  readHookInput,
  allWorktreeRoots,
  isUnderRoot,
  isAcceptableScratchpadDir,
  readAssignedWorktreeRoot,
  denyAndRecord,
  warnAndRecord,
  allowSilently,
  failClosed,
} = require('./utils/hook-event-log');

const HOOK = 'validate-file-changes';

/** True when `filePath` resolves inside ANY of `roots` — the main clone plus every accepted
 * linked worktree of the same repo family (see `allWorktreeRoots`'s docstring for why "any", not
 * just the one worktree the hook process happens to be sitting in, and for how the root set
 * itself is narrowed — #510). Reuses `isUnderRoot`'s realpath-based containment check rather than
 * re-deriving it (`V-INT-02`) — the same resolution `allWorktreeRoots` uses to compare
 * `scratchpad_dir` against discovered roots. */
const isInsideAnyRoot = (filePath, roots) => roots.some((root) => isUnderRoot(filePath, root));

const main = () => {
  let input;
  try {
    input = readHookInput();
  } catch (error) {
    failClosed({ hook: HOOK, tool: 'Write', error, patternId: 'hook-input-parse-failure', label: 'hook input' });
    return;
  }
  const tool = input.tool_name || 'Write';
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || toolInput.path || '';
  // The tool call's own working directory (harness-supplied on the payload) rather than the hook
  // process's own process.cwd() — see hook-event-log.js's `git` docstring for why (#507).
  const cwd = input.cwd || process.cwd();

  let patterns;
  try {
    patterns = loadFilePatterns();
  } catch (error) {
    failClosed({ hook: HOOK, tool, error, cwd });
    return;
  }

  const traversal = matchFirst(filePath, patterns.pathTraversal);
  if (traversal) {
    denyAndRecord({ hook: HOOK, tool, pattern_id: traversal.id, reason: traversal.reason, detail: filePath, cwd });
    return;
  }

  const systemPath = matchFirst(filePath, patterns.blockedSystemPaths);
  if (systemPath) {
    denyAndRecord({
      hook: HOOK,
      tool,
      pattern_id: systemPath.id,
      reason: `Cannot write to system path — ${systemPath.reason}`,
      detail: filePath,
      cwd,
    });
    return;
  }

  // Decision record (#512): outside a git context, `allWorktreeRoots` has nothing to resolve —
  // there is no worktree family to bound writes to. The prior behavior skipped containment
  // entirely there (documented fail-open), leaving every path matching no denylist pattern
  // writable. That is a real residual gap for consumer installs, where a session may legitimately
  // start outside a repository — campaign workers always run inside one, so this never fired in
  // blackhole's own operation.
  //
  // Alternatives considered: (1) keep fail-open and only document the gap — cheapest, but leaves
  // the gap open; (2) fail closed outright with no git context — strongest, but risks stalling a
  // legitimate non-repo session with nobody watching to unblock it, the exact failure mode the
  // original fail-open was written to avoid.
  //
  // Chosen: fall back to the payload's own `cwd` as the allowed root. This never stalls a worker
  // operating within its own working directory (the overwhelmingly common case) while still
  // bounding writes to somewhere the session is actually known to be, closing the "anywhere on
  // disk" gap — unlike `worktree-removal-guard.js`'s unresolvable-state case (always a git
  // context by construction, so "can't verify" is the highest-risk case there), a Write/Edit call
  // can legitimately happen outside git entirely, so an unresolvable git root is "no worktree
  // bound available", not "highest risk" — cwd is a real, present bound to fall back to instead of
  // treating the call as maximally suspicious.
  const assignedRoot = readAssignedWorktreeRoot(cwd);
  const roots = assignedRoot ? [assignedRoot] : allWorktreeRoots(cwd);
  if (roots) {
    if (filePath && !isInsideAnyRoot(filePath, roots)) {
      denyAndRecord({
        hook: HOOK,
        tool,
        pattern_id: assignedRoot ? 'outside-assigned-worktree' : 'outside-worktree',
        reason: assignedRoot
          ? `Write target resolves outside the assigned worktree root (${assignedRoot})`
          : `Write target resolves outside every known worktree root (${roots.join(', ')})`,
        detail: filePath,
        cwd,
      });
      return;
    }
  } else if (filePath) {
    // The cwd fallback bound is only as good as `cwd` itself: a session whose cwd resolves to
    // `/`, `$HOME`, or a bare temp root is no narrower than no bound at all — the exact hole
    // #510/F-00088 closed for `scratchpad_dir`. Reuses that same breadth check (`V-INT-02`)
    // rather than writing a second one; a cwd that fails it is treated as no bound being
    // available, not as a bound to trust, so the write is refused rather than silently accepted.
    if (!isAcceptableScratchpadDir(cwd)) {
      denyAndRecord({
        hook: HOOK,
        tool,
        pattern_id: 'cwd-fallback-too-broad',
        reason: `No git context resolved for containment, and the tool call's own cwd (${cwd}) is too broad to trust as a fallback root`,
        detail: filePath,
        cwd,
      });
      return;
    }
    if (!isUnderRoot(filePath, cwd)) {
      denyAndRecord({
        hook: HOOK,
        tool,
        pattern_id: 'outside-cwd-fallback',
        reason: `No git context resolved for containment — write target resolves outside the tool call's own cwd (${cwd})`,
        detail: filePath,
        cwd,
      });
      return;
    }
    console.error(
      `[blackhole-hook] ${HOOK}: no git worktree resolved — bounded fallback to cwd subtree (${cwd}) for ${filePath}`,
    );
  }

  const sensitive = matchFirst(filePath, patterns.sensitiveFiles);
  if (sensitive) {
    warnAndRecord({
      hook: HOOK,
      tool,
      pattern_id: sensitive.id,
      reason: `${sensitive.reason} — ${filePath}`,
      detail: filePath,
      cwd,
    });
    return;
  }

  allowSilently();
};

// Top-level catch-all (#580): everything above this point is wrapped in `main()`'s own
// synchronous call graph, but two `try/catch` blocks only cover JSON-parse and pattern-load
// failures — an uncaught exception anywhere else (e.g. a non-string `file_path` reaching
// hook-event-log.js's `resolveExistingAncestor`, the V-SEC-11 enforcement path) used to fall
// through to the process boundary, which the wrapper (claude-native-settings.ts) treats as
// "validator could not run" and converts to an ALLOW. Routing every uncaught exception through
// the same `failClosed()` the two existing checks already use closes that class rather than
// patching individual crash sites — see .blackhole/plans/issue-580.md's Root-Cause Decision
// Record.
try {
  main();
} catch (error) {
  console.error(`[blackhole-hook] ${HOOK}: uncaught error in validator logic — ${error.stack}`);
  failClosed({ hook: HOOK, tool: 'Write', error, patternId: 'uncaught-validator-error', label: 'validator logic' });
}

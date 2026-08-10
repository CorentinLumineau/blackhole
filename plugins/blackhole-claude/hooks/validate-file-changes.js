#!/usr/bin/env bun
'use strict';

/**
 * validate-file-changes.js — PreToolUse gate for the Write and Edit tools.
 *
 * Blocked: system paths, `../` traversal, and any target resolving outside every worktree of the
 * calling repo family (the main clone plus its linked worktrees — #507). Recorded-but-allowed:
 * sensitive filenames. That split is deliberate — a coarse filename regex has real false-positive
 * risk (`.env.example`), and stalling an unattended worker with nobody watching to unblock it is
 * a worse outcome than a flagged-but-permitted write.
 */

const { loadFilePatterns, matchFirst } = require('./utils/pattern-loader');
const {
  readHookInput,
  allWorktreeRoots,
  isUnderRoot,
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

  // Fail-open, per-check: outside a git context only this containment sub-check is skipped. The
  // pattern checks above do not depend on git and have already run, so the hook never degrades to
  // a no-op — and it never stalls a worker that simply is not in a repository.
  const roots = allWorktreeRoots(cwd);
  if (!roots) {
    console.error(`[blackhole-hook] ${HOOK}: no git worktree resolved — containment check skipped for ${filePath}`);
  } else if (filePath && !isInsideAnyRoot(filePath, roots)) {
    denyAndRecord({
      hook: HOOK,
      tool,
      pattern_id: 'outside-worktree',
      reason: `Write target resolves outside every known worktree root (${roots.join(', ')})`,
      detail: filePath,
      cwd,
    });
    return;
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

main();

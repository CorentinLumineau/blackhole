#!/usr/bin/env bun
'use strict';

/**
 * validate-file-changes.js — PreToolUse gate for the Write and Edit tools.
 *
 * Blocked: system paths, `../` traversal, and any target resolving outside the calling worktree.
 * Recorded-but-allowed: sensitive filenames. That split is deliberate — a coarse filename regex
 * has real false-positive risk (`.env.example`), and stalling an unattended worker with nobody
 * watching to unblock it is a worse outcome than a flagged-but-permitted write.
 */

const fs = require('fs');
const path = require('path');
const { loadFilePatterns, matchFirst } = require('./utils/pattern-loader');
const {
  readHookInput,
  worktreeRoot,
  denyAndRecord,
  warnAndRecord,
  allowSilently,
  failClosed,
} = require('./utils/hook-event-log');

const HOOK = 'validate-file-changes';

/** Realpath of the nearest ancestor of `p` that exists on disk. Containment has to be decided on
 * resolved paths (temp dirs and home directories are routinely symlinks), but the write target
 * itself usually does not exist yet — its nearest existing ancestor does. `../` is already refused
 * before this runs, so an ancestor inside the worktree implies the target is inside it too. */
const resolveExistingAncestor = (p) => {
  let current = path.resolve(p);
  for (;;) {
    try {
      return fs.realpathSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
};

const isInsideWorktree = (filePath, root) => {
  const anchor = resolveExistingAncestor(path.dirname(path.resolve(filePath)));
  const realRoot = resolveExistingAncestor(root);
  return anchor === realRoot || anchor.startsWith(realRoot + path.sep);
};

const main = () => {
  const input = readHookInput();
  const tool = input.tool_name || 'Write';
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || toolInput.path || '';

  let patterns;
  try {
    patterns = loadFilePatterns();
  } catch (error) {
    failClosed({ hook: HOOK, tool, error });
    return;
  }

  const traversal = matchFirst(filePath, patterns.pathTraversal);
  if (traversal) {
    denyAndRecord({ hook: HOOK, tool, pattern_id: traversal.id, reason: traversal.reason, detail: filePath });
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
    });
    return;
  }

  // Fail-open, per-check: outside a git context only this containment sub-check is skipped. The
  // pattern checks above do not depend on git and have already run, so the hook never degrades to
  // a no-op — and it never stalls a worker that simply is not in a repository.
  const root = worktreeRoot();
  if (!root) {
    console.error(`[blackhole-hook] ${HOOK}: no git worktree resolved — containment check skipped for ${filePath}`);
  } else if (filePath && !isInsideWorktree(filePath, root)) {
    denyAndRecord({
      hook: HOOK,
      tool,
      pattern_id: 'outside-worktree',
      reason: `Write target resolves outside the worktree root ${root}`,
      detail: filePath,
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
    });
    return;
  }

  allowSilently();
};

main();

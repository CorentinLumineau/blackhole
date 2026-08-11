#!/usr/bin/env bun
'use strict';

/**
 * validate-bash-command.js — PreToolUse gate for the Bash tool.
 *
 * Two tiers, not the interactive four: an unattended worker has no human to ask, so every decision
 * is either a refusal (irreversible, no legitimate use case) or a recorded allow (risky but
 * sometimes legitimate). Policy lives here; the patterns live in patterns/bash-patterns.json and
 * the I/O boundary in utils/hook-event-log.js.
 */

const { loadBashPatterns } = require('./utils/pattern-loader');
const { matchFirstIgnoringNonExecutingText } = require('./utils/bash-context');
const { evaluateWorktreeRemoval } = require('./utils/worktree-removal-guard');
const {
  readHookInput,
  denyAndRecord,
  warnAndRecord,
  allowSilently,
  failClosed,
} = require('./utils/hook-event-log');

const HOOK = 'validate-bash-command';

const main = () => {
  let input;
  try {
    input = readHookInput();
  } catch (error) {
    failClosed({ hook: HOOK, tool: 'Bash', error, patternId: 'hook-input-parse-failure', label: 'hook input' });
    return;
  }
  const tool = input.tool_name || 'Bash';
  const command = (input.tool_input && input.tool_input.command) || '';
  // The tool call's own working directory (harness-supplied on the payload) rather than the hook
  // process's own process.cwd() — see hook-event-log.js's `git` docstring for why (#507). Needed
  // here to resolve a relative `git worktree remove` path argument.
  const cwd = input.cwd || process.cwd();

  let patterns;
  try {
    patterns = loadBashPatterns();
  } catch (error) {
    failClosed({ hook: HOOK, tool, error, cwd });
    return;
  }

  const blocked = matchFirstIgnoringNonExecutingText(command, patterns.blockPatterns);
  if (blocked) {
    denyAndRecord({
      hook: HOOK,
      tool,
      pattern_id: blocked.id,
      reason: blocked.reason,
      detail: command,
    });
    return;
  }

  // Dynamic check (#532): whether a `git worktree remove` is safe depends on the pushed state of
  // the target worktree's branch, which no static pattern can see — see
  // worktree-removal-guard.js's module docstring.
  const worktreeRemoval = evaluateWorktreeRemoval(command, cwd);
  if (worktreeRemoval && worktreeRemoval.tier === 'block') {
    denyAndRecord({
      hook: HOOK,
      tool,
      pattern_id: worktreeRemoval.pattern_id,
      reason: worktreeRemoval.reason,
      detail: command,
    });
    return;
  }

  const flagged = matchFirstIgnoringNonExecutingText(command, patterns.warnPatterns);
  if (flagged) {
    warnAndRecord({
      hook: HOOK,
      tool,
      pattern_id: flagged.id,
      reason: flagged.reason,
      detail: command,
    });
    return;
  }

  allowSilently();
};

// Top-level catch-all (#580): everything above this point is wrapped in `main()`'s own
// synchronous call graph, but two `try/catch` blocks only cover JSON-parse and pattern-load
// failures — an uncaught exception anywhere else (e.g. a non-string `cwd` reaching
// worktree-removal-guard.js's `path.resolve`) used to fall through to the process boundary,
// which the wrapper (claude-native-settings.ts) treats as "validator could not run" and
// converts to an ALLOW. Routing every uncaught exception through the same `failClosed()` the
// two existing checks already use closes that class rather than patching individual crash
// sites — see .blackhole/plans/issue-580.md's Root-Cause Decision Record.
try {
  main();
} catch (error) {
  console.error(`[blackhole-hook] ${HOOK}: uncaught error in validator logic — ${error.stack}`);
  failClosed({ hook: HOOK, tool: 'Bash', error, patternId: 'uncaught-validator-error', label: 'validator logic' });
}

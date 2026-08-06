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

const { loadBashPatterns, matchFirst } = require('./utils/pattern-loader');
const {
  readHookInput,
  denyAndRecord,
  warnAndRecord,
  allowSilently,
  failClosed,
} = require('./utils/hook-event-log');

const HOOK = 'validate-bash-command';

const main = () => {
  const input = readHookInput();
  const tool = input.tool_name || 'Bash';
  const command = (input.tool_input && input.tool_input.command) || '';

  let patterns;
  try {
    patterns = loadBashPatterns();
  } catch (error) {
    failClosed({ hook: HOOK, tool, error });
    return;
  }

  const blocked = matchFirst(command, patterns.blockPatterns);
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

  const flagged = matchFirst(command, patterns.warnPatterns);
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

main();

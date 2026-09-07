#!/usr/bin/env bun
'use strict';

const fs = require('fs');
const path = require('path');
const { extractCommandPath } = require('./installed-plugin-rows');

/**
 * isPluginHealthy(installPath) — verifies only that a registered plugin's own
 * `<installPath>/hooks/hooks.json` still declares at least one `PreToolUse` entry whose
 * referenced script file exists on disk and is non-empty.
 *
 * SCOPE — canonical statement, referenced rather than restated by every caller: this detects the
 * manifest-declared-but-script-missing layer only — a `hooks.json` that still declares an entry
 * whose script no longer exists or is empty. It does NOT detect the stale-cache class (ADR-030):
 * a script file that exists, is non-empty, and is referenced correctly by an untouched
 * `hooks.json`, but whose *content* is stale or broken. Neither this function nor any caller may
 * describe this check as closing the stale-cache class.
 *
 * Every failure path returns `false` — fail-closed toward the caller staying active. This
 * function never throws.
 */
const isPluginHealthy = (installPath) => {
  if (typeof installPath !== 'string' || installPath.length === 0) return false;

  let raw;
  try {
    raw = fs.readFileSync(path.join(installPath, 'hooks', 'hooks.json'), 'utf-8');
  } catch {
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  const entries = (parsed && parsed.hooks && parsed.hooks.PreToolUse) || null;
  if (!Array.isArray(entries) || entries.length === 0) return false;

  let scriptPaths;
  try {
    scriptPaths = [];
    for (const entry of entries) {
      for (const h of (entry && entry.hooks) || []) {
        const command = typeof h.command === 'string' ? h.command.split('${CLAUDE_PLUGIN_ROOT}').join(installPath) : '';
        const scriptPath = extractCommandPath(command);
        if (scriptPath) scriptPaths.push(scriptPath);
      }
    }
  } catch {
    return false;
  }

  if (scriptPaths.length === 0) return false;

  try {
    return scriptPaths.every((scriptPath) => {
      const stat = fs.statSync(scriptPath);
      return stat.isFile() && stat.size > 0;
    });
  } catch {
    return false;
  }
};

module.exports = {
  isPluginHealthy,
};

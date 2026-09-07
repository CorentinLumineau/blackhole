#!/usr/bin/env bun
'use strict';

/**
 * sibling-plugin-guard.js — ownership-detection guard for issue #870's Option A-prime: when a
 * sibling `mercure` plugin is registered and the calling repo is an interactive, non-campaign
 * session (its main clone has no `.blackhole/config.json`), blackhole's own PreToolUse validators
 * stand down and cede the call to mercure's independently-registered hook rather than running
 * both validators' drifted deny lists on every Bash/Write/Edit call.
 *
 * Any detection ambiguity — an unreadable/malformed `installed_plugins.json`, no git context, an
 * anomalous `mainCloneRoot` throw, or an unreadable-but-present `.blackhole/config.json` stat —
 * fails closed toward NOT deferring: blackhole stays active. This is deliberate (design note
 * turn-19 ruling): a false defer silences blackhole's own containment with only mercure's
 * independently-versioned hook as backstop, while a false stay-active merely costs the redundant
 * second validator pass this issue set out to reduce, never a safety regression.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { mainCloneRoot } = require('./hook-event-log');

/** True when `cwd`'s calling session should defer entirely to a sibling mercure plugin's own
 * PreToolUse hook. See the module docstring above for the three-condition contract and the
 * fail-closed-toward-stay-active discipline applied to every ambiguous read. */
const shouldDeferToMercure = (cwd = process.cwd()) => {
  const claudeHome = process.env.BLACKHOLE_CLAUDE_HOME || path.join(os.homedir(), '.claude');
  const installedPluginsPath = path.join(claudeHome, 'plugins', 'installed_plugins.json');

  let raw;
  try {
    raw = fs.readFileSync(installedPluginsPath, 'utf-8');
  } catch {
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  const pluginKeys = Object.keys((parsed && parsed.plugins) || {});
  const hasMercureSibling = pluginKeys.some((key) => key.split('@')[0] === 'mercure');
  if (!hasMercureSibling) return false;

  let mainClone;
  try {
    mainClone = mainCloneRoot(cwd);
  } catch {
    return false;
  }
  if (!mainClone) return false;

  try {
    fs.statSync(path.join(mainClone, '.blackhole', 'config.json'));
    return false; // config present — this IS a campaign session, blackhole stays active
  } catch (error) {
    if (error && error.code === 'ENOENT') return true; // config absent — defer to mercure
    return false; // any other stat error is ambiguous — fail closed toward staying active
  }
};

module.exports = {
  shouldDeferToMercure,
};

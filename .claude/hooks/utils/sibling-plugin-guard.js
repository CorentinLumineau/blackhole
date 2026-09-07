#!/usr/bin/env bun
'use strict';

/**
 * sibling-plugin-guard.js — ownership-detection guard for issue #870's Option A-prime, extended
 * by issue #969's health leg (Option A, owner-ruled partial fix — see
 * `.blackhole/plans/issue-969-design.md`'s turn-19 gate). When a sibling `mercure` plugin is
 * registered, the calling repo is an interactive, non-campaign session (its main clone has no
 * `.blackhole/config.json`), AND that plugin's registered install still resolves to a
 * present, non-empty script (the health leg below), blackhole's own PreToolUse validators stand
 * down and cede the call to mercure's independently-registered hook rather than running both
 * validators' drifted deny lists on every Bash/Write/Edit call.
 *
 * Four conditions gate a defer: (1) a sibling `mercure*` key is registered in
 * `installed_plugins.json`; (2) the calling repo resolves to a real git main clone; (3) that
 * plugin's preferred candidate install row (project-scope preferred over user-scope, issue #969
 * binding constraint 4 — see `isPluginHealthy`'s caller below) passes the health check; (4) that
 * main clone has no `.blackhole/config.json`.
 *
 * Condition (3) is deliberately narrow. `isPluginHealthy` owns the canonical statement of what
 * that check does and does not detect; nothing here may widen the claim it makes.
 *
 * Any detection ambiguity — an unreadable/malformed `installed_plugins.json`, no git context, an
 * anomalous `mainCloneRoot` throw, no candidate install row, a failing health check, or an
 * unreadable-but-present `.blackhole/config.json` stat — fails closed toward NOT deferring:
 * blackhole stays active. This is deliberate (design note turn-19 ruling): a false defer
 * silences blackhole's own containment with only mercure's independently-versioned hook as
 * backstop, while a false stay-active merely costs the redundant second validator pass this
 * issue set out to reduce, never a safety regression.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { mainCloneRoot } = require('./hook-event-log');
const { selectCandidateInstalledPluginRows } = require('./installed-plugin-rows');
const { isPluginHealthy } = require('./sibling-plugin-health');

/** True when `cwd`'s calling session should defer entirely to a sibling mercure plugin's own
 * PreToolUse hook. See the module docstring above for the four-condition contract and the
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

  const pluginsMap = (parsed && parsed.plugins) || {};
  const mercureKeys = Object.keys(pluginsMap).filter((key) => key.split('@')[0] === 'mercure');
  if (mercureKeys.length === 0) return false;

  // Moved earlier than the pre-#969 config-presence check below: the health leg needs
  // `mainClone` to filter candidate rows by `projectPath` (constraint 4), not only later for the
  // config check. Behaviorally equivalent reordering — every path in this function is an
  // AND-composed short-circuit returning `false` on any failure, so moving a failure-capable
  // step earlier changes no observable outcome, only which check reports first.
  let mainClone;
  try {
    mainClone = mainCloneRoot(cwd);
  } catch {
    return false;
  }
  if (!mainClone) return false;

  let allRows = [];
  for (const key of mercureKeys) {
    const rows = pluginsMap[key];
    if (Array.isArray(rows)) allRows = allRows.concat(rows);
  }
  const candidates = selectCandidateInstalledPluginRows(allRows, mainClone);
  const preferred =
    candidates.find((row) => row.scope === 'project') || candidates.find((row) => row.scope === 'user');
  if (!preferred || typeof preferred.installPath !== 'string') return false;
  if (!isPluginHealthy(preferred.installPath)) return false;

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

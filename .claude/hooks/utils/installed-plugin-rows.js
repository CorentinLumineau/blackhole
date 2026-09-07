#!/usr/bin/env bun
'use strict';

/**
 * installed-plugin-rows.js — shared row-filter + command-path-extraction helpers for reading
 * `~/.claude/plugins/installed_plugins.json` rows and the script paths their `PreToolUse`
 * `command` strings reference.
 *
 * Canonical implementation lives here (the shipped CommonJS hooks tree), not in
 * `scripts/lib/hook-sources.ts`, because only one import direction between the two trees is
 * safe: `scripts/lib/hook-sources.ts` is dev/orchestrator-only tooling always run from inside a
 * full repo checkout, so this file is always present on disk relative to it. The reverse
 * direction — a shipped hook script running inside an installed plugin cache reaching into
 * `scripts/lib/`, which does not exist there — is not safe, which is why this logic is not
 * authored in `scripts/lib/` and re-exported. Dual-consumed by
 * `templates/hooks/pretooluse/utils/sibling-plugin-guard.js` (via `sibling-plugin-health.js`)
 * and `scripts/lib/hook-sources.ts` — one implementation, not two independently-drifting
 * regexes.
 */

/**
 * Returns every row in `rows` that could apply to `repoRoot`: a `user`-scope row (always a
 * candidate) or a `project`-scope row whose `projectPath` matches `repoRoot` exactly. Mirrors
 * `hook-sources.ts`'s `enumeratePluginCacheSources` filter verbatim — this function never
 * adjudicates precedence between multiple candidates, that is left to the caller.
 */
const selectCandidateInstalledPluginRows = (rows, repoRoot) => {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row) => row && (row.scope === 'user' || (row.scope === 'project' && row.projectPath === repoRoot)),
  );
};

/**
 * Extracts a plausible script path from a hook command string — enough to name and locate the
 * script for a present/non-empty check, not a full shell parser. Prefers a single-quoted path,
 * falling back to the first bare `/`- or `~`-rooted token ending in a common script extension
 * (`.sh`, `.js`, `.ts`, `.mjs`).
 */
const extractCommandPath = (command) => {
  if (typeof command !== 'string') return null;
  const quoted = command.match(/'([^']+\.(?:sh|js|ts|mjs))'/);
  if (quoted) return quoted[1];
  const bare = command.match(/(~?\/[^\s'"]+\.(?:sh|js|ts|mjs))/);
  return bare ? bare[1] : null;
};

module.exports = {
  selectCandidateInstalledPluginRows,
  extractCommandPath,
};

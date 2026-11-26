import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { readJsonFile } from '../lib/fs.ts';
import { CLAUDE_NATIVE_ROOT } from '../lib/build/paths.ts';
import { runFullBuildOnce } from '../lib/check-common.ts';

// ADR-065 — the maintainer-only `.claude/` target counterpart to hooks.check.ts's V-NOGUARD-01.
// That check scans every built tree for a registered PreToolUse hook; this one pins the one file
// the build edits in place rather than regenerates: `.claude/settings.json` must be parseable and
// carry no blackhole guard entry left over from the builds that used to merge one in.

const RETIRED_GUARD_FINGERPRINTS = ['validate-bash-command.js', 'validate-file-changes.js'];

type HookCommand = { command?: unknown };
type PreToolUseEntry = { matcher?: unknown; hooks?: HookCommand[] };

/** Errors for `<claudeRoot>/settings.json`: invalid JSON, or a PreToolUse entry that still runs a
 * retired blackhole validator. An absent file is clean — nothing is wired. */
export const evaluateClaudeSettingsHooksWiring = (claudeRoot: string): string[] => {
  const settingsPath = path.join(claudeRoot, 'settings.json');
  if (!fs.existsSync(settingsPath)) return [];

  let preToolUse: PreToolUseEntry[];
  try {
    const parsed = readJsonFile(settingsPath, settingsPath) as Record<string, unknown>;
    const hooks = parsed.hooks as Record<string, unknown> | undefined;
    preToolUse = (hooks?.PreToolUse ?? []) as PreToolUseEntry[];
    if (!Array.isArray(preToolUse)) return [`${claudeRoot}: settings.json hooks.PreToolUse is not an array`];
  } catch (err) {
    return [`${claudeRoot}: settings.json invalid JSON (${(err as Error).message})`];
  }

  return preToolUse
    .filter((entry) =>
      (Array.isArray(entry.hooks) ? entry.hooks : []).some(
        (h) => typeof h.command === 'string' && RETIRED_GUARD_FINGERPRINTS.some((f) => (h.command as string).includes(f)),
      ),
    )
    .map((entry) => `${claudeRoot}: settings.json still wires a retired guard for matcher "${String(entry.matcher)}" (ADR-065)`);
};

// V-CLAUDESETTINGS-01: .claude/settings.json carries no retired guard registration.
const checkClaudeSettingsHooksWiring = (): CheckResult => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runFullBuildOnce();
    if (!build.ok) return { id: 'V-CLAUDESETTINGS-01', ok: false, detail: `build failed: ${build.output}` };
  }

  const errors = evaluateClaudeSettingsHooksWiring(path.join(root, CLAUDE_NATIVE_ROOT));
  if (errors.length) return { id: 'V-CLAUDESETTINGS-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-CLAUDESETTINGS-01', ok: true };
};

export const runChecks = (): CheckResult[] => [checkClaudeSettingsHooksWiring()];

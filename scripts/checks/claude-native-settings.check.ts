import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { CLAUDE_NATIVE_ROOT } from '../lib/build/paths.ts';
import { runFullBuildOnce } from '../lib/check-common.ts';

// Issue #472 — the maintainer-only-target counterpart to hooks.check.ts's V-HOOKWIRE-01. That
// check pins the shape of the `hooks/` tree copied into every bundle root (DISTRIBUTION_ROOT,
// CLAUDE_DISTRIBUTION_ROOT, CLAUDE_NATIVE_ROOT). This check pins the piece that only
// `.claude/settings.json` needs: proof the copied scripts are actually *wired* — Claude Code's
// project-native install surface reads hook registrations from `hooks` in settings.json, not
// from a freestanding hooks.json file (that convention is plugin-bundle-specific).

const REQUIRED_MATCHERS: { matcher: string; fingerprint: string }[] = [
  { matcher: 'Bash', fingerprint: 'validate-bash-command.js' },
  { matcher: 'Write|Edit', fingerprint: 'validate-file-changes.js' },
];

type HookCommand = { type?: unknown; command?: unknown };
type PreToolUseEntry = { matcher?: unknown; hooks?: HookCommand[] };

/** `.claude/settings.json`'s PreToolUse wiring: present, parseable, one entry per required
 * matcher fingerprinted to its `.claude/hooks/validate-*.js` script, and — the exact failure mode
 * this issue's design corroborated live on this machine — no entry's command still carries the
 * unresolvable `${CLAUDE_PLUGIN_ROOT}` plugin-install-context variable. */
export const evaluateClaudeSettingsHooksWiring = (claudeRoot: string): string[] => {
  const settingsPath = path.join(claudeRoot, 'settings.json');
  if (!fs.existsSync(settingsPath)) return [`${claudeRoot}: missing settings.json`];

  let preToolUse: PreToolUseEntry[];
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    const hooks = parsed.hooks as Record<string, unknown> | undefined;
    preToolUse = (hooks?.PreToolUse ?? []) as PreToolUseEntry[];
    if (!Array.isArray(preToolUse)) return [`${claudeRoot}: settings.json hooks.PreToolUse is not an array`];
  } catch (err) {
    return [`${claudeRoot}: settings.json invalid JSON (${(err as Error).message})`];
  }

  const errors: string[] = [];
  for (const required of REQUIRED_MATCHERS) {
    const entry = preToolUse.find(
      (e) =>
        e.matcher === required.matcher &&
        Array.isArray(e.hooks) &&
        e.hooks.some((h) => typeof h.command === 'string' && h.command.includes(required.fingerprint)),
    );
    if (!entry) {
      errors.push(
        `${claudeRoot}: settings.json missing a PreToolUse entry for matcher "${required.matcher}" fingerprinted to ${required.fingerprint}`,
      );
    }
  }

  for (const entry of preToolUse) {
    for (const h of Array.isArray(entry.hooks) ? entry.hooks : []) {
      const command = typeof h.command === 'string' ? h.command : '';
      if (command.includes('${CLAUDE_PLUGIN_ROOT}')) {
        errors.push(
          `${claudeRoot}: matcher "${String(entry.matcher)}" command still references \${CLAUDE_PLUGIN_ROOT}, which does not resolve for a native/project-level hook`,
        );
      }
    }
  }

  return errors;
};

// V-CLAUDESETTINGS-01: .claude/settings.json wires PreToolUse for the copied validators.
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

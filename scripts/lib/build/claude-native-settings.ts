import * as fs from 'fs';
import * as path from 'path';

/**
 * .claude/settings.json cleanup (ADR-065). Earlier builds merged blackhole's PreToolUse guard entries
 * into this repo's own `.claude/settings.json`; no guard ships any more, so the build removes exactly
 * those entries and passes every other key, hook event and foreign PreToolUse entry through
 * untouched (the file may carry maintainer-set `permissions`/`env`/`skillOverrides`). Writes go
 * through the same atomic tmp+rename idiom as
 * `scripts/campaign-resume-signal.ts:writeResumeRequestAtomic` (V-INT-02).
 */

type HookCommand = { command?: unknown };
type PreToolUseEntry = { matcher?: unknown; hooks?: unknown };

/** Substrings that fingerprint a command as one of the retired guard validators. */
const RETIRED_GUARD_FINGERPRINTS = ['validate-bash-command.js', 'validate-file-changes.js'];

/** True when `entry` runs a retired blackhole validator — identified by the script filename in its
 * command, not by matcher alone, so a maintainer's own Bash-matcher entry is never removed. */
const isRetiredGuardEntry = (entry: PreToolUseEntry): boolean => {
  const hooks = Array.isArray(entry.hooks) ? (entry.hooks as HookCommand[]) : [];
  return hooks.some(
    (h) => typeof h.command === 'string' && RETIRED_GUARD_FINGERPRINTS.some((f) => (h.command as string).includes(f)),
  );
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Pure removal: computes the next `.claude/settings.json` content from `existing`. Idempotent — a
 * second pass over its own output is byte-identical. An emptied `PreToolUse` array and an emptied
 * `hooks` object are dropped, so a settings file that carried only blackhole's guards ends as `{}`.
 */
export const stripBlackholeGuardHooksFrom = (existing: unknown): Record<string, unknown> => {
  if (existing !== null && existing !== undefined && !isPlainObject(existing)) {
    throw new Error(
      'claude-native-settings: existing .claude/settings.json does not parse to a JSON object — refusing to guess at its shape',
    );
  }
  const { hooks, ...rest } = isPlainObject(existing) ? existing : ({} as Record<string, unknown>);
  if (!isPlainObject(hooks)) return hooks === undefined ? rest : { ...rest, hooks };

  const { PreToolUse, ...otherEvents } = hooks;
  const kept = Array.isArray(PreToolUse) ? (PreToolUse as PreToolUseEntry[]).filter((e) => !isRetiredGuardEntry(e)) : PreToolUse;
  const nextHooks = kept === undefined || (Array.isArray(kept) && kept.length === 0) ? otherEvents : { ...otherEvents, PreToolUse: kept };
  return Object.keys(nextHooks).length === 0 ? rest : { ...rest, hooks: nextHooks };
};

/**
 * Reads `<claudeRoot>/settings.json` (an absent file stays absent), removes the retired guard
 * entries, and writes the result back atomically. A file that exists but is malformed or zero-byte
 * is a distinct, suspicious state from "no settings yet": it throws rather than treating maintainer
 * state as empty (guessing wrong here is data loss, not a test failure).
 */
export const stripBlackholeGuardHooks = (claudeRoot: string): void => {
  const target = path.join(claudeRoot, 'settings.json');
  if (!fs.existsSync(target)) return;
  const raw = fs.readFileSync(target, 'utf-8');
  if (raw.trim().length === 0) {
    throw new Error(
      `claude-native-settings: ${target} exists but is empty — refusing to guess whether this is fresh or truncated state`,
    );
  }
  const next = stripBlackholeGuardHooksFrom(JSON.parse(raw));
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, target);
};

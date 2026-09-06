import * as fs from 'fs';
import * as path from 'path';

/**
 * .claude/settings.json PreToolUse merge (issue #472). This repo's own campaign runs from
 * .claude/, so the same PreToolUse safety gate shipped to the consumer-facing plugin bundles
 * (#447/#470) must be wired here too — but `.claude/settings.json` may carry maintainer-set
 * `permissions`/`env`/`skillOverrides` that a naive overwrite would clobber. The merge below
 * therefore touches exactly one key path, `hooks.PreToolUse`, and passes every other key through
 * untouched; writes go through the same atomic tmp+rename idiom as
 * `scripts/campaign-resume-signal.ts:writeResumeRequestAtomic` (V-INT-02).
 */

type HookCommand = { type: 'command'; command: string; timeout: number };
type PreToolUseEntry = { matcher?: unknown; hooks?: unknown };

type MatcherSpec = {
  /** Claude Code tool matcher this entry gates. */
  matcher: string;
  /** Validator script under .claude/hooks/, copied verbatim by copyHooksDir. */
  script: string;
};

const MATCHERS: MatcherSpec[] = [
  { matcher: 'Bash', script: 'validate-bash-command.js' },
  { matcher: 'Write|Edit', script: 'validate-file-changes.js' },
];

/**
 * The ERROR-outcome contract (plan § Database/API Schema Changes): exit 0 (allow) and exit 2
 * (the validator's own deliberate deny) pass through verbatim — anything else means the validator
 * process itself could not run to completion (bad path, missing binary, crash before it reaches
 * its own failClosed()). That case degrades to allow rather than fail-closed, so an infra hiccup
 * can never stall the orchestrator's own session, but it is durably recorded under
 * .blackhole/hook-events/ with `tier: "error"` so Triage still surfaces it. The explicit
 * `code=$?` capture and 0/2 branch (not a blanket `command1 || fallback`) is what keeps a
 * legitimate deny from being silently converted into an allow — the single most load-bearing
 * line in this contract.
 *
 * The record carries no stdin/command replay — this fallback never needs to reimplement
 * hook-event-log.js's `redact()` in shell (V-INT-02); the two "process ran" decision paths
 * reuse `redact()` unchanged. `detail` is no longer the bare exit code: ADR-042
 * enriches it with a timeout-vs-crash discriminator and a capped tail of the validator's own
 * stderr, so a collapsed hook-exec-failure class is still diagnosable — capped at 300 chars,
 * the same bound `hook-schemas.md` already documents for block/warn-tier `detail`.
 */
const buildCommand = (spec: MatcherSpec): string => {
  const hookName = spec.script.replace(/\.js$/, '');
  const toolField = spec.matcher === 'Bash' ? 'tool: "Bash",' : 'tool: null,';
  return [
    // ADR-042 item 5 — capture the validator's own stderr to a temp file rather
    // than `output=$(cmd 2>&1)`: a combined-output capture would also swallow the process's
    // *stdout* (the hookSpecificOutput JSON the 0/2 paths must still emit for Claude Code to
    // read), which a plain command substitution does not let pass through. `trap ... EXIT`
    // guarantees cleanup on every exit path without touching the exit-code contract line below.
    'stderr_tmp="$(mktemp)"',
    'trap \'rm -f "$stderr_tmp"\' EXIT',
    'start_s="$(date +%s)"',
    `bun run "$CLAUDE_PROJECT_DIR/.claude/hooks/${spec.script}" 2>"$stderr_tmp"`,
    'code=$?',
    'end_s="$(date +%s)"',
    'if [ "$code" = "0" ] || [ "$code" = "2" ]; then exit "$code"; fi',
    'mkdir -p "$CLAUDE_PROJECT_DIR/.blackhole/hook-events" 2>/dev/null',
    'worktree="$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"',
    // Whole-second elapsed time, not `date +%s%N`: BSD/macOS date has no %N, and an
    // arithmetic expansion on its literal "N" output would abort the script. Coarse but
    // sufficient to discriminate near-the-5s-hook-timeout kills from an instant crash.
    'elapsed_s=$(( end_s - start_s ))',
    'if [ "$elapsed_s" -ge 4 ]; then kind="timeout"; else kind="crash"; fi',
    'stderr_tail="$(tail -c 300 "$stderr_tmp" 2>/dev/null | tr -d \'\\0\')"',
    'jq -n \\',
    '  --arg recorded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\',
    `  --arg hook "${hookName}" \\`,
    '  --arg code "$code" \\',
    '  --arg worktree "$worktree" \\',
    '  --arg kind "$kind" \\',
    '  --arg stderr_tail "$stderr_tail" \\',
    `  '{version: 1, recorded_at: $recorded_at, hook: $hook, ${toolField} decision: "allow", tier: "error", pattern_id: "hook-exec-failure", reason: ("validator process exited " + $code + " before producing a decision"), worktree: (if $worktree == "" then null else $worktree end), detail: ("process exit code " + $code + " (" + $kind + ")" + (if $stderr_tail == "" then "" else ": " + $stderr_tail end))}' \\`,
    '  > "$CLAUDE_PROJECT_DIR/.blackhole/hook-events/hook-exec-error-$(date +%s%N).json" 2>/dev/null',
    `echo "[blackhole-hook] ${hookName}: validator process exited $code before producing a decision — call allowed (fail-open); see .blackhole/hook-events/" >&2`,
    'exit 0',
  ].join('\n');
};

const blackholeEntry = (spec: MatcherSpec): PreToolUseEntry & { matcher: string; hooks: HookCommand[] } => ({
  matcher: spec.matcher,
  hooks: [{ type: 'command', command: buildCommand(spec), timeout: 5 }],
});

/** True when `entry` is blackhole's own PreToolUse entry for `spec` — identified by a stable
 * substring (the validator script filename) in its command, not by matcher alone, so a
 * maintainer's own custom Bash-matcher entry is never mistaken for blackhole's. */
const isBlackholeEntry = (entry: PreToolUseEntry, spec: MatcherSpec): boolean => {
  const hooks = Array.isArray(entry.hooks) ? (entry.hooks as HookCommand[]) : [];
  return hooks.some((h) => typeof h.command === 'string' && h.command.includes(spec.script));
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Pure merge: computes the next `.claude/settings.json` content from `existing`. Fingerprint
 * replace-not-append keeps a rebuild idempotent — running this twice on identical input produces
 * a byte-identical result the second time (AC-4a). Every top-level key other than `hooks`, and
 * every `hooks.*` entry other than blackhole's own two `PreToolUse` matchers, passes through
 * unchanged (AC-4b/4c).
 */
export const computeMergedSettings = (existing: unknown): Record<string, unknown> => {
  if (existing !== null && existing !== undefined && !isPlainObject(existing)) {
    throw new Error(
      'claude-native-settings: existing .claude/settings.json does not parse to a JSON object — refusing to guess at its shape',
    );
  }
  const base: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};

  const existingHooks = isPlainObject(base.hooks) ? { ...base.hooks } : {};
  const existingPreToolUse: PreToolUseEntry[] = Array.isArray(existingHooks.PreToolUse)
    ? (existingHooks.PreToolUse as PreToolUseEntry[])
    : [];

  const merged = [...existingPreToolUse];
  for (const spec of MATCHERS) {
    const entry = blackholeEntry(spec);
    const idx = merged.findIndex((e) => isBlackholeEntry(e, spec));
    if (idx >= 0) merged[idx] = entry;
    else merged.push(entry);
  }

  return {
    ...base,
    hooks: {
      ...existingHooks,
      PreToolUse: merged,
    },
  };
};

/**
 * Reads `<claudeRoot>/settings.json` (or treats it as absent if the file does not exist),
 * computes the merge, and writes the result back atomically (tmp + rename). An existing file
 * that exists but is malformed or zero-byte is a distinct, suspicious state from "no settings
 * yet" — it throws rather than silently treating maintainer state as empty (this file may carry
 * hand-set `permissions`/`env`/`skillOverrides`; guessing wrong here is data loss, not a test
 * failure).
 */
export const mergeClaudeSettingsHooks = (claudeRoot: string): void => {
  const target = path.join(claudeRoot, 'settings.json');
  let existing: unknown = {};
  if (fs.existsSync(target)) {
    const raw = fs.readFileSync(target, 'utf-8');
    if (raw.trim().length === 0) {
      throw new Error(
        `claude-native-settings: ${target} exists but is empty — refusing to guess whether this is fresh or truncated state`,
      );
    }
    existing = JSON.parse(raw);
  }
  const merged = computeMergedSettings(existing);
  const tmp = `${target}.tmp`;
  fs.mkdirSync(claudeRoot, { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, target);
};

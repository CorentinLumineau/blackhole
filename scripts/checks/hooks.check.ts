import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { AGENTS_BUILD_ROOT, CLAUDE_DISTRIBUTION_ROOT, CLAUDE_NATIVE_ROOT, DISTRIBUTION_ROOT } from '../lib/build/paths.ts';
import { runFullBuildOnce } from '../lib/check-common.ts';
import { readJsonFile } from '../lib/fs.ts';

// ADR-007 T5/R2' — hooks.check.ts: PreToolUse safety-gate shape in every shipped plugin bundle
// (#447) — matches scripts/verify.hooks.test.ts.
//
// This check is what makes the hooks' fail-closed-on-pattern-load-failure trade-off safe to ship:
// a validator that cannot parse its pattern data denies every call it sees, so a malformed pattern
// file reaching a consumer would stall an unattended worker outright. Validating both pattern
// files here, at `bun run scripts/verify.ts` time, is the gate that stops that from shipping.
// Weakening or removing this check invalidates that argument — see the plan's Execution Strategy.

/** Four copies of the hooks/ tree: two consumer bundles, `.claude` (#472), `.agents/build`. */
export const HOOK_BUNDLE_ROOTS = [DISTRIBUTION_ROOT, CLAUDE_DISTRIBUTION_ROOT, CLAUDE_NATIVE_ROOT, AGENTS_BUILD_ROOT];

/** SSOT copied verbatim by `copyHooksDir`. Claude marketplace then appends SessionStart. */
export const PRETOOLUSE_HOOKS_SSOT = path.join('templates', 'hooks', 'pretooluse', 'hooks.json');

/** Matchers hooks.json must wire under PreToolUse. Bash covers destructive commands; Write|Edit
 * covers system-path, traversal, and outside-worktree writes. */
export const REQUIRED_PRETOOLUSE_MATCHERS = ['Bash', 'Write|Edit'];

export const PATTERN_FILES = ['bash-patterns.json', 'file-patterns.json'];

/** The array-valued keys each pattern file must carry. Explicit per-file, rather than "every
 * top-level key whose value is an array" (the loose version this replaced): a renamed or dropped
 * key must fail this check, and a blind flatten-any-array-key scan would instead just find
 * whatever array *is* present and validate that, silently accepting the schema drift (F-00050,
 * review round 1) — the same fail-closed-only-if-we-actually-notice argument the module header
 * above makes about pattern-load failure applies here to pattern *shape*. */
export const REQUIRED_PATTERN_KEYS: Record<string, string[]> = {
  'bash-patterns.json': ['blockPatterns', 'warnPatterns'],
  'file-patterns.json': ['blockedSystemPaths', 'pathTraversal', 'sensitiveFiles'],
};

type PatternEntry = { id?: unknown; pattern?: unknown; flags?: unknown; reason?: unknown };
type HookCommand = { type?: unknown; command?: unknown; onFailure?: unknown; timeout?: unknown };
type PreToolUseEntry = { matcher?: unknown; hooks?: HookCommand[] };

/** Claude Code ≥2.1.295: a PreToolUse command hook that cannot start, times out, or exits
 * unexpectedly blocks the tool call instead of failing open. SessionStart is out of scope. */
export const REQUIRED_PRETOOLUSE_ON_FAILURE = 'block';
export const REQUIRED_PRETOOLUSE_TIMEOUT = 15;

/** Basename of the script a PreToolUse `command` names. Trailing quotes survive `split('/')`
 * when the path is quoted (`bun run "${CLAUDE_PLUGIN_ROOT}/hooks/foo.js"`). */
export const hookCommandScriptName = (command: string): string =>
  (command.split('/').pop() ?? '').replace(/["']+$/, '');

const readJson = (abs: string): Record<string, unknown> => readJsonFile(abs, abs) as Record<string, unknown>;

/** Byte-for-byte SSOT match. Claude marketplace is PreToolUse-only (SessionStart is appended). */
export const evaluateHooksSsotMatch = (bundleRoot: string, label: string, preToolUseOnly = false): string[] => {
  const copy = path.join(bundleRoot, 'hooks', 'hooks.json');
  if (!fs.existsSync(copy)) return [`${label}: missing hooks/hooks.json`];
  const ssotText = fs.readFileSync(path.join(root, PRETOOLUSE_HOOKS_SSOT), 'utf-8');
  const copyText = fs.readFileSync(copy, 'utf-8');
  if (!preToolUseOnly) {
    return copyText === ssotText ? [] : [`${label}: hooks/hooks.json is not a byte-for-byte copy of ${PRETOOLUSE_HOOKS_SSOT}`];
  }
  const pick = (t: string) => JSON.stringify((JSON.parse(t) as { hooks?: { PreToolUse?: unknown } }).hooks?.PreToolUse ?? null);
  try {
    return pick(copyText) === pick(ssotText) ? [] : [`${label}: PreToolUse does not match ${PRETOOLUSE_HOOKS_SSOT}`];
  } catch (err) {
    return [`${label}: hooks/hooks.json invalid JSON (${(err as Error).message})`];
  }
};

/** hooks.json wiring for one bundle: present, parseable, both matchers covered, and every matcher
 * dispatching to a command script that actually exists in the bundle. An entry with an empty
 * `hooks` array satisfies a naive "matcher present" assertion while intercepting nothing. */
export const evaluateHooksWiring = (bundleRoot: string, label: string): string[] => {
  const hooksJson = path.join(bundleRoot, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksJson)) return [`${label}: missing hooks/hooks.json`];

  let preToolUse: PreToolUseEntry[];
  try {
    const parsed = readJson(hooksJson);
    const hooks = parsed.hooks as Record<string, unknown> | undefined;
    preToolUse = (hooks?.PreToolUse ?? []) as PreToolUseEntry[];
    if (!Array.isArray(preToolUse)) return [`${label}: hooks.PreToolUse is not an array`];
  } catch (err) {
    return [`${label}: hooks/hooks.json invalid JSON (${(err as Error).message})`];
  }

  const errors: string[] = [];
  const matchers = preToolUse.map((entry) => entry.matcher);
  for (const required of REQUIRED_PRETOOLUSE_MATCHERS) {
    if (!matchers.includes(required)) errors.push(`${label}: PreToolUse missing matcher "${required}"`);
  }

  for (const entry of preToolUse) {
    const commands = Array.isArray(entry.hooks) ? entry.hooks : [];
    if (commands.length === 0) {
      errors.push(`${label}: matcher "${entry.matcher}" has no command — it intercepts nothing`);
      continue;
    }
    for (const command of commands) {
      if (command.type !== 'command') errors.push(`${label}: matcher "${entry.matcher}" hook type is not "command"`);
      if (command.type === 'command' && command.onFailure !== REQUIRED_PRETOOLUSE_ON_FAILURE) {
        errors.push(
          `${label}: matcher "${entry.matcher}" command hook missing onFailure: "${REQUIRED_PRETOOLUSE_ON_FAILURE}"`,
        );
      }
      if (command.type === 'command' && command.timeout !== REQUIRED_PRETOOLUSE_TIMEOUT) {
        errors.push(
          `${label}: matcher "${entry.matcher}" command hook timeout is not ${REQUIRED_PRETOOLUSE_TIMEOUT}`,
        );
      }
      const script = hookCommandScriptName(String(command.command ?? ''));
      if (!script || !fs.existsSync(path.join(bundleRoot, 'hooks', script))) {
        errors.push(`${label}: matcher "${entry.matcher}" points at missing script "${script}"`);
      }
    }
  }
  return errors;
};

/** Pattern data for one bundle: both files present, parseable, versioned, carrying every required
 * array key (`REQUIRED_PATTERN_KEYS`), and every entry compiling as a RegExp — the invariant the
 * hooks' fail-closed behavior depends on. */
export const evaluateHookPatterns = (bundleRoot: string, label: string): string[] => {
  const errors: string[] = [];
  for (const file of PATTERN_FILES) {
    const abs = path.join(bundleRoot, 'hooks', 'patterns', file);
    if (!fs.existsSync(abs)) {
      errors.push(`${label}: missing hooks/patterns/${file}`);
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = readJson(abs);
    } catch (err) {
      errors.push(`${label}: ${file} invalid JSON (${(err as Error).message})`);
      continue;
    }
    if (parsed.version !== 1) errors.push(`${label}: ${file} unsupported schema version ${parsed.version}`);

    const entries: PatternEntry[] = [];
    for (const key of REQUIRED_PATTERN_KEYS[file] ?? []) {
      const list = parsed[key];
      if (!Array.isArray(list)) {
        errors.push(`${label}: ${file} missing required array "${key}"`);
        continue;
      }
      entries.push(...(list as PatternEntry[]));
    }
    if (entries.length === 0) errors.push(`${label}: ${file} declares no patterns`);
    for (const entry of entries) {
      if (typeof entry.id !== 'string' || typeof entry.reason !== 'string') {
        errors.push(`${label}: ${file} entry missing id or reason`);
        continue;
      }
      // entry.pattern must be checked as a string before compiling: new RegExp(undefined, ...)
      // compiles to /(?:)/ (matches everything) without throwing, so a bare `as string` cast here
      // would let a missing "pattern" field pass with zero static errors while the loader throws
      // at runtime (F-00050, review round 1).
      if (typeof entry.pattern !== 'string') {
        errors.push(`${label}: ${file} entry "${entry.id}" missing string "pattern"`);
        continue;
      }
      if (entry.flags !== undefined && typeof entry.flags !== 'string') {
        errors.push(`${label}: ${file} entry "${entry.id}" has non-string "flags"`);
        continue;
      }
      try {
        new RegExp(entry.pattern, entry.flags ?? '');
      } catch (err) {
        errors.push(`${label}: ${file} entry "${entry.id}" does not compile (${(err as Error).message})`);
      }
    }
  }
  return errors;
};

const buildFailure = (id: string): CheckResult | null => {
  if (process.env.VERIFY_SKIP_BUILD === '1') return null;
  const build = runFullBuildOnce();
  return build.ok ? null : { id, ok: false, detail: `build failed: ${build.output}` };
};

// V-HOOKWIRE-01: every copy wires PreToolUse for Bash and Write|Edit and matches SSOT.
const checkHooksWiring = (): CheckResult => {
  const blocked = buildFailure('V-HOOKWIRE-01');
  if (blocked) return blocked;

  const errors = HOOK_BUNDLE_ROOTS.flatMap((bundle) => {
    const abs = path.join(root, bundle);
    const preToolUseOnly = bundle === CLAUDE_DISTRIBUTION_ROOT;
    return [...evaluateHooksWiring(abs, bundle), ...evaluateHooksSsotMatch(abs, bundle, preToolUseOnly)];
  });
  if (errors.length) return { id: 'V-HOOKWIRE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-HOOKWIRE-01', ok: true };
};

// V-HOOKPAT-01: both shipped bundles carry pattern data that parses and compiles.
const checkHookPatterns = (): CheckResult => {
  const blocked = buildFailure('V-HOOKPAT-01');
  if (blocked) return blocked;

  const errors = HOOK_BUNDLE_ROOTS.flatMap((bundle) =>
    evaluateHookPatterns(path.join(root, bundle), bundle),
  );
  if (errors.length) return { id: 'V-HOOKPAT-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-HOOKPAT-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkHooksWiring(), checkHookPatterns()];

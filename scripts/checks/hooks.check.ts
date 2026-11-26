import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { CLAUDE_NATIVE_GENERATED_DIRS, COMMITTED_TARGET_TREES } from '../lib/build/paths.ts';
import { runFullBuildOnce } from '../lib/check-common.ts';
import { readJsonFile, walkFilesAbs } from '../lib/fs.ts';

// ADR-065 — no harness build registers a tool-call-denying hook. Claude Code auto mode is the gate;
// the guard validators that ADR-061 and ADR-064 shipped are gone, so a built tree that registers a
// PreToolUse hook, or ships one of the old validator scripts, reintroduces the denial surface the
// owner decision removed. Only SessionStart (the plugin-root export) may stay registered; the one
// data file that still ships under hooks/ is the staging gate's sensitive-filename pattern list.

/** Basenames of the retired guard validators; a tracked copy anywhere in a built tree is a regression. */
export const RETIRED_GUARD_SCRIPTS = ['validate-bash-command.js', 'validate-file-changes.js'];

/** Plugin-bundle file whose `hooks` key registers hook events. `.claude/settings.json` is hand-owned
 * state the build edits in place, so claude-native-settings.check.ts judges it by fingerprint instead. */
const HOOK_REGISTRY_BASENAME = 'hooks.json';

/** Every file the build regenerates under a committed target tree; the claude-native tree is narrowed
 * to its generated dirs, which keeps `.claude/worktrees/` and maintainer state out of the walk. */
const builtTreeFiles = (repoRoot: string): string[] =>
  COMMITTED_TARGET_TREES.flatMap((tree) => (tree.id === 'claude-native' ? CLAUDE_NATIVE_GENERATED_DIRS : tree.paths))
    .map((p) => path.join(repoRoot, p))
    .flatMap((abs) => {
      if (!fs.existsSync(abs)) return [];
      return fs.statSync(abs).isDirectory() ? walkFilesAbs(abs) : [abs];
    });

/** Event names under `hooks` that can return a deny (case-insensitive: Claude `PreToolUse`, Cursor `preToolUse`). */
const registersDenyCapableEvent = (parsed: unknown): boolean => {
  const hooks = (parsed as { hooks?: unknown } | null)?.hooks;
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return false;
  return Object.keys(hooks).some((event) => event.toLowerCase() === 'pretooluse');
};

/** Errors for one repo root: a registered PreToolUse event, or a retired validator script, in any built tree. */
export const evaluateNoBlockingHooks = (repoRoot: string): string[] => {
  const errors: string[] = [];
  for (const file of builtTreeFiles(repoRoot)) {
    const rel = path.relative(repoRoot, file);
    const base = path.basename(file);
    if (RETIRED_GUARD_SCRIPTS.includes(base)) {
      errors.push(`${rel}: retired guard validator is still shipped (ADR-065)`);
    }
    if (base !== HOOK_REGISTRY_BASENAME) continue;
    try {
      if (registersDenyCapableEvent(readJsonFile(file, file))) {
        errors.push(`${rel}: registers a PreToolUse hook (ADR-065 removed every blocking guard)`);
      }
    } catch (err) {
      errors.push(`${rel}: invalid JSON (${(err as Error).message})`);
    }
  }
  return errors;
};

/** Sensitive-filename pattern data (V-SEC-11) in every shipped `hooks/patterns/`: parseable, versioned,
 * and every entry a string id, reason and pattern that compiles. A pattern that fails to compile makes
 * the staging gate throw before any `git add`, so a malformed file must not reach a consumer. */
export const evaluateSensitiveFilePatterns = (repoRoot: string): string[] => {
  const errors: string[] = [];
  for (const file of builtTreeFiles(repoRoot).filter((f) => f.endsWith(path.join('hooks', 'patterns', 'file-patterns.json')))) {
    const rel = path.relative(repoRoot, file);
    try {
      const parsed = readJsonFile(file, file) as { version?: unknown; sensitiveFiles?: unknown };
      if (parsed.version !== 1) errors.push(`${rel}: unsupported schema version ${String(parsed.version)}`);
      if (!Array.isArray(parsed.sensitiveFiles) || parsed.sensitiveFiles.length === 0) {
        errors.push(`${rel}: missing non-empty "sensitiveFiles" array`);
        continue;
      }
      for (const entry of parsed.sensitiveFiles as { id?: unknown; pattern?: unknown; flags?: unknown; reason?: unknown }[]) {
        if (typeof entry.id !== 'string' || typeof entry.reason !== 'string' || typeof entry.pattern !== 'string') {
          errors.push(`${rel}: entry missing string id, reason or pattern`);
          continue;
        }
        try {
          new RegExp(entry.pattern, typeof entry.flags === 'string' ? entry.flags : '');
        } catch (err) {
          errors.push(`${rel}: entry "${entry.id}" does not compile (${(err as Error).message})`);
        }
      }
    } catch (err) {
      errors.push(`${rel}: invalid JSON (${(err as Error).message})`);
    }
  }
  return errors;
};

const buildFailure = (id: string): CheckResult | null => {
  if (process.env.VERIFY_SKIP_BUILD === '1') return null;
  const build = runFullBuildOnce();
  return build.ok ? null : { id, ok: false, detail: `build failed: ${build.output}` };
};

// V-NOGUARD-01: no built tree registers a deny-capable hook or ships a retired validator.
const checkNoBlockingHooks = (): CheckResult => {
  const blocked = buildFailure('V-NOGUARD-01');
  if (blocked) return blocked;
  const errors = evaluateNoBlockingHooks(root);
  if (errors.length) return { id: 'V-NOGUARD-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-NOGUARD-01', ok: true };
};

// V-HOOKPAT-01: the shipped sensitive-filename pattern data parses and compiles.
const checkSensitiveFilePatterns = (): CheckResult => {
  const blocked = buildFailure('V-HOOKPAT-01');
  if (blocked) return blocked;
  const errors = evaluateSensitiveFilePatterns(root);
  if (errors.length) return { id: 'V-HOOKPAT-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-HOOKPAT-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkNoBlockingHooks(), checkSensitiveFilePatterns()];

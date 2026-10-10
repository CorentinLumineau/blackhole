import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile, walkFilesAbs } from '../fs.ts';
import { root, srcDir, CLAUDE_DISTRIBUTION_AGENT_DIR } from './paths.ts';

// The Claude Code marketplace bundle must work from wherever Claude Code installs it (the
// version-keyed plugin cache), not only from a blackhole checkout. Three things make that true:
// the scripts agents invoke ship inside the bundle, every invocation names the plugin root, and a
// SessionStart hook exports that root to Bash. `finalizeClaudePluginBundle` applies all three.

/** Shell expression a compiled invocation uses for the bundle root. Falls back to the working
 * directory, which is the self-hosting layout (blackhole's own checkout). */
export const PLUGIN_ROOT_SHELL_EXPR = '"${BLACKHOLE_PLUGIN_ROOT:-.}"';

/** SessionStart command that exports the plugin root for every later Bash call. A no-op when
 * the env file or plugin root is unavailable, or when the user already pinned the variable. */
export const SESSION_START_EXPORT_COMMAND =
  '[ -n "$CLAUDE_ENV_FILE" ] && [ -n "$CLAUDE_PLUGIN_ROOT" ] && [ -z "$BLACKHOLE_PLUGIN_ROOT" ] && ' +
  'printf \'export BLACKHOLE_PLUGIN_ROOT=%q\\n\' "$CLAUDE_PLUGIN_ROOT" >> "$CLAUDE_ENV_FILE"; exit 0';

/** Added to the bundle's SKILL.md: Claude Code expands the placeholder in skill and agent bodies,
 * but not inside reference files an agent opens with Read, so the agent has to resolve it. */
export const PLUGIN_ROOT_NOTE =
  '\nPaths that start with `${CLAUDE_PLUGIN_ROOT}` mean this plugin\'s install directory, the one ' +
  'the runbook path above resolves to. Shell commands reach it as `$BLACKHOLE_PLUGIN_ROOT`, which ' +
  'the plugin\'s SessionStart hook exports.\n';

// `bun scripts/x.ts` or `bun run scripts/x.ts`. A `--cwd <dir>` form already names its root
// (blackhole-state.md § Write protocol) and is left alone.
const INVOCATION_RE = /\bbun(\s+run)?\s+scripts\/([\w./-]+\.ts)/g;
const RELATIVE_IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

/** Repo-relative script paths that compiled prose tells an agent to run with bun. */
export const listRuntimeScriptEntrypoints = (sourceRoot: string = srcDir): string[] => {
  const found = new Set<string>();
  for (const file of walkFilesAbs(sourceRoot)) {
    if (!file.endsWith('.md')) continue;
    for (const match of fs.readFileSync(file, 'utf-8').matchAll(INVOCATION_RE)) {
      found.add(`scripts/${match[2]}`);
    }
  }
  return [...found].sort();
};

const resolveImport = (fromFile: string, spec: string): string | null => {
  const base = path.join(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
};

/** Entry points plus every file they reach through relative imports, repo-relative and sorted.
 * Throws on an entry point that does not exist, so a typo'd invocation fails the build. */
export const runtimeScriptClosure = (entrypoints: string[], repoRoot: string = root): string[] => {
  const seen = new Set<string>();
  const queue = entrypoints.map((rel) => {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) throw new Error(`runtime script ${rel} is invoked in src/ but does not exist`);
    return abs;
  });
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of fs.readFileSync(file, 'utf-8').matchAll(RELATIVE_IMPORT_RE)) {
      const target = resolveImport(file, match[1]);
      if (target) queue.push(target);
    }
  }
  return [...seen].map((abs) => path.relative(repoRoot, abs).split(path.sep).join('/')).sort();
};

/** Points every plain `bun [run] scripts/…` invocation at the plugin root. */
export const rewriteScriptInvocations = (content: string): string =>
  content.replace(INVOCATION_RE, (_m, run: string | undefined, rel: string) =>
    `bun${run ?? ''} ${PLUGIN_ROOT_SHELL_EXPR}/scripts/${rel}`);

/** Adds the SessionStart export hook to a parsed hooks.json, once. */
export const withSessionStartExport = (hooksJson: { hooks?: Record<string, unknown[]> }) => {
  const hooks = { ...(hooksJson.hooks ?? {}) };
  const entry = { hooks: [{ type: 'command', command: SESSION_START_EXPORT_COMMAND, timeout: 5 }] };
  const existing = (hooks.SessionStart ?? []) as unknown[];
  const already = JSON.stringify(existing).includes('BLACKHOLE_PLUGIN_ROOT');
  hooks.SessionStart = already ? existing : [...existing, entry];
  return { ...hooksJson, hooks };
};

/** Ships the runtime scripts, rewrites invocations in every compiled markdown file, and wires
 * the SessionStart export into the bundle's hooks.json. */
export const finalizeClaudePluginBundle = (destRoot: string, repoRoot: string = root): void => {
  for (const rel of runtimeScriptClosure(listRuntimeScriptEntrypoints(path.join(repoRoot, 'src')), repoRoot)) {
    const dest = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), dest);
  }
  for (const file of walkFilesAbs(destRoot)) {
    if (!file.endsWith('.md')) continue;
    const before = fs.readFileSync(file, 'utf-8');
    const after = rewriteScriptInvocations(before);
    if (after !== before) fs.writeFileSync(file, after, 'utf-8');
  }
  const skillPath = path.join(destRoot, 'skills', 'blackhole', 'SKILL.md');
  const skill = fs.readFileSync(skillPath, 'utf-8');
  if (!skill.includes(PLUGIN_ROOT_NOTE)) {
    // Right after the opening paragraph, which names the runbook path the note refers to.
    fs.writeFileSync(skillPath, skill.replace(/(runbook: `[^`]+`\.\n)/, `$1${PLUGIN_ROOT_NOTE}`), 'utf-8');
  }
  const hooksPath = path.join(destRoot, 'hooks', 'hooks.json');
  if (fs.existsSync(hooksPath)) {
    const parsed = readJsonFile(hooksPath, hooksPath) as { hooks?: Record<string, unknown[]> };
    fs.writeFileSync(hooksPath, `${JSON.stringify(withSessionStartExport(parsed), null, 2)}\n`, 'utf-8');
  }
};

/** Shape errors for a finalized bundle: missing runtime scripts, a compiled markdown file that
 * still cites the repo-relative bundle path, or no SessionStart export. */
export const claudePluginRuntimeErrors = (destRoot: string, repoRoot: string = root): string[] => {
  const errors: string[] = [];
  for (const rel of listRuntimeScriptEntrypoints(path.join(repoRoot, 'src'))) {
    if (!fs.existsSync(path.join(destRoot, rel))) errors.push(`Claude bundle: missing runtime script ${rel}`);
  }
  // A citation into the bundle's own content tree; prose that merely names the build output
  // directory (hook-schemas.md's install notes) is fine.
  const repoRelative = `${CLAUDE_DISTRIBUTION_AGENT_DIR}/`;
  const citation = new RegExp(`${repoRelative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:agents|rules|skills)/`);
  for (const file of walkFilesAbs(destRoot)) {
    if (!file.endsWith('.md')) continue;
    if (citation.test(fs.readFileSync(file, 'utf-8'))) {
      errors.push(`Claude bundle: ${path.relative(destRoot, file)} cites repo-relative ${repoRelative}`);
    }
  }
  const hooksPath = path.join(destRoot, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksPath) || !fs.readFileSync(hooksPath, 'utf-8').includes('BLACKHOLE_PLUGIN_ROOT')) {
    errors.push('Claude bundle: hooks/hooks.json has no SessionStart BLACKHOLE_PLUGIN_ROOT export');
  }
  return errors;
};

import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile, walkFilesAbs } from '../fs.ts';
import { root, srcDir, CLAUDE_DISTRIBUTION_AGENT_DIR } from './paths.ts';

// The Claude Code marketplace bundle must work from wherever Claude Code installs it (the
// version-keyed plugin cache), not only from a blackhole checkout. Three things make that true:
// the scripts agents invoke ship inside the bundle, every invocation names the plugin root, and a
// SessionStart hook exports that root to Bash. `finalizeClaudePluginBundle` applies all three.

/** Shell expression a compiled invocation uses for the bundle root, resolved in order: the
 * `BLACKHOLE_PLUGIN_ROOT` the SessionStart hook exports, then `CLAUDE_PLUGIN_ROOT`, then a loud
 * `:?` failure. It never falls back to the working directory: in a consumer repo that runs a
 * same-named consumer script or fails with module-not-found, and in a blackhole worktree it runs
 * that worktree's unreleased scripts. An empty value counts as unset. Strict POSIX, so sh, dash and
 * bash agree. */
export const PLUGIN_ROOT_UNSET_MESSAGE = 'blackhole plugin root unset, see blackhole#1269';
export const PLUGIN_ROOT_SHELL_EXPR = `"\${BLACKHOLE_PLUGIN_ROOT:-\${CLAUDE_PLUGIN_ROOT:?${PLUGIN_ROOT_UNSET_MESSAGE}}}"`;

/** SessionStart command that exports the plugin root for every later Bash call. Claude Code runs
 * shell-form hooks through `sh -c`, which is dash on many Linux hosts, so this must stay strict
 * POSIX: the bash-only quoting directive of printf aborts after the prefix, leaving an empty export
 * that `exit 0` hides. The value is single-quoted with the `'\''` escape so spaces, quotes, `$` and
 * backticks stay inert when bash sources the env file, and the leading newline terminates any
 * newline-less prefix an older version left behind. Silent when the user already pinned the
 * variable; warns on stderr when it cannot export; always exits 0 so it never blocks a session. */
export const SESSION_START_EXPORT_COMMAND =
  '[ -z "$BLACKHOLE_PLUGIN_ROOT" ] || exit 0; ' +
  'r=; if [ -n "$CLAUDE_ENV_FILE" ] && [ -n "$CLAUDE_PLUGIN_ROOT" ]; then ' +
  'r=$(printf %s "$CLAUDE_PLUGIN_ROOT" | sed "s/\'/\'\\\\\\\\\'\'/g"); fi; ' +
  'if [ -n "$r" ]; then printf "\\nexport BLACKHOLE_PLUGIN_ROOT=\'%s\'\\n" "$r" >> "$CLAUDE_ENV_FILE"; ' +
  'else echo "blackhole: cannot export BLACKHOLE_PLUGIN_ROOT (CLAUDE_ENV_FILE or CLAUDE_PLUGIN_ROOT unset); scripts will not resolve" >&2; fi; ' +
  'exit 0';

/** Added to the bundle's SKILL.md: Claude Code expands the placeholder in skill and agent bodies,
 * but not inside reference files an agent opens with Read, so the agent has to resolve it. */
export const PLUGIN_ROOT_NOTE =
  '\nPaths that start with `${CLAUDE_PLUGIN_ROOT}` mean this plugin\'s install directory, the one ' +
  'the runbook path above resolves to. Shell commands reach it as `$BLACKHOLE_PLUGIN_ROOT`, which ' +
  'the plugin\'s SessionStart hook exports.\n';

// `bun scripts/x.ts`, `bun run scripts/x.ts`, or `bun run --cwd <dir> scripts/x.ts`. The `--cwd`
// pin names the tree the script operates on (cwd-pin-guard.check.ts) and is kept as written; only
// the script path moves to the plugin root, which never falls back to the pinned tree. `<dir>` takes the same shapes cwd-pin-guard.check.ts accepts.
const INVOCATION_RE = /\bbun(\s+run(?:\s+--cwd\s+(?:<[^>]*>|`[^`]*`|"[^"]*"|\S+))?)?\s+scripts\/([\w./-]+\.ts)/g;
// `bash scripts/x.sh`: the shell-script form of the same invocation. Only this exact form counts, so
// a bare citation of a script and a consumer-owned `./scripts/setup.sh` are never shipped or rewritten.
const SHELL_INVOCATION_RE = /\bbash(\s+)scripts\/([\w./-]+\.sh)\b/g;
const RELATIVE_IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

/** Repo-relative script paths that compiled prose tells an agent to run with bun or bash. */
export const listRuntimeScriptEntrypoints = (sourceRoot: string = srcDir): string[] => {
  const found = new Set<string>();
  for (const file of walkFilesAbs(sourceRoot)) {
    if (!file.endsWith('.md')) continue;
    const text = fs.readFileSync(file, 'utf-8');
    for (const match of [...text.matchAll(INVOCATION_RE), ...text.matchAll(SHELL_INVOCATION_RE)]) {
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
    if (!file.endsWith('.ts')) continue;
    for (const match of fs.readFileSync(file, 'utf-8').matchAll(RELATIVE_IMPORT_RE)) {
      const target = resolveImport(file, match[1]);
      if (target) queue.push(target);
    }
  }
  return [...seen].map((abs) => path.relative(repoRoot, abs).split(path.sep).join('/')).sort();
};

/** Points every `bun [run [--cwd <dir>]] scripts/…` and `bash scripts/….sh` invocation at the plugin root. */
export const rewriteScriptInvocations = (content: string): string =>
  content
    .replace(INVOCATION_RE, (_m, run: string | undefined, rel: string) =>
      `bun${run ?? ''} ${PLUGIN_ROOT_SHELL_EXPR}/scripts/${rel}`)
    .replace(SHELL_INVOCATION_RE, (_m, _ws: string, rel: string) => `bash ${PLUGIN_ROOT_SHELL_EXPR}/scripts/${rel}`);

/** Compiled markdown lines that still run a repo-relative `scripts/…` path after the rewrite,
 * which a plugin-only install cannot resolve. */
export const unrewrittenInvocationErrors = (destRoot: string): string[] => {
  const errors: string[] = [];
  for (const file of walkFilesAbs(destRoot)) {
    if (!file.endsWith('.md')) continue;
    fs.readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
      for (const match of [...line.matchAll(INVOCATION_RE), ...line.matchAll(SHELL_INVOCATION_RE)]) {
        errors.push(`Claude bundle: ${path.relative(destRoot, file)}:${i + 1} runs repo-relative scripts/${match[2]}`);
      }
    });
  }
  return errors;
};

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
 * still cites the repo-relative bundle path or runs a repo-relative script, or no SessionStart
 * export. */
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
  errors.push(...unrewrittenInvocationErrors(destRoot));
  const hooksPath = path.join(destRoot, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksPath) || !fs.readFileSync(hooksPath, 'utf-8').includes('BLACKHOLE_PLUGIN_ROOT')) {
    errors.push('Claude bundle: hooks/hooks.json has no SessionStart BLACKHOLE_PLUGIN_ROOT export');
  }
  return errors;
};

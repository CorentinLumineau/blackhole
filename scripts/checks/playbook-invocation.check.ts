import { buildInputModuleDirs, escapeRegExp, listFiles } from '../lib/check-common.ts';
import { read, type CheckResult } from './check-utils.ts';

// V-INVOKE-01 (ADR-056): playbook prose runs bundled scripts by source path
// (`bun run scripts/<file>.ts`), which the Claude bundle build rewrites to the plugin root. A
// `package.json` alias (`bun run status`) only resolves inside a blackhole checkout, so an agent
// running an installed plugin from a consumer repo cannot run it.

// Maintainer-only aliases: they act on a blackhole checkout itself (build, verify, release, test),
// so a playbook naming them is addressed to a maintainer, never to an installed plugin. Every
// other `package.json` script key is flagged, so a new alias is caught without editing this file.
const MAINTAINER_ALIASES = new Set([
  'build',
  'build:codex',
  'verify',
  'verify:codex',
  'release',
  'install:verify',
  'sync:shadcn',
  'test',
]);

export const flaggedAliases = (scripts: Record<string, string>): string[] =>
  Object.keys(scripts)
    .filter((name) => !MAINTAINER_ALIASES.has(name))
    .sort();

// Runner forms an agent could type: `bun run [--cwd <x>] <alias>`, `bun <alias>`, `npm run <alias>`.
// The trailing lookahead keeps `status-page` or `verify:codex` from matching a shorter alias.
const aliasRegex = (aliases: string[]): RegExp =>
  new RegExp(
    String.raw`\b(?:bun(?:\s+run(?:\s+--cwd\s+(?:<[^>]*>|\`[^\`]*\`|"[^"]*"|\S+))?)?|npm\s+run)\s+(?:${aliases
      .map(escapeRegExp)
      .join('|')})(?![\w:./-])`,
  );

export const findAliasInvocations = (content: string, label: string, aliases: string[]): string[] => {
  const regex = aliasRegex(aliases);
  return content.split('\n').flatMap((line, idx) => (regex.test(line) ? [`${label}:${idx + 1}`] : []));
};

// A bundled-script call, optionally after `VAR=value` words or a `cd <dir> &&`.
const SCRIPT_CALL_RE =
  /^\s*(?:(?:[A-Za-z_]\w*=\S*|cd\s+\S+\s*&&)\s+)*bun(?:\s+run(?:\s+--cwd\s+(?:<[^>]*>|`[^`]*`|"[^"]*"|\S+))?)?\s+scripts\/[\w./-]+\.ts\b/;

// Index of the `)` closing the `$(` at `open`, or -1 when the line ends first.
const closingParen = (line: string, open: number): number => {
  let depth = 0;
  for (let i = open + 1; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')' && --depth === 0) return i;
  }
  return -1;
};

// `export`/`local`/`readonly`/`declare`/`typeset` return their own status, not the substitution's.
const STATUS_MASKING_BUILTINS = new Set(['export', 'local', 'readonly', 'declare', 'typeset']);
// Only a guard that leaves the script stops it: `|| exit|return`, or a `|| { … exit|return … }` group.
const STOPPING_GUARD_RE = /^\s*\|\|\s*(?:(?:exit|return)\b|\{[^}]*\b(?:exit|return)\b)/;

const isPlainAssignment = (prefix: string): boolean => {
  const m = /(?:^|[\s;`(])([A-Za-z_]\w*=)$/.exec(prefix);
  if (!m) return false;
  const previous = prefix.slice(0, prefix.length - m[1].length).trimEnd().split(/[\s;`(]/).pop() ?? '';
  return !STATUS_MASKING_BUILTINS.has(previous) && !previous.startsWith('-');
};

const isGuardedAssignment = (line: string, open: number, body: string, close: number): boolean =>
  isPlainAssignment(line.slice(0, open)) &&
  !body.includes('|') &&
  !body.includes('$(') &&
  close !== -1 &&
  STOPPING_GUARD_RE.test(line.slice(close + 1));

// A bundled-script call inside `$(…)` that feeds another command's arguments hides its failure:
// a non-zero exit (e.g. an unresolved plugin root) only ends the subshell, and the outer command
// still runs with those arguments missing. The one safe shape is a plain hoisted assignment whose
// status stops the script: `name=$(bun scripts/x.ts …) || exit 1`, its value then used as `$name`.
export const findUnguardedSubstitutions = (content: string, label: string): string[] =>
  content.split('\n').flatMap((line, idx) => {
    for (let open = line.indexOf('$('); open !== -1; open = line.indexOf('$(', open + 2)) {
      const close = closingParen(line, open);
      const body = line.slice(open + 2, close === -1 ? undefined : close);
      if (SCRIPT_CALL_RE.test(body) && !isGuardedAssignment(line, open, body, close)) return [`${label}:${idx + 1}`];
    }
    return [];
  });

// Same sweep scope as cwd-pin-guard.check.ts: the agent and reference prose an installed plugin
// ships, plus every build-input module directory (ADR-034) and the root skill file. `hunt/` is
// added because its modules ship and are fetched at runtime (ADR-034), so they run scripts too.
const SWEEP_DIRS = ['src/agents', 'src/references', 'src/references/hunt'];
const SWEEP_FILES = ['src/SKILL.md'];

const packageScripts = (): Record<string, string> =>
  (JSON.parse(read('package.json')) as { scripts?: Record<string, string> }).scripts ?? {};

export const checkPlaybookInvocation = (
  scripts: Record<string, string> = packageScripts(),
  sweepDirs: string[] = [...SWEEP_DIRS, ...buildInputModuleDirs()],
): CheckResult => {
  const aliases = flaggedAliases(scripts);
  if (!aliases.length) {
    return { id: 'V-INVOKE-01', ok: false, detail: 'no package.json script alias left to guard (scripts missing or all exempt)' };
  }
  // A renamed or emptied sweep dir would otherwise pass while sweeping nothing.
  const emptyDir = sweepDirs.find((dir) => listFiles(dir).length === 0);
  if (emptyDir) return { id: 'V-INVOKE-01', ok: false, detail: `sweep dir ${emptyDir} is missing or has no .md files` };
  const targets = [...sweepDirs.flatMap((dir) => listFiles(dir).map((file) => `${dir}/${file}`)), ...SWEEP_FILES];
  const violations = targets.flatMap((target) => {
    const content = read(target);
    return [
      ...findAliasInvocations(content, target, aliases),
      ...findUnguardedSubstitutions(content, target).map((site) => `${site} (unguarded $(bun scripts/…))`),
    ];
  });
  if (violations.length) return { id: 'V-INVOKE-01', ok: false, detail: violations.join('; ') };
  return { id: 'V-INVOKE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkPlaybookInvocation()];

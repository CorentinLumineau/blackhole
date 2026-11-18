import { buildInputModuleDirs, listFiles } from '../lib/check-common.ts';
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Runner forms an agent could type: `bun run [--cwd <x>] <alias>`, `bun <alias>`, `npm run <alias>`.
// The trailing lookahead keeps `status-page` or `verify:codex` from matching a shorter alias.
const aliasRegex = (aliases: string[]): RegExp =>
  new RegExp(
    String.raw`\b(?:bun(?:\s+run(?:\s+--cwd\s+(?:<[^>]*>|\`[^\`]*\`|"[^"]*"|\S+))?)?|npm\s+run)\s+(?:${aliases
      .map(escapeRegExp)
      .join('|')})(?![\w:./-])`,
  );

export const findAliasInvocations = (content: string, label: string, aliases: string[]): string[] => {
  if (!aliases.length) return [];
  const regex = aliasRegex(aliases);
  return content.split('\n').flatMap((line, idx) => (regex.test(line) ? [`${label}:${idx + 1}`] : []));
};

// Same sweep scope as cwd-pin-guard.check.ts: the agent and reference prose an installed plugin
// ships, plus every build-input module directory (ADR-034) and the root skill file.
const SWEEP_DIRS = ['src/agents', 'src/references'];
const SWEEP_FILES = ['src/SKILL.md'];

const sweepTargets = (): string[] => [
  ...[...SWEEP_DIRS, ...buildInputModuleDirs()].flatMap((dir) => listFiles(dir).map((file) => `${dir}/${file}`)),
  ...SWEEP_FILES,
];

const checkPlaybookInvocation = (): CheckResult => {
  const scripts = (JSON.parse(read('package.json')) as { scripts?: Record<string, string> }).scripts ?? {};
  const aliases = flaggedAliases(scripts);
  const violations = sweepTargets().flatMap((target) => findAliasInvocations(read(target), target, aliases));
  if (violations.length) return { id: 'V-INVOKE-01', ok: false, detail: violations.join('; ') };
  return { id: 'V-INVOKE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkPlaybookInvocation()];

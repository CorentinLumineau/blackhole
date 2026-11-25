import * as fs from 'fs';
import * as path from 'path';
import { parseFlags } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import type { AuditContext } from './lib/audit-module-triggers.ts';

// Usage: bun run scripts/audit-context.ts --repo-dir <PR worktree> --base-ref <diff base> --head <PR head>
//   --issue-ref <N> --dispatch <full|recheck|verification> [--plan-file <PLAN_ABSOLUTE_PATH>]
//   [--config-file <.blackhole/config.json>] [--queue-file <.blackhole/queue.json>] [--out <file>]
// Builds the audit-context JSON `review-aggregate.ts --audit-context-file` consumes (ADR-034
// amendment, V-AUDIT-01): the facts that decide which on-demand reviewer audit modules a spawn had
// to load. For a recheck dispatch pass the last reviewed head as --base-ref, so changedFiles is
// the fix commits' files.

export const DISPATCH_KINDS = ['full', 'recheck', 'verification'] as const;
export type DispatchKind = (typeof DISPATCH_KINDS)[number];

export type AuditContextInput = {
  repoDir: string;
  baseRef: string;
  head: string;
  dispatch: DispatchKind;
  issueRef?: string;
  planFile?: string;
  configFile?: string;
  queueFile?: string;
};

const PRODUCT_PRINCIPLES = 'documentation/reference/product-principles.md';
const FRONTEND_SCRIPT = path.join(import.meta.dirname, 'detect-frontend.sh');
// The extension set `detect-frontend.sh` step 2 uses to recognise UI files; the script stays the
// SSOT for whether the *project* is a frontend, this narrows it to whether the *diff* touches one.
const UI_FILE = /\.(tsx|jsx|vue|svelte)$/;

const run = (cmd: string[], cwd: string): string => {
  const r = Bun.spawnSync({ cmd, cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed in ${cwd}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
};

type QueueEntry = { size?: string; route?: Record<string, unknown> };

const routeFor = (queue: { issues?: Record<string, QueueEntry> } | undefined, issueRef: string | undefined): AuditContext['route'] => {
  const entry = issueRef ? queue?.issues?.[issueRef] : undefined;
  if (!entry) return undefined;
  const size = typeof entry.size === 'string' ? (entry.size.startsWith('size:') ? entry.size : `size:${entry.size}`) : undefined;
  return { ...(entry.route as AuditContext['route']), ...(size ? { size } : {}) };
};

export const buildAuditContext = (input: AuditContextInput): AuditContext => {
  const changedFiles = run(['git', 'diff', '--name-only', `${input.baseRef}...${input.head}`], input.repoDir)
    .split('\n')
    .filter(Boolean);
  const queue = input.queueFile ? (readJsonFile(input.queueFile, 'queue file') as { pipeline_detection?: { actionman_workclaude?: boolean }; issues?: Record<string, QueueEntry> }) : undefined;
  const projectIsFrontend = run(['bash', FRONTEND_SCRIPT], input.repoDir).trim() === 'frontend=yes';
  return {
    changedFiles,
    ...(input.planFile && fs.existsSync(input.planFile) ? { planText: fs.readFileSync(input.planFile, 'utf-8') } : {}),
    ...(input.configFile ? { config: readJsonFile(input.configFile, 'config file') as AuditContext['config'] } : {}),
    route: routeFor(queue, input.issueRef),
    ...(queue ? { queue: { pipeline_detection: queue.pipeline_detection } } : {}),
    dispatch: { recheck: input.dispatch === 'recheck', independentVerification: input.dispatch === 'verification' },
    productPrinciplesExists: fs.existsSync(path.join(input.repoDir, PRODUCT_PRINCIPLES)),
    frontendDiff: projectIsFrontend && changedFiles.some((f) => UI_FILE.test(f)),
  };
};

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2));
  const str = (k: string): string | undefined => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
  const dispatch = str('dispatch') as DispatchKind | undefined;
  const repoDir = str('repo-dir');
  const baseRef = str('base-ref');
  const head = str('head');
  if (!repoDir || !baseRef || !head || !dispatch || !DISPATCH_KINDS.includes(dispatch)) {
    console.error(
      'Usage: bun run scripts/audit-context.ts --repo-dir <PR worktree> --base-ref <diff base> --head <PR head> --dispatch <full|recheck|verification> [--issue-ref <N>] [--plan-file <path>] [--config-file <path>] [--queue-file <path>] [--out <file>]',
    );
    process.exit(1);
  }
  try {
    const ctx = buildAuditContext({ repoDir, baseRef, head, dispatch, issueRef: str('issue-ref'), planFile: str('plan-file'), configFile: str('config-file'), queueFile: str('queue-file') });
    const out = str('out');
    if (out) fs.writeFileSync(out, JSON.stringify(ctx));
    else console.log(JSON.stringify(ctx));
  } catch (e) {
    console.error(`audit-context: ${(e as Error).message}`);
    process.exit(1);
  }
}

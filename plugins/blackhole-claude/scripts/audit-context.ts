import * as fs from 'fs';
import * as path from 'path';
import { parseFlags } from './lib/argv-flags.ts';
import { isFrontendPath, loadFrontendPathSet } from './lib/frontend-paths.ts';
import type { AuditContext } from './lib/audit-module-triggers.ts';

// Usage: bun run scripts/audit-context.ts --repo-dir <PR worktree> --base-ref <diff base> --head <PR head>
//   --issue-ref <N> --dispatch <full|recheck> (--plan-file <PLAN_ABSOLUTE_PATH> | --no-plan-reason <why>)
//   --config-file <.blackhole/config.json> --queue-file <.blackhole/queue.json> [--out <file>]
// Builds the audit-context JSON `review-aggregate.ts --audit-context-file` consumes (ADR-034
// amendment, V-AUDIT-01): the facts that decide which on-demand reviewer audit modules a spawn had
// to load. Every input is required and a missing or unreadable one is a named error, never a
// silently dropped fact: a context built from less than the full facts would let a module whose
// trigger holds go unchecked. The one declared absence is the plan (`--no-plan-reason`, for a
// no-plan track). For a recheck dispatch pass the last reviewed head as --base-ref, so changedFiles
// is the fix commits' files.

export const DISPATCH_KINDS = ['full', 'recheck'] as const;
export type DispatchKind = (typeof DISPATCH_KINDS)[number];

export type AuditContextInput = {
  repoDir: string;
  baseRef: string;
  head: string;
  dispatch: DispatchKind;
  issueRef: string;
  /** Exactly one of `planFile` / `noPlanReason`. */
  planFile?: string;
  noPlanReason?: string;
  configFile: string;
  queueFile: string;
};

const PRODUCT_PRINCIPLES = 'documentation/reference/product-principles.md';
const FRONTEND_SCRIPT = path.join(import.meta.dirname, 'detect-frontend.sh');

const run = (cmd: string[], cwd: string): string => {
  const r = Bun.spawnSync({ cmd, cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed in ${cwd}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
};

type QueueEntry = { size?: string; route?: Record<string, unknown> };
type Queue = { pipeline_detection?: { actionman_workclaude?: boolean }; issues?: Record<string, QueueEntry> };

const readInput = (file: string, label: string): string => {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch (e) {
    throw new Error(`${label} ${file} is missing or unreadable: ${(e as Error).message}`);
  }
};

const readJsonInput = (file: string, label: string): unknown => {
  const raw = readInput(file, label);
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${label} ${file} is not valid JSON: ${(e as Error).message}`);
  }
};

const routeFor = (queue: Queue, issueRef: string, queueFile: string): NonNullable<AuditContext['route']> => {
  const entry = queue.issues?.[issueRef];
  if (!entry) throw new Error(`issue ${issueRef} is absent from queue file ${queueFile}; cannot resolve its route`);
  const size = typeof entry.size === 'string' ? (entry.size.startsWith('size:') ? entry.size : `size:${entry.size}`) : undefined;
  return { ...(entry.route as AuditContext['route']), ...(size ? { size } : {}) };
};

export const buildAuditContext = (input: AuditContextInput): AuditContext => {
  if (!input.issueRef) throw new Error('issue-ref is required');
  if (!!input.planFile === !!input.noPlanReason) throw new Error('pass exactly one of plan-file or no-plan-reason (a declared absence needs its reason)');
  const planText = input.planFile ? readInput(input.planFile, 'plan file') : undefined;
  const config = readJsonInput(input.configFile, 'config file') as AuditContext['config'];
  const queue = readJsonInput(input.queueFile, 'queue file') as Queue;
  const route = routeFor(queue, input.issueRef, input.queueFile);
  const changedFiles = run(['git', 'diff', '--name-only', `${input.baseRef}...${input.head}`], input.repoDir)
    .split('\n')
    .filter(Boolean);
  const projectIsFrontend = run(['bash', FRONTEND_SCRIPT], input.repoDir).trim() === 'frontend=yes';
  const frontendPaths = loadFrontendPathSet();
  return {
    changedFiles,
    ...(planText !== undefined ? { planText } : {}),
    config,
    route,
    queue: { pipeline_detection: queue.pipeline_detection },
    dispatch: { recheck: input.dispatch === 'recheck' },
    productPrinciplesExists: fs.existsSync(path.join(input.repoDir, PRODUCT_PRINCIPLES)),
    frontendDiff: projectIsFrontend && changedFiles.some((f) => isFrontendPath(f, frontendPaths)),
  };
};

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2));
  const str = (k: string): string | undefined => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
  const dispatch = str('dispatch') as DispatchKind | undefined;
  const repoDir = str('repo-dir');
  const baseRef = str('base-ref');
  const head = str('head');
  const issueRef = str('issue-ref');
  const configFile = str('config-file');
  const queueFile = str('queue-file');
  const planFile = str('plan-file');
  const noPlanReason = str('no-plan-reason');
  const missing = [
    ['--repo-dir', repoDir],
    ['--base-ref', baseRef],
    ['--head', head],
    ['--issue-ref', issueRef],
    ['--config-file', configFile],
    ['--queue-file', queueFile],
    ['--dispatch <full|recheck>', dispatch && DISPATCH_KINDS.includes(dispatch) ? dispatch : undefined],
    ['--plan-file or --no-plan-reason', planFile ?? noPlanReason],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0 || !repoDir || !baseRef || !head || !dispatch || !issueRef || !configFile || !queueFile) {
    console.error(`audit-context: missing required input(s): ${missing.join(', ')}`);
    console.error('Usage: bun run scripts/audit-context.ts --repo-dir <PR worktree> --base-ref <diff base> --head <PR head> --issue-ref <N> --dispatch <full|recheck> (--plan-file <path> | --no-plan-reason <why>) --config-file <path> --queue-file <path> [--out <file>]');
    process.exit(1);
  }
  try {
    const ctx = buildAuditContext({ repoDir, baseRef, head, dispatch, issueRef, planFile, noPlanReason, configFile, queueFile });
    const out = str('out');
    if (out) fs.writeFileSync(out, JSON.stringify(ctx));
    else console.log(JSON.stringify(ctx));
  } catch (e) {
    console.error(`audit-context: ${(e as Error).message}`);
    process.exit(1);
  }
}

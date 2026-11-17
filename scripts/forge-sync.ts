import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readScope } from './forge-scope.ts';
import { createForgeAdapter } from './lib/forge-adapter/index.ts';
import type { ForgeAdapter, ForgeIssue } from './lib/forge-adapter/types.ts';
import { isForgeType, resolveForgeForRepo } from './lib/forge-detection.ts';
import { readJsonFile } from './lib/fs.ts';
import { MERGED_PR_LIMIT } from './lib/campaign-status/forge.ts';
import { DONE_STATUSES } from './lib/campaign-status/queue.ts';
import type { QueueJson } from './lib/campaign-status/types.ts';
import { installStateFile } from './lib/state-write-guard.ts';
import { syncQueue, type SyncResult } from './lib/forge-sync.ts';

// Builds or refreshes `.blackhole/queue.json` from the forge (`forge-sync.md` § Queue builder):
// open and closed issues plus open and merged PRs, read through the configured forge's adapter.
// Works from a fresh checkout holding only `config.json`: it also creates an empty findings ledger,
// so `bun run status` can render the page right after. Nothing is written when a forge read fails.

const USAGE = 'Usage: bun run forge-sync [--campaign-dir <dir>] [--dry-run]';
const ISSUE_LIMIT = 1000;

type Config = { repo?: string; forge?: string; scope_milestone?: string; scope_labels?: string[]; default_touch_paths?: string[]; size_label_prefix?: string };

/** Open issues, plus closed ones only when a live queue entry is missing from the open list. */
async function readIssues(adapter: ForgeAdapter, queue: QueueJson | null): Promise<ForgeIssue[]> {
  const open = (await adapter.issueList({ state: 'open', limit: ISSUE_LIMIT })).filter((i) => i.state === 'OPEN');
  const openNums = new Set(open.map((i) => String(i.number)));
  const live = Object.entries(queue?.issues ?? {}).filter(([n, e]) => !DONE_STATUSES.includes(e.status ?? '') && !openNums.has(n));
  if (live.length === 0) return open;
  const closed = (await adapter.issueList({ state: 'closed', limit: ISSUE_LIMIT })).filter((i) => i.state === 'CLOSED');
  return [...open, ...closed];
}

export function summaryLine(r: SyncResult, scope: ReturnType<typeof readScope>): string {
  const where = scope.milestone ? ` (scope: milestone ${scope.milestone})` : scope.labels?.length ? ` (scope: labels ${scope.labels.join(', ')})` : '';
  const total = Object.keys(r.queue.issues).length;
  const refs = (ns: number[]) => (ns.length ? ` (${ns.map((n) => `#${n}`).join(', ')})` : '');
  return `Forge sync${where}: ${total} in queue, +${r.added.length} new${refs(r.added)}, ${r.closed.length} closed${refs(r.closed)}, ${r.linked.length} PR linked${refs(r.linked)}`;
}

/** Reads the forge and writes `queue.json` (and an empty ledger when none exists). `adapter` replaces the configured forge's, for a test. */
export async function runForgeSync(campaignDir: string, opts: { adapter?: ForgeAdapter; now?: string; dryRun?: boolean } = {}): Promise<SyncResult> {
  const configPath = path.join(campaignDir, 'config.json');
  if (!fs.existsSync(configPath)) throw new Error(`No ${configPath}: forge-sync builds the queue of an existing campaign config.`);
  const config = readJsonFile(configPath, configPath) as Config;
  if (!config.repo && !opts.adapter) throw new Error(`${configPath} has no "repo": the forge cannot be read.`);
  const queuePath = path.join(campaignDir, 'queue.json');
  const queue = fs.existsSync(queuePath) ? (readJsonFile(queuePath, queuePath) as QueueJson) : null;
  const resolved = resolveForgeForRepo(path.dirname(path.resolve(campaignDir)), config.forge);
  const forge = resolved.ok ? resolved.forge : config.forge && isForgeType(config.forge) ? config.forge : 'github';
  const adapter = opts.adapter ?? createForgeAdapter({ repo: config.repo as string, forge });
  const scope = readScope(config);
  const issues = await readIssues(adapter, queue);
  const prs = await adapter.prList({ state: 'all', limit: MERGED_PR_LIMIT });
  const result = syncQueue({ queue, issues, prs, scope, config, now: opts.now ?? new Date().toISOString() });
  if (opts.dryRun) return result;

  const archiveDir = path.join(campaignDir, 'archive');
  const written = installStateFile({ livePath: queuePath, archiveDir, content: `${JSON.stringify(result.queue, null, 2)}\n`, entityKey: 'issues' });
  if (!written.ok) throw new Error(`Refused to write ${queuePath}: ${written.reason}`);
  const ledgerPath = path.join(campaignDir, 'findings-ledger.json');
  if (!fs.existsSync(ledgerPath)) {
    fs.writeFileSync(`${ledgerPath}.tmp`, `${JSON.stringify({ refreshed_at: result.queue.refreshed_at, next_id: 1, findings: [] }, null, 2)}\n`);
    fs.renameSync(`${ledgerPath}.tmp`, ledgerPath);
  }
  return result;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['campaign-dir', 'dry-run']);
  if (unknown.length) {
    console.error(`Unknown flag(s): ${unknown.join(', ')}\n${USAGE}`);
    process.exit(2);
  }
  const dir = typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole';
  const campaignDir = path.resolve(process.cwd(), dir);
  try {
    const result = await runForgeSync(campaignDir, { dryRun: flags['dry-run'] === true });
    if (flags['dry-run'] === true) console.log(JSON.stringify(result.queue, null, 2));
    const config = readJsonFile(path.join(campaignDir, 'config.json'), 'config.json') as Config;
    console.log(summaryLine(result, readScope(config)));
  } catch (error) {
    console.error(`forge-sync: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) await main();

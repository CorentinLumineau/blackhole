import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readScope } from './forge-scope.ts';
import { adapterForCampaign } from './lib/forge-adapter/for-campaign.ts';
import type { ForgeAdapter, ForgeIssue } from './lib/forge-adapter/types.ts';
import { readJsonFile } from './lib/fs.ts';
import { MERGED_PR_LIMIT } from './lib/campaign-status/forge.ts';
import { DONE_STATUSES } from './lib/campaign-status/queue.ts';
import type { QueueJson } from './lib/campaign-status/types.ts';
import { installStateFile } from './lib/state-write-guard.ts';
import { readLaneConfig } from './lib/lane.ts';
import { syncQueue, type SyncResult } from './lib/forge-sync.ts';

// Builds or refreshes `.blackhole/queue.json` from the forge (`forge-sync.md` § Queue builder script):
// open and closed issues plus open and merged PRs, read through the configured forge's adapter.
// Works from a fresh checkout holding only `config.json`: it also creates an empty findings ledger,
// so `bun run status` can render the page right after. Nothing is written when a forge read fails,
// and nothing is read when `auto_sync` is false (the queue is kept offline).
//
// Single writer: the orchestrator is the only writer of `queue.json` (`blackhole-state.md`
// § Single-writer invariant). Run this from the orchestrator's own turn, or when no orchestrator
// runs (bootstrap, a fresh checkout). To keep the window for a lost concurrent write small, the
// queue is read again just before the write and the sync is re-applied to that copy.

const USAGE = 'Usage: bun run forge-sync [--campaign-dir <dir>] [--lane <name>] [--dry-run]';
const ISSUE_LIMIT = 1000;

type Config = { auto_sync?: boolean; repo?: string; forge?: string; scope_milestone?: string; scope_labels?: string[]; default_touch_paths?: string[]; size_label_prefix?: string; catchup?: unknown };

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

export type ForgeSyncOutcome = SyncResult | { skipped: string };

const readQueue = (queuePath: string): { raw: string | null; queue: QueueJson | null } => {
  if (!fs.existsSync(queuePath)) return { raw: null, queue: null };
  return { raw: fs.readFileSync(queuePath, 'utf8'), queue: readJsonFile(queuePath, queuePath) as QueueJson };
};

function install(livePath: string, archiveDir: string, value: unknown, entityKey: string): void {
  const written = installStateFile({ livePath, archiveDir, content: `${JSON.stringify(value, null, 2)}\n`, entityKey });
  if (!written.ok) throw new Error(`Refused to write ${livePath}: ${written.reason}`);
}

/** Reads the forge and writes `queue.json` (and an empty ledger when none exists). `adapter` replaces the configured forge's, for a test. */
export async function runForgeSync(campaignDir: string, opts: { adapter?: ForgeAdapter; now?: string; dryRun?: boolean; lane?: string } = {}): Promise<ForgeSyncOutcome> {
  const configPath = path.join(campaignDir, 'config.json');
  if (!fs.existsSync(configPath)) throw new Error(`No ${configPath}: forge-sync builds the queue of an existing campaign config.`);
  const config = readJsonFile(configPath, configPath) as Config;
  if (config.auto_sync === false) return { skipped: 'auto_sync is false in config.json: the queue is kept offline, the forge was not read' };
  if (!config.repo && !opts.adapter) throw new Error(`${configPath} has no "repo": the forge cannot be read.`);
  const queuePath = path.join(campaignDir, 'queue.json');
  const first = readQueue(queuePath);
  const adapter = opts.adapter ?? adapterForCampaign(campaignDir, { repo: config.repo as string, forge: config.forge });
  const scope = readScope(config);
  const issues = await readIssues(adapter, first.queue);
  const prs = await adapter.prList({ state: 'all', limit: MERGED_PR_LIMIT });
  const now = opts.now ?? new Date().toISOString();
  const laneConfig = readLaneConfig(config);
  const lane = opts.lane ?? laneConfig.lane;
  const sync = (queue: QueueJson | null) => syncQueue({ queue, issues, prs, scope, config, now, lane, claimLeaseHours: laneConfig.leaseHours });
  if (opts.dryRun) return sync(first.queue);

  // Re-read: a write made while the forge was being read is kept, and the sync applies on top of it.
  const latest = readQueue(queuePath);
  const result = sync(latest.raw === first.raw ? first.queue : latest.queue);
  const archiveDir = path.join(campaignDir, 'archive');
  install(queuePath, archiveDir, result.queue, 'issues');
  const ledgerPath = path.join(campaignDir, 'findings-ledger.json');
  if (!fs.existsSync(ledgerPath)) install(ledgerPath, archiveDir, { refreshed_at: now, next_id: 1, findings: [] }, 'findings');
  return result;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['campaign-dir', 'dry-run', 'lane']);
  if (unknown.length) {
    console.error(`Unknown flag(s): ${unknown.join(', ')}\n${USAGE}`);
    process.exit(2);
  }
  const dir = typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole';
  const campaignDir = path.resolve(process.cwd(), dir);
  try {
    const result = await runForgeSync(campaignDir, { dryRun: flags['dry-run'] === true, lane: typeof flags.lane === 'string' ? flags.lane : undefined });
    if ('skipped' in result) return console.log(`Forge sync skipped: ${result.skipped}`);
    if (flags['dry-run'] === true) console.log(JSON.stringify(result.queue, null, 2));
    const config = readJsonFile(path.join(campaignDir, 'config.json'), 'config.json') as Config;
    console.log(summaryLine(result, readScope(config)));
  } catch (error) {
    console.error(`forge-sync: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) await main();

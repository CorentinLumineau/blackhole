import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { adapterForCampaign } from './lib/forge-adapter/for-campaign.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';
import type { QueueJson } from './lib/campaign-status/types.ts';
import { readJsonFile } from './lib/fs.ts';
import { applyScores, DuplicateScoreError, parseScores, scoreRequests, type ApplyOutcome, type ScoreRequest } from './lib/pareto-score.ts';
import { installStateFile } from './lib/state-write-guard.ts';

// Score-on-ingest, mechanical side (`forge-sync.md` § Score on ingest). `detect` prints the ready
// issues with no `Pareto:` line as a JSON request list; the orchestrator scores them (LLM judgement)
// and passes the answer to `apply`, which writes line, rationale and label to the forge and the
// score to `queue.json`. Run both from the orchestrator's turn: it is the single writer of the queue.

const USAGE = [
  'Usage: bun run scripts/pareto-score.ts detect [--campaign-dir <dir>]',
  '       bun run scripts/pareto-score.ts apply --scores-file <json> [--campaign-dir <dir>]',
].join('\n');
const ISSUE_LIMIT = 1000;

type Config = { repo?: string; forge?: string };

function load(campaignDir: string, adapter?: ForgeAdapter): { queue: QueueJson; adapter: ForgeAdapter } {
  const queuePath = path.join(campaignDir, 'queue.json');
  if (!fs.existsSync(queuePath)) throw new Error(`no queue at ${queuePath}: run scripts/forge-sync.ts first`);
  const configPath = path.join(campaignDir, 'config.json');
  const config = (fs.existsSync(configPath) ? readJsonFile(configPath, configPath) : {}) as Config;
  if (!adapter && !config.repo) throw new Error(`${configPath} has no "repo": the forge cannot be read.`);
  return {
    queue: readJsonFile(queuePath, queuePath) as QueueJson,
    adapter: adapter ?? adapterForCampaign(campaignDir, { repo: config.repo as string, forge: config.forge }),
  };
}

export async function runDetect(campaignDir: string, opts: { adapter?: ForgeAdapter } = {}): Promise<ScoreRequest[]> {
  const { queue, adapter } = load(campaignDir, opts.adapter);
  return scoreRequests(queue, await adapter.issueList({ state: 'open', limit: ISSUE_LIMIT }));
}

export async function runApply(campaignDir: string, scoresFile: string, opts: { adapter?: ForgeAdapter } = {}): Promise<ApplyOutcome[]> {
  const scores = parseScores(readJsonFile(scoresFile, scoresFile));
  const { queue, adapter } = load(campaignDir, opts.adapter);
  const issues = await adapter.issueList({ state: 'open', limit: ISSUE_LIMIT });
  const result = await applyScores(adapter, queue, issues, scores);
  const queuePath = path.join(campaignDir, 'queue.json');
  const written = installStateFile({ livePath: queuePath, archiveDir: path.join(campaignDir, 'archive'), content: `${JSON.stringify(result.queue, null, 2)}\n`, entityKey: 'issues' });
  if (!written.ok) throw new Error(`Refused to write ${queuePath}: ${written.reason}`);
  return result.outcomes;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const unknown = unknownFlagKeys(flags, ['campaign-dir', 'scores-file']);
  const scoresFile = flags['scores-file'];
  if (unknown.length || !['detect', 'apply'].includes(command ?? '') || (command === 'apply' && typeof scoresFile !== 'string')) {
    console.error(`${unknown.length ? `Unknown flag(s): ${unknown.join(', ')}\n` : ''}${USAGE}`);
    process.exit(2);
  }
  const dir = path.resolve(process.cwd(), typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole');
  try {
    console.log(JSON.stringify(command === 'detect' ? await runDetect(dir) : await runApply(dir, scoresFile as string), null, 2));
  } catch (error) {
    console.error(`pareto-score: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(error instanceof DuplicateScoreError ? 2 : 1);
  }
}

if (import.meta.main) await main();

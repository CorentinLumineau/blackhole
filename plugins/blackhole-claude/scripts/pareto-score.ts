import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { adapterForCampaign } from './lib/forge-adapter/for-campaign.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';
import type { QueueJson } from './lib/campaign-status/types.ts';
import { readJsonFile } from './lib/fs.ts';
import { applyScores, DEFAULT_MAX_AGE_DAYS, DuplicateScoreError, findParetoLineViolations, ISSUE_LIMIT, parseScores, scoreRequests, type ApplyOutcome, type ParetoViolation, type ScoreRequest } from './lib/pareto-score.ts';
import { installStateFile } from './lib/state-write-guard.ts';

// Score-on-ingest, mechanical side (`forge-sync.md` § Score on ingest). `detect` prints the ready
// issues with no `Pareto:` line as a JSON request list; the orchestrator scores them (LLM judgement)
// and passes the answer to `apply`, which writes line, rationale and label to the forge and the
// score to `queue.json`. Run both from the orchestrator's turn: it is the single writer of the queue.

const USAGE = [
  'Usage: bun run scripts/pareto-score.ts detect [--campaign-dir <dir>] [--max-age-days <n>]',
  '       bun run scripts/pareto-score.ts apply --scores-file <json> [--campaign-dir <dir>] [--max-age-days <n>]',
  '       bun run scripts/pareto-score.ts verify [--campaign-dir <dir>]',
].join('\n');

type Config = { repo?: string; forge?: string; pareto_max_age_days?: number };

function load(campaignDir: string, adapter?: ForgeAdapter): { queue: QueueJson; adapter: ForgeAdapter; maxAgeDays: number } {
  const queuePath = path.join(campaignDir, 'queue.json');
  if (!fs.existsSync(queuePath)) throw new Error(`no queue at ${queuePath}: run scripts/forge-sync.ts first`);
  const configPath = path.join(campaignDir, 'config.json');
  const config = (fs.existsSync(configPath) ? readJsonFile(configPath, configPath) : {}) as Config;
  if (!adapter && !config.repo) throw new Error(`${configPath} has no "repo": the forge cannot be read.`);
  return {
    maxAgeDays: config.pareto_max_age_days ?? DEFAULT_MAX_AGE_DAYS,
    queue: readJsonFile(queuePath, queuePath) as QueueJson,
    adapter: adapter ?? adapterForCampaign(campaignDir, { repo: config.repo as string, forge: config.forge }),
  };
}

type RunOptions = { adapter?: ForgeAdapter; now?: Date; maxAgeDays?: number };

export async function runDetect(campaignDir: string, opts: RunOptions = {}): Promise<ScoreRequest[]> {
  const { queue, adapter, maxAgeDays } = load(campaignDir, opts.adapter);
  return scoreRequests(queue, await adapter.issueList({ state: 'open', limit: ISSUE_LIMIT }), { now: opts.now ?? new Date(), maxAgeDays: opts.maxAgeDays ?? maxAgeDays });
}

/** Open `ready` issues whose `Pareto:` line or bucket label is missing or wrong (V-PARETO-02); empty means the forge agrees with the scale. */
export async function runVerify(campaignDir: string, opts: { adapter?: ForgeAdapter } = {}): Promise<ParetoViolation[]> {
  const { adapter } = load(campaignDir, opts.adapter);
  const ready = (await adapter.issueList({ state: 'open', limit: ISSUE_LIMIT })).filter((i) => i.state === 'OPEN' && i.labels.some((l) => l.name === 'ready'));
  return findParetoLineViolations(ready.map((i) => ({ number: i.number, body: i.body ?? '', labels: i.labels.map((l) => l.name) })));
}

export async function runApply(campaignDir: string, scoresFile: string, opts: RunOptions = {}): Promise<ApplyOutcome[]> {
  const scores = parseScores(readJsonFile(scoresFile, scoresFile));
  const { queue, adapter, maxAgeDays } = load(campaignDir, opts.adapter);
  const issues = await adapter.issueList({ state: 'open', limit: ISSUE_LIMIT });
  const result = await applyScores(adapter, queue, issues, scores, { now: opts.now, rescore: { maxAgeDays: opts.maxAgeDays ?? maxAgeDays } });
  const queuePath = path.join(campaignDir, 'queue.json');
  const written = installStateFile({ livePath: queuePath, archiveDir: path.join(campaignDir, 'archive'), content: `${JSON.stringify(result.queue, null, 2)}\n`, entityKey: 'issues' });
  if (!written.ok) throw new Error(`Refused to write ${queuePath}: ${written.reason}`);
  return result.outcomes;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const unknown = unknownFlagKeys(flags, ['campaign-dir', 'scores-file', 'max-age-days']);
  const scoresFile = flags['scores-file'];
  const maxAgeFlag = flags['max-age-days'];
  const maxAge = typeof maxAgeFlag === 'string' ? Number(maxAgeFlag) : undefined;
  if (maxAgeFlag !== undefined && !(maxAge !== undefined && maxAge >= 0)) unknown.push(`--max-age-days ${String(maxAgeFlag)}`);
  if (unknown.length || !['detect', 'apply', 'verify'].includes(command ?? '') || (command === 'apply' && typeof scoresFile !== 'string')) {
    console.error(`${unknown.length ? `Unknown flag(s): ${unknown.join(', ')}\n` : ''}${USAGE}`);
    process.exit(2);
  }
  const dir = path.resolve(process.cwd(), typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole');
  try {
    if (command === 'verify') {
      const violations = await runVerify(dir);
      console.log(JSON.stringify(violations, null, 2));
      process.exit(violations.length ? 1 : 0);
    }
    console.log(JSON.stringify(command === 'detect' ? await runDetect(dir, { maxAgeDays: maxAge }) : await runApply(dir, scoresFile as string, { maxAgeDays: maxAge }), null, 2));
  } catch (error) {
    console.error(`pareto-score: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(error instanceof DuplicateScoreError ? 2 : 1);
  }
}

if (import.meta.main) await main();

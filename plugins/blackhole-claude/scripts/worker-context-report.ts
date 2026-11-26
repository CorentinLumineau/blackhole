import * as fs from 'fs';
import * as path from 'path';
import { defaultCampaignDir } from './lib/campaign-status/cli.ts';
import { isSameRepoKey } from './lib/campaign-status/queue.ts';
import type { QueueJson } from './lib/campaign-status/types.ts';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { buildWorkerContextReport, collectWorkerRows, WORKER_CONTEXT_FILE, type WorkerContextReport } from './lib/worker-context-report.ts';

// Usage: bun run scripts/worker-context-report.ts --transcripts <dir> [--campaign-dir <dir>] [--since <ISO>] [--record] [--json]
// Measures what each campaign worker spawn cost at runtime, from Claude Code subagent transcripts
// (`<dir>/**/subagents/agent-a<role>-<issue>-<hash>.jsonl`, or the `agentType` of the `.meta.json`
// beside an unnamed one): median first-turn `cache_creation_input_tokens`, spawns per merged PR
// (merged = `queue.json` status), and fix-round respawns split warm/cold at the cache TTL. The
// static counterpart is worker-context-size.ts. `--transcripts` is required: the report never
// walks the home directory on its own. `--since` defaults to the queue's `campaign_started_at`.
// `--record` writes `<campaign-dir>/worker-context.json`, which campaign-status.ts reads.

const USAGE = 'usage: worker-context-report.ts --transcripts <dir> [--campaign-dir <dir>] [--since <ISO>] [--record] [--json]';

export type ReportOptions = { transcripts: string; campaignDir: string; since?: string | null; record?: boolean };

export const runWorkerContextReport = (opts: ReportOptions): WorkerContextReport => {
  const queuePath = path.join(opts.campaignDir, 'queue.json');
  const queue = (fs.existsSync(queuePath) ? readJsonFile(queuePath, queuePath) : null) as QueueJson | null;
  const since = opts.since ?? queue?.campaign_started_at ?? null;
  const sinceMs = since === null ? Number.NEGATIVE_INFINITY : Date.parse(since);
  if (Number.isNaN(sinceMs)) throw new Error(`worker-context-report: --since "${since}" is not an ISO timestamp`);
  const merged = Object.entries(queue?.issues ?? {})
    .filter(([key, issue]) => isSameRepoKey(key) && issue.status === 'merged')
    .map(([key]) => Number(key));
  const report = buildWorkerContextReport(collectWorkerRows(opts.transcripts, sinceMs), merged);
  if (opts.record) {
    const target = path.join(opts.campaignDir, WORKER_CONTEXT_FILE);
    fs.writeFileSync(`${target}.tmp`, `${JSON.stringify({ recorded_at: new Date().toISOString(), ...report }, null, 2)}\n`);
    fs.renameSync(`${target}.tmp`, target);
  }
  return report;
};

export const formatWorkerContextReport = (r: WorkerContextReport): string => {
  const n = (v: number | null): string => (v === null ? 'n/a' : String(Math.round(v)));
  return [
    `Worker context (runtime, ${r.workers} transcripts, ${r.unattributed} without an issue number)`,
    `  median first-turn cache creation   ${n(r.median_first_turn_tokens)} tokens`,
    ...Object.entries(r.roles).map(([role, s]) => `    ${role.padEnd(28)} ${String(s.spawns).padStart(4)} spawns  median ${n(s.median_first_turn_tokens)}`),
    `  spawns per merged PR               ${r.spawns_per_merged_pr === null ? 'n/a' : r.spawns_per_merged_pr.toFixed(2)} (${r.merged_prs} merged issues with workers)`,
    `  fix-round respawns                 ${r.respawns.total} (${r.respawns.warm} cache-warm, ${r.respawns.cold} cold)`,
  ].join('\n');
};

const main = (): void => {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['transcripts', 'campaign-dir', 'since', 'record', 'json']);
  const str = (k: string): string | undefined => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
  if (unknown.length || !str('transcripts')) {
    console.error(`worker-context-report: ${unknown.length ? `unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}` : 'missing --transcripts <dir>'}\n${USAGE}`);
    process.exit(2);
  }
  const report = runWorkerContextReport({
    transcripts: path.resolve(str('transcripts')!),
    campaignDir: path.resolve(str('campaign-dir') ?? defaultCampaignDir()),
    since: str('since'),
    record: flags.record === true,
  });
  console.log(flags.json ? JSON.stringify(report, null, 2) : formatWorkerContextReport(report));
};

if (import.meta.main) main();

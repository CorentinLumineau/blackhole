import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { cleanupDirEntries, makeTempDir } from './lib/fs.ts';
import { formatWorkerContextReport, runWorkerContextReport } from './worker-context-report.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) cleanupDirEntries(d);
});

const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const transcript = (tokens: number, from: string, to: string): string =>
  [from, to].map((t, i) => JSON.stringify({ type: 'assistant', timestamp: t, message: { usage: { cache_creation_input_tokens: i === 0 ? tokens : 5 } } })).join('\n');

const fixture = (): { transcripts: string; campaignDir: string } => {
  const root = makeTempDir('wcr');
  dirs.push(root);
  const sub = path.join(root, 'transcripts', 'proj', 'session', 'subagents');
  write(path.join(sub, 'agent-aimplementer-4-0123456789abcdef.jsonl'), transcript(100_000, '2026-11-25T10:00:00.000Z', '2026-11-25T10:10:00.000Z'));
  write(path.join(sub, 'agent-aimplementer-4-fedcba9876543210.jsonl'), transcript(80_000, '2026-11-25T10:12:00.000Z', '2026-11-25T10:20:00.000Z'));
  write(path.join(sub, 'agent-a87fb169909c83e19.jsonl'), transcript(120_000, '2026-11-25T10:00:00.000Z', '2026-11-25T10:01:00.000Z'));
  write(path.join(sub, 'agent-a87fb169909c83e19.meta.json'), JSON.stringify({ agentType: 'blackhole:reviewer' }));
  write(path.join(root, 'transcripts', 'proj', 'main.jsonl'), transcript(999, '2026-11-25T10:00:00.000Z', '2026-11-25T10:01:00.000Z'));
  write(path.join(root, 'campaign', 'queue.json'), JSON.stringify({ campaign_started_at: '2026-11-25T00:00:00.000Z', issues: { '4': { status: 'merged' }, '5': { status: 'ready' } } }));
  return { transcripts: path.join(root, 'transcripts'), campaignDir: path.join(root, 'campaign') };
};

describe('runWorkerContextReport', () => {
  test('reads only subagent transcripts, takes merged issues from the queue and records the report', () => {
    const f = fixture();
    const report = runWorkerContextReport({ ...f, record: true });
    expect(report.workers).toBe(3);
    expect(report.unattributed).toBe(1);
    expect(report.median_first_turn_tokens).toBe(100_000);
    expect(report.spawns_per_merged_pr).toBe(2);
    expect(report.respawns).toEqual({ total: 1, warm: 1, cold: 0 });
    const recorded = JSON.parse(fs.readFileSync(path.join(f.campaignDir, 'worker-context.json'), 'utf8'));
    expect(recorded).toMatchObject({ workers: 3, spawns_per_merged_pr: 2, respawns: { total: 1 } });
    expect(typeof recorded.recorded_at).toBe('string');
  });

  test('without --record nothing is written, and --since drops older transcripts', () => {
    const f = fixture();
    const report = runWorkerContextReport({ ...f, since: '2026-11-26T00:00:00.000Z' });
    expect(report.workers).toBe(0);
    expect(fs.existsSync(path.join(f.campaignDir, 'worker-context.json'))).toBe(false);
  });

  test('a since that is not a timestamp is refused', () => {
    expect(() => runWorkerContextReport({ ...fixture(), since: 'yesterday' })).toThrow('not an ISO timestamp');
  });
});

describe('formatWorkerContextReport', () => {
  test('prints the median, the ratio and the warm/cold split', () => {
    const text = formatWorkerContextReport(runWorkerContextReport(fixture()));
    expect(text).toContain('median first-turn cache creation   100000 tokens');
    expect(text).toContain('spawns per merged PR               2.00 (1 merged issues with workers)');
    expect(text).toContain('1 (1 cache-warm, 0 cold)');
  });
});

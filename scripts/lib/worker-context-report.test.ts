import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './fs.ts';
import { buildWorkerContextReport, collectWorkerRows, parseWorkerRow, type WorkerMeta, readWorkerContext, roleAndIssue, WORKER_CONTEXT_FILE, WARM_TTL_MS, type WorkerRow } from './worker-context-report.ts';

const line = (o: Record<string, unknown>) => JSON.stringify(o);
const transcript = (firstTurn: number, from: string, to: string): string =>
  [
    line({ type: 'user', timestamp: from, message: { role: 'user', content: 'brief' } }),
    line({ type: 'assistant', timestamp: from, message: { usage: { cache_creation_input_tokens: firstTurn } } }),
    line({ type: 'assistant', timestamp: to, message: { usage: { cache_creation_input_tokens: 10 } } }),
  ].join('\n');

const meta = (m: Partial<WorkerMeta> = {}): WorkerMeta => ({ agentType: null, name: null, description: null, ...m });

const row = (role: string, issue: number | null, first: number, start: number, end: number): WorkerRow => ({
  role,
  issue,
  first_turn_tokens: first,
  started_ms: start,
  ended_ms: end,
});

describe('roleAndIssue', () => {
  test('reads <role>-<issue> from a named transcript file', () => {
    expect(roleAndIssue('agent-aimplementer-1538-0123456789abcdef.jsonl')).toEqual({ role: 'implementer', issue: 1538 });
  });
  test('reads the issue from a named transcript file whose name carries a suffix', () => {
    expect(roleAndIssue('agent-areviewer-5333-recheck1-0123456789abcdef.jsonl')).toEqual({ role: 'reviewer', issue: 5333 });
  });
  test('falls back to the meta agentType for the role and leaves the issue unattributed', () => {
    expect(roleAndIssue('agent-a87fb169909c83e19.jsonl', meta({ agentType: 'blackhole:reviewer' }))).toEqual({ role: 'reviewer', issue: null });
  });
  test('a name without an issue number keeps the name as the role and no issue', () => {
    expect(roleAndIssue('agent-areview-docs-audit-8f0b833ef4d07177.jsonl')).toEqual({ role: 'review-docs-audit', issue: null });
  });
  test('reads the issue from the meta spawn name when the file is named by hash', () => {
    const h = 'agent-a4a097790b966c4c8.jsonl';
    expect(roleAndIssue(h, meta({ agentType: 'blackhole:implementer', name: 'implementer-5395a-t159' }))).toEqual({ role: 'implementer', issue: 5395 });
    expect(roleAndIssue(h, meta({ agentType: 'blackhole:reviewer', name: 'reviewer-5333-recheck1-t159' }))).toEqual({ role: 'reviewer', issue: 5333 });
    expect(roleAndIssue(h, meta({ name: 'inv-6060' }))).toEqual({ role: 'inv', issue: 6060 });
  });
  test('the documented <role>-<issue> shape attributes, and a PR number is never the issue', () => {
    const h = 'agent-a4a097790b966c4c8.jsonl';
    expect(roleAndIssue(h, meta({ name: 'implementer-1576' }))).toEqual({ role: 'implementer', issue: 1576 });
    expect(roleAndIssue(h, meta({ name: 'reviewer-1576-recheck1' }))).toEqual({ role: 'reviewer', issue: 1576 });
    expect(roleAndIssue(h, meta({ name: 'reviewer-pr1502' }))).toEqual({ role: 'reviewer', issue: null });
  });
  test('a meta name without a numeric segment leaves the issue unattributed', () => {
    expect(roleAndIssue('agent-a1.jsonl', meta({ agentType: 'blackhole:orchestrator', name: 'bh-orchestrator-t159' }))).toEqual({ role: 'orchestrator', issue: null });
  });
  test('falls back to "issue N" in the description, never to a PR number', () => {
    const h = 'agent-a87fb169909c83e19.jsonl';
    expect(roleAndIssue(h, meta({ agentType: 'blackhole:router', description: 'Route issue #1362' }))).toEqual({ role: 'router', issue: 1362 });
    expect(roleAndIssue(h, meta({ agentType: 'blackhole:reviewer', description: 'Review PR #5340' }))).toEqual({ role: 'reviewer', issue: null });
  });
  test('the meta name wins over the description', () => {
    expect(roleAndIssue('agent-a1.jsonl', meta({ agentType: 'blackhole:planner', name: 'planner-10', description: 'Plan issue 99' }))).toEqual({ role: 'planner', issue: 10 });
  });
  test('an unnamed file with no meta has no role', () => {
    expect(roleAndIssue('agent-a87fb169909c83e19.jsonl')).toBeNull();
  });
});

describe('parseWorkerRow', () => {
  test('takes the first assistant turn cache_creation_input_tokens and the first and last timestamps', () => {
    const r = parseWorkerRow('agent-aimplementer-7-0123456789abcdef.jsonl', meta(), transcript(110_000, '2026-11-25T10:00:00.000Z', '2026-11-25T10:04:00.000Z'));
    expect(r).toEqual({
      role: 'implementer',
      issue: 7,
      first_turn_tokens: 110_000,
      started_ms: Date.parse('2026-11-25T10:00:00.000Z'),
      ended_ms: Date.parse('2026-11-25T10:04:00.000Z'),
    });
  });
  test('skips malformed lines and returns null for a transcript with no assistant usage', () => {
    expect(parseWorkerRow('agent-aimplementer-7-0123456789abcdef.jsonl', meta(), 'not json\n' + line({ type: 'user', timestamp: '2026-11-25T10:00:00.000Z' }))).toBeNull();
  });
});

describe('buildWorkerContextReport', () => {
  const T = Date.parse('2026-11-25T10:00:00.000Z');
  const min = 60_000;
  const rows = [
    row('implementer', 1, 100_000, T, T + 10 * min),
    row('reviewer', 1, 120_000, T + 11 * min, T + 20 * min),
    row('implementer', 1, 80_000, T + 22 * min, T + 30 * min), // fix round, 2 min after the reviewer: warm
    row('implementer', 2, 140_000, T, T + 5 * min),
    row('implementer', 2, 90_000, T + 5 * min + WARM_TTL_MS + 1, T + 40 * min), // cold by 1 ms
    row('implementer', 3, 50_000, T, T + min),
    row('reviewer', null, 70_000, T, T + min),
  ];
  const report = buildWorkerContextReport(rows, [1, 2]);

  test('median first-turn tokens, overall and per role', () => {
    expect(report.median_first_turn_tokens).toBe(90_000);
    expect(report.roles.implementer).toEqual({ spawns: 5, median_first_turn_tokens: 90_000 });
    expect(report.roles.reviewer).toEqual({ spawns: 2, median_first_turn_tokens: 95_000 });
  });
  test('spawns per merged PR counts only attributed workers on merged issues', () => {
    expect(report.merged_prs).toBe(2);
    expect(report.spawns_per_merged_pr).toBe(2.5);
  });
  test('respawns are same-role spawns beyond the first on an issue, split warm and cold at the 5-minute TTL', () => {
    expect(report.respawns).toEqual({ total: 2, warm: 1, cold: 1 });
  });
  test('a gap of exactly the TTL is still warm', () => {
    const r = buildWorkerContextReport([row('implementer', 9, 1, T, T + 1), row('implementer', 9, 1, T + 1 + WARM_TTL_MS, T + 2 + WARM_TTL_MS)], [9]);
    expect(r.respawns).toEqual({ total: 1, warm: 1, cold: 0 });
  });
  test('workers without an issue are counted as unattributed, never guessed', () => {
    expect(report.unattributed).toBe(1);
    expect(report.workers).toBe(7);
  });
  test('no merged issues leaves the ratio null; no rows leaves every median null', () => {
    expect(buildWorkerContextReport(rows, []).spawns_per_merged_pr).toBeNull();
    const empty = buildWorkerContextReport([], [1]);
    expect(empty.median_first_turn_tokens).toBeNull();
    expect(empty.workers).toBe(0);
  });
});

describe('readWorkerContext', () => {
  const dir = makeTempDir('wcr-read');
  test('is null when the file is absent, unreadable or not a report, and the record when it is one', () => {
    expect(readWorkerContext(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, WORKER_CONTEXT_FILE), '{not json');
    expect(readWorkerContext(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, WORKER_CONTEXT_FILE), JSON.stringify({ workers: 'many' }));
    expect(readWorkerContext(dir)).toBeNull();
    const rec = { recorded_at: '2026-11-25T10:00:00.000Z', ...buildWorkerContextReport([], []) };
    fs.writeFileSync(path.join(dir, WORKER_CONTEXT_FILE), JSON.stringify(rec));
    expect(readWorkerContext(dir)).toEqual(rec);
  });
});

describe('collectWorkerRows', () => {
  test('attributes hash-named transcripts through their .meta.json so spawns_per_merged_pr counts them', () => {
    const dir = makeTempDir('wcr-collect');
    const sub = path.join(dir, 'proj', 'session', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const spawn = (id: string, meta: Record<string, unknown>, from: string, to: string) => {
      fs.writeFileSync(path.join(sub, `agent-a${id}.jsonl`), transcript(100_000, from, to));
      fs.writeFileSync(path.join(sub, `agent-a${id}.meta.json`), JSON.stringify(meta));
    };
    spawn('4a097790b966c4c8', { agentType: 'blackhole:implementer', name: 'implementer-77-t1' }, '2026-11-25T10:00:00.000Z', '2026-11-25T10:10:00.000Z');
    spawn('60118fb92e290573', { agentType: 'blackhole:reviewer', description: 'Review issue 77' }, '2026-11-25T10:11:00.000Z', '2026-11-25T10:20:00.000Z');
    spawn('9f3cd4c6dfadd9fb', { agentType: 'blackhole:hunter', description: 'Bug hunt' }, '2026-11-25T10:00:00.000Z', '2026-11-25T10:01:00.000Z');
    const report = buildWorkerContextReport(collectWorkerRows(dir), [77]);
    expect(report.workers).toBe(3);
    expect(report.unattributed).toBe(1);
    expect(report.spawns_per_merged_pr).toBe(2);
  });
});

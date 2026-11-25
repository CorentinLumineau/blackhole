import { describe, expect, test } from 'bun:test';
import type { QueueJson } from './campaign-status/types.ts';
import type { ForgeAdapter, ForgeIssue } from './forge-adapter/types.ts';
import { applyScores, DuplicateScoreError, parseScores, scoreRequests, staleness, upsertRationaleLine } from './pareto-score.ts';

const issue = (number: number, body = '', labels: string[] = [], extra: Partial<ForgeIssue> = {}): ForgeIssue => ({ number, title: `Issue ${number}`, body, labels: labels.map((name) => ({ name })), milestone: null, state: 'OPEN', ...extra });
const queue = (entries: Record<string, Record<string, unknown>>): QueueJson => ({ issues: entries as QueueJson['issues'] });
const NOW = new Date('2026-11-26T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();
const SCORED = 'x\n\nPareto: gain=8 effort=4 priority=56';

function fake() {
  const calls: Array<[string, ...unknown[]]> = [];
  const rec = (name: string) => async (...args: unknown[]) => void calls.push([name, ...args]);
  return { adapter: { issueEdit: rec('issueEdit'), labelAdd: rec('labelAdd'), labelRemove: rec('labelRemove') } as unknown as ForgeAdapter, calls };
}

describe('scoreRequests', () => {
  test('lists ready entries with no stored or forge-side score, lowest number first', () => {
    const q = queue({ '9': { status: 'ready' }, '3': { status: 'ready' }, '4': { status: 'ready', pareto: { gain: 5, effort: 5, priority: 30 } }, '5': { status: 'in-flight' }, '6': { status: 'ready' }, '7': { status: 'ready' } });
    const issues = [issue(9, 'b', ['ready']), issue(3), issue(4), issue(5), issue(6, SCORED), issue(7, '', [], { state: 'CLOSED' })];
    expect(scoreRequests(q, issues)).toEqual([
      { number: 3, title: 'Issue 3', labels: [], body: '' },
      { number: 9, title: 'Issue 9', labels: ['ready'], body: 'b' },
    ]);
  });
  test('treats an invalid Pareto line as unscored and caps the body excerpt', () => {
    const r = scoreRequests(queue({ '1': { status: 'ready' } }), [issue(1, `Pareto: gain=9 effort=9 priority=1\n${'a'.repeat(5000)}`)]);
    expect(r).toHaveLength(1);
    expect(r[0]!.body).toHaveLength(4000);
  });
});

describe('parseScores', () => {
  test('accepts a valid array', () => {
    expect(parseScores([{ number: 3, gain: 7, effort: 5, rationale: 'why' }])).toEqual([{ number: 3, gain: 7, effort: 5, rationale: 'why' }]);
  });
  test.each([
    ['not an array', { number: 3 }],
    ['gain out of scale', [{ number: 3, gain: 11, effort: 5, rationale: 'r' }]],
    ['non-integer effort', [{ number: 3, gain: 5, effort: 2.5, rationale: 'r' }]],
    ['missing rationale', [{ number: 3, gain: 5, effort: 5 }]],
    ['blank rationale', [{ number: 3, gain: 5, effort: 5, rationale: '  ' }]],
    ['non-integer number', [{ number: '3', gain: 5, effort: 5, rationale: 'r' }]],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseScores(raw)).toThrow();
  });
});

describe('parseScores duplicates', () => {
  test('rejects two entries for the same issue number with a named error', () => {
    const row = { number: 3, gain: 7, effort: 5, rationale: 'why' };
    expect(() => parseScores([row, { ...row, gain: 2 }])).toThrow(DuplicateScoreError);
    expect(() => parseScores([row, { ...row, gain: 2 }])).toThrow('duplicate score entries for issue #3');
  });
});

describe('upsertRationaleLine', () => {
  test('appends one flattened, capped line and replaces it in place on a re-run', () => {
    const once = upsertRationaleLine('body', 'line one\nline two');
    expect(once).toBe('body\n\nPareto rationale: line one line two');
    expect(upsertRationaleLine(once, 'second')).toBe('body\n\nPareto rationale: second');
    expect(upsertRationaleLine('b', 'a'.repeat(300))).toBe(`b\n\nPareto rationale: ${'a'.repeat(199)}…`);
  });
});

describe('applyScores', () => {
  const score = { number: 3, gain: 7, effort: 5, rationale: 'cheap and broad' };

  test('writes rationale and line to the body, the bucket label, and the queue score', async () => {
    const { adapter, calls } = fake();
    const r = await applyScores(adapter, queue({ '3': { status: 'ready' } }), [issue(3, 'x', ['ready'])], [score], { now: NOW });
    expect(calls).toEqual([
      ['issueEdit', 3, { body: 'x\n\nPareto rationale: cheap and broad\n\nPareto: gain=7 effort=5 priority=42' }],
      ['labelAdd', { type: 'issue', number: 3 }, ['pareto:P3']],
    ]);
    expect(r.queue.issues!['3']!.pareto).toEqual({ gain: 7, effort: 5, priority: 42, scored_at: NOW.toISOString(), rationale: 'cheap and broad' });
    expect(r.outcomes).toEqual([{ number: 3, result: 'scored' }]);
  });

  test('an already scored issue keeps its score and only has its label reconciled', async () => {
    const { adapter, calls } = fake();
    const r = await applyScores(adapter, queue({ '3': { status: 'ready' } }), [issue(3, SCORED, ['pareto:P3'])], [score]);
    expect(calls).toEqual([
      ['labelRemove', { type: 'issue', number: 3 }, ['pareto:P3']],
      ['labelAdd', { type: 'issue', number: 3 }, ['pareto:P2']],
    ]);
    expect(r.queue.issues!['3']!.pareto).toEqual({ gain: 8, effort: 4, priority: 56 });
    expect(r.outcomes).toEqual([{ number: 3, result: 'already-scored' }]);
  });

  test('a second apply over the result makes no forge call', async () => {
    const { adapter, calls } = fake();
    await applyScores(adapter, queue({ '3': { status: 'ready' } }), [issue(3, 'x\n\nPareto: gain=7 effort=5 priority=42', ['pareto:P3'])], [score]);
    expect(calls).toEqual([]);
  });

  test('skips an issue outside the queue or not open, writing nothing', async () => {
    const { adapter, calls } = fake();
    const r = await applyScores(adapter, queue({ '3': { status: 'ready' } }), [issue(8)], [score, { ...score, number: 8 }]);
    expect(calls).toEqual([]);
    expect(r.outcomes).toEqual([
      { number: 3, result: 'skipped', reason: 'not an open issue on the forge' },
      { number: 8, result: 'skipped', reason: 'not in the queue' },
    ]);
    expect(r.queue.issues!['3']!.pareto).toBeUndefined();
  });

  test('applies a repeated issue number once, skipping the repeat', async () => {
    const { adapter, calls } = fake();
    const r = await applyScores(adapter, queue({ '3': { status: 'ready' } }), [issue(3, 'x', ['ready'])], [score, { ...score, gain: 1 }]);
    expect(r.outcomes).toEqual([
      { number: 3, result: 'scored' },
      { number: 3, result: 'skipped', reason: 'duplicate score entry for this issue' },
    ]);
    expect(r.queue.issues!['3']!.pareto!.gain).toBe(score.gain);
    const single = fake();
    await applyScores(single.adapter, queue({ '3': { status: 'ready' } }), [issue(3, 'x', ['ready'])], [score]);
    expect(calls).toEqual(single.calls);
  });

  test('a forge error propagates', async () => {
    const adapter = { issueEdit: async () => { throw new Error('edit failed'); } } as unknown as ForgeAdapter;
    await expect(applyScores(adapter, queue({ '3': { status: 'ready' } }), [issue(3)], [score])).rejects.toThrow('edit failed');
  });
});

describe('staleness', () => {
  const entry = (scored_at?: string) => ({ pareto: { gain: 8, effort: 4, priority: 56, ...(scored_at ? { scored_at } : {}) } });
  test('a score with no scored_at is unrecorded', () => {
    expect(staleness(entry(), {}, NOW)).toBe('unrecorded');
    expect(staleness({}, {}, NOW)).toBe('unrecorded');
  });
  test('an issue updated after scored_at is edited, one updated before is current', () => {
    expect(staleness(entry(ago(2)), { updatedAt: ago(1) }, NOW)).toBe('edited');
    expect(staleness(entry(ago(2)), { updatedAt: ago(3) }, NOW)).toBeNull();
    expect(staleness(entry(ago(2)), { updatedAt: null }, NOW)).toBeNull();
  });
  test('a score older than max age is aged: default 7 days, configurable, boundary exclusive', () => {
    expect(staleness(entry(ago(7.5)), {}, NOW)).toBe('aged');
    expect(staleness(entry(ago(7)), {}, NOW)).toBeNull();
    expect(staleness(entry(ago(3)), {}, NOW, 2)).toBe('aged');
    expect(staleness(entry(ago(3)), {}, NOW, 30)).toBeNull();
  });
});

describe('scoreRequests with re-scoring', () => {
  const scored = (at?: string) => ({ status: 'ready', pareto: { gain: 8, effort: 4, priority: 56, ...(at ? { scored_at: at } : {}) } });
  test('lists stale scored entries with their current score and reason, alongside unscored ones', () => {
    const q = queue({ '1': scored(ago(1)), '2': scored(ago(9)), '3': scored(ago(2)), '4': { status: 'ready' }, '5': scored(), '6': { ...scored(ago(9)), status: 'in-flight' } });
    const issues = [issue(1, SCORED, [], { updatedAt: ago(0.5) }), issue(2, SCORED), issue(3, SCORED, [], { updatedAt: ago(3) }), issue(4), issue(5, SCORED), issue(6, SCORED)];
    const r = scoreRequests(q, issues, { now: NOW });
    expect(r.map((x) => [x.number, x.rescore?.reason])).toEqual([[1, 'edited'], [2, 'aged'], [4, undefined], [5, 'unrecorded']]);
    expect(r[0]!.rescore).toEqual({ gain: 8, effort: 4, priority: 56, reason: 'edited' });
  });
  test('without options only unscored entries are listed', () => {
    expect(scoreRequests(queue({ '1': scored(ago(30)) }), [issue(1, SCORED)])).toEqual([]);
  });
});

describe('applyScores re-scoring', () => {
  const score = { number: 3, gain: 3, effort: 2, rationale: 'now cheap' };
  const stale = { '3': { status: 'ready', pareto: { gain: 8, effort: 4, priority: 56, scored_at: ago(9) } } };

  test('a stale score is rewritten on the forge and the queue, scored_at refreshed', async () => {
    const { adapter, calls } = fake();
    const r = await applyScores(adapter, queue(stale), [issue(3, SCORED, ['pareto:P2'])], [score], { now: NOW, rescore: {} });
    expect(calls).toEqual([
      ['issueEdit', 3, { body: 'x\n\nPareto: gain=3 effort=2 priority=27\n\nPareto rationale: now cheap' }],
      ['labelRemove', { type: 'issue', number: 3 }, ['pareto:P2']],
      ['labelAdd', { type: 'issue', number: 3 }, ['pareto:P4']],
    ]);
    expect(r.queue.issues!['3']!.pareto).toEqual({ gain: 3, effort: 2, priority: 27, scored_at: NOW.toISOString(), rationale: 'now cheap' });
    expect(r.outcomes).toEqual([{ number: 3, result: 'rescored' }]);
  });
  test('a current score is left alone even when rescoring is on', async () => {
    const { adapter, calls } = fake();
    const q = queue({ '3': { status: 'ready', pareto: { gain: 8, effort: 4, priority: 56, scored_at: ago(1) } } });
    const r = await applyScores(adapter, q, [issue(3, SCORED, ['pareto:P2'], { updatedAt: ago(2) })], [score], { now: NOW, rescore: {} });
    expect(calls).toEqual([]);
    expect(r.outcomes).toEqual([{ number: 3, result: 'already-scored' }]);
  });
  test('a second apply over a rescore makes no forge call', async () => {
    const first = fake();
    const r = await applyScores(first.adapter, queue(stale), [issue(3, SCORED, ['pareto:P2'])], [score], { now: NOW, rescore: {} });
    const body = (first.calls[0]![2] as { body: string }).body;
    const again = fake();
    await applyScores(again.adapter, r.queue, [issue(3, body, ['pareto:P4'], { updatedAt: NOW.toISOString() })], [score], { now: NOW, rescore: {} });
    expect(again.calls).toEqual([]);
  });
});

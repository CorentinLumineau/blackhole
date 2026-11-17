import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runRecord } from '../../campaign-record.ts';
import {
  addPendingDecision,
  askOrPark,
  PENDING_DECISIONS_FILE,
  pendingDecisionError,
  readPendingDecisions,
  wakeBatch,
  type PendingDecision,
} from './pending-decisions.ts';
import { readDecisions } from './record.ts';

const FIXTURE = path.resolve(import.meta.dir, '../../../fixtures/sleep-mode/pending-decisions.example.json');
const dirs: string[] = [];
function campaign(config: Record<string, unknown> = { merge_mode: 'leave-open', sleep_mode: { enabled: true } }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-sleep-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const NOW = new Date('2026-11-17T02:00:00.000Z');
const pending = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, PENDING_DECISIONS_FILE), 'utf-8')).decisions;

describe('askOrPark — the one choke point', () => {
  test('parks only when sleep_mode.enabled is exactly true', () => {
    expect(askOrPark({ sleep_mode: { enabled: true } })).toBe('park');
    expect(askOrPark({ sleep_mode: { enabled: false } })).toBe('ask');
    expect(askOrPark({ sleep_mode: { enabled: 'true' } })).toBe('ask');
    expect(askOrPark({})).toBe('ask');
    expect(askOrPark(null)).toBe('ask');
  });
});

describe('pending-decision schema', () => {
  test('the committed fixture is valid and reads back in order', () => {
    const dir = campaign();
    fs.copyFileSync(FIXTURE, path.join(dir, PENDING_DECISIONS_FILE));
    expect(readPendingDecisions(dir).map((d) => d.id)).toEqual(['PD-1', 'PD-2']);
  });

  test('rejects too few or too many options and an out-of-range recommendation', () => {
    const base = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')).decisions[0] as PendingDecision;
    expect(pendingDecisionError(base)).toBeNull();
    expect(pendingDecisionError({ ...base, options: [{ label: 'Only' }] })).toContain('2 to 4 options');
    const five = Array.from({ length: 5 }, (_, i) => ({ label: `O${i}` }));
    expect(pendingDecisionError({ ...base, options: five })).toContain('2 to 4 options');
    expect(pendingDecisionError({ ...base, recommended: 2 })).toContain('recommends no listed option');
    expect(pendingDecisionError({ ...base, blocks: [0] })).toContain('invalid blocks');
  });

  test('a malformed file throws instead of reading as empty', () => {
    const dir = campaign();
    fs.writeFileSync(path.join(dir, PENDING_DECISIONS_FILE), JSON.stringify({ decisions: [{ id: 'PD-1' }] }));
    expect(() => readPendingDecisions(dir)).toThrow('has no question');
  });

  test('the same question parked twice merges its blocks and keeps its id', () => {
    const first = addPendingDecision([], {
      question: 'Q?', options: [{ label: 'A' }, { label: 'B' }], recommended: 0, blocks: [1], created_at: NOW.toISOString(),
    });
    const again = addPendingDecision(first.list, { ...first.decision, blocks: [1, 2] });
    expect(again.list).toHaveLength(1);
    expect(again.decision).toMatchObject({ id: 'PD-1', blocks: [1, 2] });
  });
});

describe('wakeBatch — one round, most-blocking first, four per card', () => {
  test('sorts by blocked-item count and chunks into cards of at most four', () => {
    let list: PendingDecision[] = [];
    for (let i = 1; i <= 6; i++) {
      list = addPendingDecision(list, {
        question: `Q${i}?`, options: [{ label: 'Yes' }, { label: 'No' }], recommended: 0,
        blocks: Array.from({ length: i % 3 }, (_, k) => i * 10 + k), created_at: `2026-11-16T0${i}:00:00.000Z`,
      }).list;
    }
    const batch = wakeBatch(list);
    expect(batch.total).toBe(6);
    expect(batch.cards.map((c) => c.length)).toEqual([4, 2]);
    expect(batch.cards.flat().map((q) => q.waiting_items)).toEqual([2, 2, 1, 1, 0, 0]);
    expect(batch.cards[0].map((q) => q.question)).toEqual(['Q2?', 'Q5?', 'Q1?', 'Q4?']);
    expect(batch.blocked_items).toEqual([10, 20, 21, 40, 50, 51]);
  });

  test('nothing parked ⇒ no cards', () => {
    expect(wakeBatch([])).toEqual({ total: 0, blocked_items: [], cards: [] });
  });
});

describe('campaign-record park / wake / resolve', () => {
  test('park writes through the state guard, wake prints the batch, resolve records the answer', () => {
    const dir = campaign();
    const flags = ['--campaign-dir', dir];
    expect(
      runRecord(['park', '--question', 'Approve the plan for #12?', '--options', 'Approve: implement as planned|Rework',
        '--recommended', 'Approve', '--refs', '12,14', '--gate', 'plan-approval', '--evidence', 'Plan PR body', ...flags], NOW),
    ).toBe('Parked PD-1: Approve the plan for #12? (blocks #12, #14; 1 waiting)');
    expect(pending(dir)[0]).toEqual({
      id: 'PD-1', question: 'Approve the plan for #12?',
      options: [{ label: 'Approve', consequence: 'implement as planned' }, { label: 'Rework' }],
      recommended: 0, evidence: 'Plan PR body', blocks: [12, 14], gate: 'plan-approval', created_at: NOW.toISOString(),
    });
    runRecord(['park', '--question', 'Split #30?', '--options', 'Yes|No', '--recommended', 'No', ...flags], NOW);

    const batch = JSON.parse(runRecord(['wake', ...flags], NOW));
    expect(batch.total).toBe(2);
    expect(batch.cards[0].map((q: PendingDecision) => q.id)).toEqual(['PD-1', 'PD-2']);

    expect(runRecord(['resolve', '--id', 'PD-1', '--answer', 'Approve', ...flags], NOW)).toBe(
      'Resolved PD-1 → Approve. Unblock #12, #14 (1 still pending)',
    );
    expect(pending(dir).map((d: PendingDecision) => d.id)).toEqual(['PD-2']);
    expect(readDecisions(dir)).toEqual([{ date: '2026-11-17', text: 'Approve the plan for #12? → Approve', refs: [12, 14] }]);

    runRecord(['resolve', '--id', 'PD-2', '--answer', 'No', ...flags], NOW);
    expect(fs.existsSync(path.join(dir, PENDING_DECISIONS_FILE))).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'archive')).some((f) => f.startsWith('pending-decisions-'))).toBe(true);
  });

  test('park refuses a recommendation that is not one of the options, and writes nothing', () => {
    const dir = campaign();
    expect(() =>
      runRecord(['park', '--question', 'Q?', '--options', 'A|B', '--recommended', 'C', '--campaign-dir', dir], NOW),
    ).toThrow('--recommended must name one of the options');
    expect(fs.existsSync(path.join(dir, PENDING_DECISIONS_FILE))).toBe(false);
  });

  test('resolve refuses an unknown id', () => {
    const dir = campaign();
    expect(() => runRecord(['resolve', '--id', 'PD-9', '--answer', 'x', '--campaign-dir', dir], NOW)).toThrow('No pending decision PD-9');
  });
});

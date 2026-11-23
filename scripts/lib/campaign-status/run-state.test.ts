import { describe, expect, test } from 'bun:test';
import type { PendingDecision } from './pending-decisions.ts';
import { buildDocCarry, buildRunPanel, pendingRows, RUN_ROW_KEYS, runRows, type DocCarryIssue } from './run-state.ts';

const decision = (id: string, blocks: number[], created_at = '2026-11-16T10:00:00.000Z'): PendingDecision => ({
  id,
  question: `Question ${id}?`,
  options: [{ label: 'Yes' }, { label: 'No' }],
  recommended: 1,
  blocks,
  gate: 'clarify',
  created_at,
});

const RUN_CONTEXT = {
  refreshed_at: '2026-11-17T06:00:00.000Z',
  context: { host: { value: 'claude', source: 'env' } },
  route: { pattern: 'C', forge_channel: 'rest', question_channel: 'ask-decision', ci_wait: 'poll', state_store: 'branch', schedule: 'turn', missing: [], warnings: [] },
};

const valueOf = (rows: Array<{ key: string; value: string }>, key: string): string | undefined => rows.find((r) => r.key === key)?.value;

describe('run panel: route, sleep mode and coordination', () => {
  test('always emits the four rows, in RUN_ROW_KEYS order, whatever is recorded', () => {
    expect(runRows(buildRunPanel({ config: {}, runContext: null, pending: [] })).map((r) => r.key)).toEqual([...RUN_ROW_KEYS]);
    expect(runRows(buildRunPanel({ config: { sleep_mode: { enabled: true } }, runContext: RUN_CONTEXT, pending: [decision('PD-1', [3])] })).map((r) => r.key)).toEqual([...RUN_ROW_KEYS]);
  });

  test('the run route names the pattern, host, state store, question and forge channels', () => {
    const rows = runRows(buildRunPanel({ config: {}, runContext: RUN_CONTEXT, pending: [] }));
    expect(valueOf(rows, 'Run route')).toBe('pattern C · host claude · state branch · questions ask-decision · forge rest');
  });

  test('a missing capability is named on the route row', () => {
    const ctx = { ...RUN_CONTEXT, route: { ...RUN_CONTEXT.route, forge_channel: null, missing: ['forge channel'] } };
    expect(valueOf(runRows(buildRunPanel({ config: {}, runContext: ctx, pending: [] })), 'Run route')).toBe(
      'pattern C · host claude · state branch · questions ask-decision · forge none · missing forge channel',
    );
  });

  test('no run-context.json, or one without a route, says how to record it', () => {
    for (const runContext of [null, {}, { route: 'C' }]) {
      const panel = buildRunPanel({ config: {}, runContext, pending: [] });
      expect(panel.route).toBeNull();
      expect(valueOf(runRows(panel), 'Run route')).toBe('not recorded (bun run scripts/run-context.ts writes it)');
    }
  });

  test('decisions park by default, with the waiting count, the round to run and the owner away', () => {
    const away = buildRunPanel({ config: { sleep_mode: { enabled: true } }, runContext: null, pending: [decision('PD-1', [3]), decision('PD-2', [4])] });
    expect(away.sleep_mode).toBe(true);
    expect(away.decisions_mode).toBe('park');
    expect(away.parked).toBe(2);
    expect(valueOf(runRows(away), 'Decisions')).toBe('park · 2 waiting — run /blackhole decide · owner away');
    const none = buildRunPanel({ config: {}, runContext: null, pending: [] });
    expect(valueOf(runRows(none), 'Decisions')).toBe('park · none waiting');
    const ask = buildRunPanel({ config: { decisions: { mode: 'ask' } }, runContext: null, pending: [decision('PD-1', [])] });
    expect(valueOf(runRows(ask), 'Decisions')).toBe('ask · 1 waiting — run /blackhole decide');
  });

  test('an unreadable pending-decisions.json is said, never shown as zero parked', () => {
    const panel = buildRunPanel({ config: { sleep_mode: { enabled: true } }, runContext: null, pending: { error: 'no "decisions" array' } });
    expect(panel.parked).toBeNull();
    expect(valueOf(runRows(panel), 'Decisions')).toBe('park · parked decisions unreadable: no "decisions" array · owner away');
  });

  test('coordination role: solo, manager, and peer with its manager and floor', () => {
    const role = (coordination: Record<string, unknown>) =>
      valueOf(runRows(buildRunPanel({ config: { usage_budget: { coordination } }, runContext: null, pending: [] })), 'Coordination');
    expect(role({})).toBe('solo');
    expect(role({ role: 'manager' })).toBe('manager · grants worker slots to its peer sessions');
    expect(role({ role: 'peer', manager_session: 'session_abc', peer_floor: 2 })).toBe('peer of session_abc · 2 workers before a grant');
  });

  test('an invalid usage_budget leaves coordination unknown, with the reason', () => {
    const panel = buildRunPanel({ config: { usage_budget: { coordination: { role: 'boss' } } }, runContext: null, pending: [] });
    expect(panel.coordination).toBeNull();
    expect(valueOf(runRows(panel), 'Coordination')).toMatch(/^unknown — usage_budget invalid: .*coordination\.role/);
  });
});

describe('pending decisions rows', () => {
  test('most-blocking first, oldest first on a tie, with the recommended label', () => {
    const rows = pendingRows([
      decision('PD-1', [3], '2026-11-16T09:00:00.000Z'),
      decision('PD-2', [4, 5], '2026-11-16T11:00:00.000Z'),
      decision('PD-3', [6], '2026-11-16T08:00:00.000Z'),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['PD-2', 'PD-3', 'PD-1']);
    expect(rows[0]).toEqual({ id: 'PD-2', question: 'Question PD-2?', recommended: 'No', waiting_items: 2, gate: 'clarify', created_at: '2026-11-16T11:00:00.000Z' });
  });

  test('none parked, or an unreadable file, gives no rows', () => {
    expect(pendingRows([])).toEqual([]);
    expect(pendingRows({ error: 'bad' })).toEqual([]);
  });
});

describe('the run panel and the parked decisions on every surface', () => {
  test('text dashboard, --html and the data rows carry the same lines', async () => {
    const { fixtureReport } = await import('./data-fixture.ts');
    const { buildStatusData } = await import('./data.ts');
    const { formatDashboard } = await import('./dashboard.ts');
    const { renderStatusHtml } = await import('./html.ts');
    const report = fixtureReport();
    expect(report.pending_decisions.map((d) => d.id)).toEqual(['PD-1']);
    const data = buildStatusData(report);
    expect(data.run).toEqual(runRows(report.run));
    expect(data.pending).toEqual([{ id: 'PD-1', question: 'Ship the gate as a draft?', recommended: 'Yes', waiting_items: 1, gate: 'plan-approval', created_at: '2026-11-11T09:00:00.000Z' }]);
    const text = formatDashboard({ checkpoint: {}, queue: { issues: {} }, ledger: {}, forge: { openIssues: 0, openPrs: 0, ok: true }, view: report });
    expect(text).toContain('### Run');
    expect(text).toContain('- **Decisions:** park · 1 waiting — run /blackhole decide');
    expect(text).toContain('### Decisions waiting for you (1) — run /blackhole decide');
    const html = renderStatusHtml(report);
    expect(html).toContain('Decisions waiting for you <span class="count">1</span>');
    expect(html).toContain('Decisions: park · 1 waiting — run /blackhole decide');
    expect(html).toContain('Answer them all with /blackhole decide.');
    expect(html).toContain('Run route: not recorded');
  });
});

const entry = (route: string, target: string) => ({
  route,
  sub_mode: null,
  produced_by: 'planner',
  declared_at: '2026-11-17T00:00:00.000Z',
  staged_path: `.blackhole/staged/1/${route}.md`,
  target_path: target,
  target_kind: 'new_file',
});
const manifest = (...entries: Array<ReturnType<typeof entry>>) => ({ issue: 1, updated_at: '2026-11-17T00:00:00.000Z', entries }) as never;
type M = ReturnType<typeof manifest> | null;
const live = (n: number, promised: string[], m: M, phase = 'implement', extra: Partial<DocCarryIssue> = {}): DocCarryIssue => ({ issue: n, promised, manifest: m, phase, ...extra });
const done = (n: number, promised: string[], m: M): DocCarryIssue => ({ issue: n, promised, manifest: m, done: true, phase: 'done' });
const build = (issues: DocCarryIssue[], isCarried: (t: string) => boolean = () => false) => buildDocCarry({ enabled: true, issues, isCarried })!;
const rowOf = (docCarry: Parameters<typeof buildRunPanel>[0]['docCarry']) => valueOf(runRows(buildRunPanel({ config: {}, runContext: null, pending: [], docCarry })), 'Doc carry');

describe('buildDocCarry: the live set leads, merged history is a tail', () => {
  test('governance off gives null and the row says so', () => {
    expect(buildDocCarry({ enabled: false, issues: [live(1, ['plan'], null)], isCarried: () => false })).toBeNull();
    expect(rowOf(null)).toBe('off (docs governance off)');
    expect(rowOf(undefined)).toBe('off (docs governance off)');
  });

  test('nothing routed prints zeros and no tail', () => {
    expect(rowOf(build([]))).toBe('routes promised 0 · staged 0 · docs carried 0');
  });

  test('a live implement issue with plan and design promised and only plan staged is named, 1/2', () => {
    const dc = build([live(7, ['plan', 'design'], manifest(entry('plan', 'documentation/plans/a.md')))]);
    expect(dc).toMatchObject({ promised: 2, staged: 1, carried: 0, gaps: [{ issue: 7, staged: 1, promised: 2 }] });
    expect(rowOf(dc)).toBe('routes promised 2 · staged 1 · docs carried 0 · gaps: #7 1/2');
  });

  test('a handle-phase issue adds nothing to the headline or the gaps (staged 0 is expected there)', () => {
    const dc = build([live(3, ['plan'], null, 'handle')]);
    expect(dc).toMatchObject({ promised: 0, staged: 0, gaps: [] });
    expect(rowOf(dc)).toBe('routes promised 0 · staged 0 · docs carried 0');
  });

  test('a handle issue beside an implement issue: only the past-handle routes are counted', () => {
    const dc = build([live(3, ['plan', 'design'], null, 'handle'), live(4, ['plan'], manifest(entry('plan', 'documentation/plans/a.md')))]);
    expect(dc).toMatchObject({ promised: 1, staged: 1, gaps: [] });
  });

  test('carried counts staged new_file targets the stub reports present', () => {
    const dc = build([live(1, ['plan'], manifest(entry('plan', 'documentation/plans/a.md')))], (t) => t === 'documentation/plans/a.md');
    expect(dc).toMatchObject({ promised: 1, staged: 1, carried: 1, gaps: [] });
  });

  test('merged issues (a legacy one with no manifest is left out) never touch the headline or the gaps; they make the history tail', () => {
    const dc = build([done(1, ['plan', 'design'], null), done(2, ['plan'], manifest(entry('plan', 'documentation/plans/b.md'))), live(9, ['plan'], manifest(entry('plan', 'documentation/plans/c.md')))]);
    expect(dc).toMatchObject({ promised: 1, staged: 1, gaps: [], history: { promised: 1, staged: 1 } });
    expect(rowOf(dc)).toBe('routes promised 1 · staged 1 · docs carried 0 · history: 1/1 routes staged');
  });

  test('gaps name later phases first, then newer issues, three at most, then +N more', () => {
    const issues = [live(1, ['plan'], null, 'plan'), live(2, ['plan'], null, 'review'), live(3, ['plan'], null, 'implement'), live(4, ['plan'], null, 'plan'), live(5, ['plan'], null, 'implement')];
    expect(rowOf(build(issues))).toBe('routes promised 5 · staged 0 · docs carried 0 · gaps: #2 0/1, #5 0/1, #3 0/1 +2 more');
  });

  test('a live issue past handle with no route and no manifest is named unrouted; a handle one is not', () => {
    const dc = build([live(1, [], null, 'implement', { unrouted: true }), live(2, [], null, 'handle', { unrouted: true })]);
    expect(dc.unrouted).toEqual([1]);
    expect(rowOf(dc)).toBe('routes promised 0 · staged 0 · docs carried 0 · unrouted #1');
  });

  test('unrouted issues are named in encounter order and truncated with +N more', () => {
    const dc = build([1, 2, 3, 4, 5].map((n) => live(n, [], null, 'review', { unrouted: true })));
    expect(rowOf(dc)).toBe('routes promised 0 · staged 0 · docs carried 0 · unrouted #1, #2, #3 +2 more');
  });

  test('one unreadable manifest is counted for that issue and the other totals stay', () => {
    const dc = build([live(1, ['plan'], null, 'implement', { unreadable: true }), live(2, ['plan'], manifest(entry('plan', 'documentation/plans/a.md')))]);
    expect(dc).toMatchObject({ promised: 1, staged: 1, unreadable: 1, gaps: [] });
    expect(rowOf(dc)).toBe('routes promised 1 · staged 1 · docs carried 0 · unreadable 1');
  });

  test('a failure reading the whole campaign is said, never shown as zero', () => {
    expect(rowOf({ error: 'bad queue' })).toBe('unreadable (bad queue)');
  });
});

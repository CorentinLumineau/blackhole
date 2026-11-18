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

  test('sleep mode on with the parked count; off by default', () => {
    const on = buildRunPanel({ config: { sleep_mode: { enabled: true } }, runContext: null, pending: [decision('PD-1', [3]), decision('PD-2', [4])] });
    expect(on.sleep_mode).toBe(true);
    expect(on.parked).toBe(2);
    expect(valueOf(runRows(on), 'Sleep mode')).toBe('on · 2 parked decisions');
    const off = buildRunPanel({ config: {}, runContext: null, pending: [] });
    expect(valueOf(runRows(off), 'Sleep mode')).toBe('off · 0 parked decisions');
    expect(valueOf(runRows(buildRunPanel({ config: {}, runContext: null, pending: [decision('PD-1', [])] })), 'Sleep mode')).toBe('off · 1 parked decision');
  });

  test('an unreadable pending-decisions.json is said, never shown as zero parked', () => {
    const panel = buildRunPanel({ config: { sleep_mode: { enabled: true } }, runContext: null, pending: { error: 'no "decisions" array' } });
    expect(panel.parked).toBeNull();
    expect(valueOf(runRows(panel), 'Sleep mode')).toBe('on · parked decisions unreadable: no "decisions" array');
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
    expect(text).toContain('- **Sleep mode:** off · 1 parked decision');
    expect(text).toContain('### Decisions waiting for you (1)');
    const html = renderStatusHtml(report);
    expect(html).toContain('Decisions waiting for you <span class="count">1</span>');
    expect(html).toContain('Sleep mode: off · 1 parked decision');
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
const issueOf = (n: number, promised: string[], m: ReturnType<typeof manifest> | null): DocCarryIssue => ({ issue: n, promised, manifest: m });
const rowOf = (docCarry: Parameters<typeof buildRunPanel>[0]['docCarry']) => valueOf(runRows(buildRunPanel({ config: {}, runContext: null, pending: [], docCarry })), 'Doc carry');

describe('buildDocCarry: promised vs staged vs carried', () => {
  test('governance off gives null and the row says so', () => {
    expect(buildDocCarry({ enabled: false, issues: [issueOf(1, ['plan'], null)], isCarried: () => false })).toBeNull();
    expect(rowOf(null)).toBe('off (docs governance off)');
    expect(rowOf(undefined)).toBe('off (docs governance off)');
  });

  test('nothing routed prints zeros and no gaps', () => {
    const dc = buildDocCarry({ enabled: true, issues: [], isCarried: () => false });
    expect(dc).toEqual({ promised: 0, staged: 0, carried: 0, gaps: [] });
    expect(rowOf(dc)).toBe('promised 0 · staged 0 · carried 0');
  });

  test('plan and design promised with only plan staged is promised 2, staged 1, gap 1/2', () => {
    const dc = buildDocCarry({ enabled: true, issues: [issueOf(7, ['plan', 'design'], manifest(entry('plan', 'documentation/plans/a.md')))], isCarried: () => false });
    expect(dc).toEqual({ promised: 2, staged: 1, carried: 0, gaps: [{ issue: 7, staged: 1, promised: 2 }] });
    expect(rowOf(dc)).toBe('promised 2 · staged 1 · carried 0 · gaps: #7 1/2');
  });

  test('carried counts staged new_file targets the stub reports present', () => {
    const m = manifest(entry('plan', 'documentation/plans/a.md'));
    const dc = buildDocCarry({ enabled: true, issues: [issueOf(1, ['plan'], m)], isCarried: (t) => t === 'documentation/plans/a.md' });
    expect(dc).toMatchObject({ promised: 1, staged: 1, carried: 1, gaps: [] });
  });

  test('a done issue without a manifest is excluded, one with a manifest is counted', () => {
    const done = (n: number, m: ReturnType<typeof manifest> | null): DocCarryIssue => ({ ...issueOf(n, ['plan'], m), done: true });
    const dc = buildDocCarry({ enabled: true, issues: [done(1, null), done(2, manifest(entry('plan', 'documentation/plans/b.md')))], isCarried: () => true });
    expect(dc).toMatchObject({ promised: 1, staged: 1, carried: 1, gaps: [] });
  });

  test('four gaps print three and +1 more', () => {
    const issues = [1, 2, 3, 4].map((n) => issueOf(n, ['plan'], null));
    const dc = buildDocCarry({ enabled: true, issues, isCarried: () => false })!;
    expect(dc.gaps).toHaveLength(4);
    expect(rowOf(dc)).toBe('promised 4 · staged 0 · carried 0 · gaps: #1 0/1, #2 0/1, #3 0/1 +1 more');
  });

  test('an unreadable manifest is said, never shown as zero', () => {
    expect(rowOf({ error: 'bad manifest' })).toBe('unreadable (bad manifest)');
  });
});

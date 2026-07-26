import { describe, expect, test } from 'bun:test';
import {
  computeWaves,
  countLedgerByStatus,
  discoveryFilings,
  formatDashboard,
  formatScopeLabel,
  groupIssuesByPhase,
  parseCheckpointFrontmatter,
  renderConfigSummary,
  renderRouteChain,
  type Route,
} from './campaign-status';

const fullRoute: Route = {
  needs_split: false,
  needs_research: true,
  needs_investigation: true,
  needs_design: true,
  task_type: 'feature',
  plan_mode: 'full',
  security_review_required: true,
  confidence: { split: 95, design: 80, plan_mode: 70, security: 90 },
  computed_at_phase: 'handle',
  revision: 1,
};

describe('renderRouteChain', () => {
  test('absent route renders a not-yet-routed placeholder, no crash', () => {
    expect(renderRouteChain(undefined, 'handle')).toContain('not yet routed');
  });

  test('full route renders the planned conditional chain', () => {
    const out = renderRouteChain(fullRoute, 'plan');
    expect(out).toContain('Handle');
    expect(out).toContain('research');
    expect(out).toContain('investigate');
    expect(out).toContain('design-gate');
    expect(out).toContain('Plan(full)');
    expect(out).toContain('Implement');
    expect(out).toContain('Review(security)');
  });

  test('marks the current phase in the chain', () => {
    const out = renderRouteChain(fullRoute, 'plan');
    // current phase 'plan' is marked; a different phase is not
    expect(out).toMatch(/▸Plan\(full\)◂/);
    expect(out).not.toMatch(/▸Implement◂/);
  });

  test('shows per-flag confidence inline', () => {
    const out = renderRouteChain(fullRoute, 'handle');
    expect(out).toContain('split:95');
    expect(out).toContain('design:80');
    expect(out).toContain('plan:70');
    expect(out).toContain('sec:90');
  });

  test('plan_mode absent defaults to full', () => {
    const out = renderRouteChain(
      { needs_design: false, security_review_required: false },
      'plan',
    );
    expect(out).toContain('Plan(full)');
  });

  test('needs_split voids siblings — renders only the split branch', () => {
    const out = renderRouteChain(
      { ...fullRoute, needs_split: true, confidence: { split: 60 } },
      'handle',
    );
    expect(out).toContain('Split');
    expect(out).not.toContain('design-gate');
    expect(out).not.toContain('Review(security)');
  });

  test('omits optional steps when their flags are false', () => {
    const out = renderRouteChain(
      {
        needs_split: false,
        needs_research: false,
        needs_investigation: false,
        needs_design: false,
        task_type: 'bugfix',
        plan_mode: 'quick',
        security_review_required: false,
      },
      'implement',
    );
    expect(out).not.toContain('research');
    expect(out).not.toContain('design-gate');
    expect(out).toContain('Plan(quick)');
    expect(out).toContain('Review'); // present…
    expect(out).not.toContain('Review(security)'); // …but not the security variant
  });
});

describe('computeWaves', () => {
  test('empty queue yields no waves and no unresolved', () => {
    const { waves, unresolved } = computeWaves({});
    expect(waves).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  test('linear dependency chain becomes sequential waves', () => {
    const { waves } = computeWaves({
      '1': { status: 'ready', depends_on: [] },
      '2': { status: 'ready', depends_on: [1] },
      '3': { status: 'ready', depends_on: [2] },
    });
    expect(waves).toEqual([[1], [2], [3]]);
  });

  test('diamond dependency places shared child once, after both parents', () => {
    const { waves } = computeWaves({
      '1': { status: 'ready', depends_on: [] },
      '2': { status: 'ready', depends_on: [1] },
      '3': { status: 'ready', depends_on: [1] },
      '4': { status: 'ready', depends_on: [2, 3] },
    });
    expect(waves).toEqual([[1], [2, 3], [4]]);
  });

  test('all empty depends_on collapse to a single Wave 0', () => {
    const { waves } = computeWaves({
      '5': { status: 'ready', depends_on: [] },
      '6': { status: 'ready', depends_on: [] },
      '7': { status: 'ready' },
    });
    expect(waves).toEqual([[5, 6, 7]]);
  });

  test('dependency already merged/closed is treated as satisfied', () => {
    const { waves } = computeWaves({
      '1': { status: 'merged', depends_on: [] },
      '2': { status: 'ready', depends_on: [1] },
    });
    // merged issue #1 is excluded from waves; #2's dep is satisfied → Wave 0
    expect(waves).toEqual([[2]]);
  });

  test('circular dependency surfaces in unresolved, no infinite loop', () => {
    const { waves, unresolved } = computeWaves({
      '1': { status: 'ready', depends_on: [2] },
      '2': { status: 'ready', depends_on: [1] },
    });
    expect(waves).toEqual([]);
    expect(unresolved.sort()).toEqual([1, 2]);
  });

  test('self-cycle surfaces in unresolved without infinite loop', () => {
    const { waves, unresolved } = computeWaves({
      '1': { status: 'ready', depends_on: [1] },
    });
    expect(waves).toEqual([]);
    expect(unresolved).toEqual([1]);
  });

  test('dep id absent from the in-scope map is treated as satisfied (documented limitation)', () => {
    // #999 is out of campaign scope → not a key of issues → treated as satisfied.
    const { waves, unresolved } = computeWaves({
      '50': { status: 'ready', depends_on: [999] },
    });
    expect(waves).toEqual([[50]]);
    expect(unresolved).toEqual([]);
  });

  // Shared fixture: asserts computeWaves matches queue-dag.md § Step 4 semantics
  // (Wave 0 = empty depends_on; Wave N = deps merged/closed in prior waves).
  test('shared fixture matches queue-dag Step 4 wave numbering', () => {
    const { waves, unresolved } = computeWaves({
      '301': { status: 'ready', depends_on: [] },
      '298': { status: 'ready', depends_on: [] },
      '302': { status: 'ready', depends_on: [298] },
      '305': { status: 'ready', depends_on: [301, 302] },
    });
    expect(waves).toEqual([[298, 301], [302], [305]]);
    expect(unresolved).toEqual([]);
  });
});

describe('parseCheckpointFrontmatter', () => {
  test('parses YAML frontmatter fields', () => {
    const meta = parseCheckpointFrontmatter(`---
refreshed_at: 2026-07-05T12:00:00.000Z
orchestrator_turn_id: 7
last_completed_phase: review
---

# Campaign Checkpoint
`);
    expect(meta.orchestrator_turn_id).toBe(7);
    expect(meta.last_completed_phase).toBe('review');
  });
});

describe('groupIssuesByPhase', () => {
  test('splits active vs done and in-flight', () => {
    const grouped = groupIssuesByPhase({
      '22': { title: 'A', phase: 'review', status: 'in-flight', pr: 40 },
      '21': { title: 'B', phase: 'done', status: 'merged', pr: 41 },
      '20': { title: 'C', phase: 'implement', status: 'ready' },
      '19': { title: 'D', phase: 'plan', status: 'blocked', notes: 'overlap' },
    });
    expect(grouped.inFlight).toHaveLength(1);
    expect(grouped.done).toHaveLength(1);
    expect(grouped.ready).toHaveLength(1);
    expect(grouped.blocked).toHaveLength(1);
  });
});

describe('countLedgerByStatus', () => {
  test('counts open severities and deferred', () => {
    const counts = countLedgerByStatus([
      { status: 'open', severity: 'BLOCK' },
      { status: 'open', severity: 'WARN' },
      { status: 'deferred', severity: 'WARN', deferred_to_issue: 99 },
    ]);
    expect(counts.open).toBe(2);
    expect(counts.block).toBe(1);
    expect(counts.deferred).toBe(1);
  });
});

describe('discoveryFilings', () => {
  test('extracts deferred_to_issue rows', () => {
    const filed = discoveryFilings([
      { status: 'deferred', deferred_to_issue: 46, summary: 'Remove synth', vcode: 'V-YAGNI' },
      { status: 'open', deferred_to_issue: null },
    ]);
    expect(filed).toEqual([{ issue: 46, summary: 'Remove synth', vcode: 'V-YAGNI' }]);
  });
});

describe('formatDashboard', () => {
  const baseOpts = {
    checkpoint: { orchestrator_turn_id: 3 },
    queue: { refreshed_at: '2026-07-05T18:00:00.000Z', issues: {} },
    ledger: { findings: [] },
    forge: { openIssues: 6, openPrs: 0, ok: true },
  };

  test('renders milestone scope and in-flight table', () => {
    const out = formatDashboard({
      ...baseOpts,
      scope: { milestone: 'v0.4.2' },
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '34': {
            title: 'Model inherit',
            phase: 'plan',
            status: 'in-flight',
          },
        },
      },
    });

    expect(out).toContain('milestone **v0.4.2**');
    expect(out).toContain('Turn:** 3');
    expect(out).toContain('6 open issues');
    expect(out).toContain('### In-flight');
    expect(out).toContain('#34 Model inherit');
  });

  test('renders label scope', () => {
    const out = formatDashboard({
      ...baseOpts,
      scope: { labels: ['size:xs', 'track:standard'] },
    });

    expect(out).toContain('labels `size:xs`, `track:standard`');
  });

  test('renders blocked issues with notes', () => {
    const out = formatDashboard({
      ...baseOpts,
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '19': {
            title: 'Overlap fix',
            phase: 'plan',
            status: 'blocked',
            notes: 'awaiting-user-clarification',
          },
        },
      },
    });

    expect(out).toContain('### Blocked');
    expect(out).toContain('**#19** Overlap fix — awaiting-user-clarification');
  });

  test('renders ready issues with phase', () => {
    const out = formatDashboard({
      ...baseOpts,
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '20': { title: 'Next up', phase: 'implement', status: 'ready' },
          '21': { title: 'Another', phase: 'handle', status: 'ready' },
        },
      },
    });

    expect(out).toContain('### Ready');
    expect(out).toContain('#20 (implement)');
    expect(out).toContain('#21 (handle)');
  });

  test('renders completed queue with PR links', () => {
    const out = formatDashboard({
      ...baseOpts,
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '10': { title: 'Done', phase: 'done', status: 'merged', pr: 42 },
          '11': { title: 'Closed', phase: 'done', status: 'closed' },
        },
      },
    });

    expect(out).toContain('### Completed (queue)');
    expect(out).toContain('#10 → PR #42');
    expect(out).toContain('#11');
  });

  test('renders deferred discovery filings with vcode', () => {
    const out = formatDashboard({
      ...baseOpts,
      ledger: {
        findings: [
          {
            status: 'deferred',
            deferred_to_issue: 46,
            summary: 'Remove synth',
            vcode: 'V-YAGNI',
          },
        ],
      },
    });

    expect(out).toContain('### Issues filed (deferred discoveries)');
    expect(out).toContain('**#46** — Remove synth (`V-YAGNI`)');
  });

  test('renders ledger open with severity and issue_ref', () => {
    const out = formatDashboard({
      ...baseOpts,
      ledger: {
        findings: [
          {
            id: 'F-00001',
            status: 'open',
            vcode: 'V-SCOPE-02',
            severity: 'BLOCK',
            summary: 'Touch-path violation',
            issue_ref: 34,
          },
        ],
      },
    });

    expect(out).toContain('### Ledger open');
    expect(out).toContain('**F-00001** `V-SCOPE-02` BLOCK — Touch-path violation (#34)');
  });

  test('shows forge unavailable when gh fails', () => {
    const out = formatDashboard({
      ...baseOpts,
      forge: { openIssues: 0, openPrs: 0, ok: false, error: 'skipped' },
    });

    expect(out).toContain('**Forge:** unavailable (skipped)');
  });

  test('renders active workers from checkpoint body', () => {
    const out = formatDashboard({
      ...baseOpts,
      checkpointBody: `---
orchestrator_turn_id: 5
---

# Campaign Checkpoint

## In-flight workers

- worker_1: issue #34 (plan)
- worker_2: issue #35 (implement)

## Next actions
`,
    });

    expect(out).toContain('### Active workers');
    expect(out).toContain('worker_1: issue #34 (plan)');
    expect(out).toContain('worker_2: issue #35 (implement)');
  });

  test('renders Routing section for issues carrying a route', () => {
    const out = formatDashboard({
      ...baseOpts,
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '34': {
            title: 'Routed issue',
            phase: 'plan',
            status: 'in-flight',
            route: {
              needs_design: true,
              plan_mode: 'full',
              security_review_required: true,
              confidence: { split: 90, design: 75, plan_mode: 60, security: 88 },
            },
          },
        },
      },
    });

    expect(out).toContain('### Routing');
    expect(out).toContain('#34');
    expect(out).toContain('design-gate');
    expect(out).toContain('Review(security)');
  });

  test('omits Routing section when no issue has a route', () => {
    const out = formatDashboard({
      ...baseOpts,
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: { '34': { title: 'No route', phase: 'plan', status: 'in-flight' } },
      },
    });

    expect(out).not.toContain('### Routing');
  });

  test('renders Waves section from the dependency DAG', () => {
    const out = formatDashboard({
      ...baseOpts,
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '1': { title: 'Root', phase: 'handle', status: 'ready', depends_on: [] },
          '2': { title: 'Child', phase: 'handle', status: 'ready', depends_on: [1] },
        },
      },
    });

    expect(out).toContain('### Waves');
    expect(out).toContain('Wave 0');
    expect(out).toContain('Wave 1');
    expect(out).toContain('#1');
    expect(out).toContain('#2');
  });
});

describe('renderConfigSummary', () => {
  test('renders every campaign-shaping field at its template default for an empty config', () => {
    const out = renderConfigSummary({});

    expect(out).toContain('all open issues');
    expect(out).toContain('**Merge mode:** immediate');
    expect(out).toContain('**Parallel max:** 4');
    expect(out).toContain('**Kaizen:** disabled');
    expect(out).toContain('**Docs governance:** enabled');
    expect(out).toContain('**Incident mode:** disabled');
    expect(out).toContain('**Worker model policy:** cost-optimized');
    expect(out).toContain('**Auto-sync:** on');
    expect(out).toContain('**Adaptive routing:** on');
  });

  test('renders explicitly-set values over the defaults', () => {
    const out = renderConfigSummary({
      scope_milestone: 'v0.14.0',
      merge_mode: 'gated-batch',
      parallel_max: 2,
      kaizen: { enabled: true },
      docs_governance: { enabled: false },
      incident_mode: { enabled: true },
      worker_model_policy: 'quality-first',
      auto_sync: false,
      adaptive_routing: false,
    });

    expect(out).toContain('milestone **v0.14.0**');
    expect(out).toContain('**Merge mode:** gated-batch');
    expect(out).toContain('**Parallel max:** 2');
    expect(out).toContain('**Kaizen:** enabled');
    expect(out).toContain('**Docs governance:** disabled');
    expect(out).toContain('**Incident mode:** enabled');
    expect(out).toContain('**Worker model policy:** quality-first');
    expect(out).toContain('**Auto-sync:** off');
    expect(out).toContain('**Adaptive routing:** off');
  });

  // V-DRY-01 regression guard: the summary must not grow a second scope-label formatter that
  // can drift from the dashboard's. Both render the shared formatScopeLabel output verbatim.
  test('scope wording is byte-identical to the dashboard for the same scope', () => {
    const config = { scope_labels: ['size:xs', 'track:standard'] };
    const expected = formatScopeLabel({ labels: config.scope_labels });

    expect(expected).toBe('labels `size:xs`, `track:standard`');
    expect(renderConfigSummary(config)).toContain(expected);
    expect(
      formatDashboard({
        checkpoint: { orchestrator_turn_id: 3 },
        queue: { refreshed_at: '2026-07-05T18:00:00.000Z', issues: {} },
        ledger: { findings: [] },
        forge: { openIssues: 6, openPrs: 0, ok: true },
        scope: { labels: config.scope_labels },
      }),
    ).toContain(expected);
  });
});

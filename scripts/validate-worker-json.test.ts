import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractFromHookInput,
  extractWorkerJson,
  readTranscriptTail,
  resolveRole,
  validateWorker,
  type Role,
} from './validate-worker-json';

const root = path.resolve(import.meta.dirname, '..');
const fixturesDir = path.join(root, 'fixtures/worker-json');

const readFixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8'));

const expectValid = (role: Role, fixture: string) => {
  const data = readFixture(fixture);
  expect(validateWorker(role, data)).toEqual([]);
};

const expectInvalid = (role: Role, fixture: string) => {
  const data = readFixture(fixture);
  expect(validateWorker(role, data).length).toBeGreaterThan(0);
};

const makeBrainstormChildren = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    title: `Proposed child ${i + 1}`,
    body: `Body for proposed child ${i + 1}.`,
    acceptance_criteria: [`Criterion for child ${i + 1}`],
    size_estimate: 's',
    suggested_route: { task_type: 'feature', plan_mode: 'quick' },
    gain: 5,
    effort: 3,
  }));

describe('validateWorker planner', () => {
  test('valid ready', () => expectValid('planner', 'planner-ready.json'));
  test('valid blocked', () => expectValid('planner', 'planner-blocked.json'));
  test('invalid blocked track type confusion', () =>
    expectInvalid('planner', 'planner-blocked-track-type-confusion.json'));
  test('invalid missing plan_path on ready', () =>
    expectInvalid('planner', 'planner-ready-missing-plan-path.json'));
  test('invalid track enum', () =>
    expectInvalid('planner', 'planner-ready-invalid-track.json'));
  test('invalid ready with design track', () =>
    expectInvalid('planner', 'planner-ready-invalid-design-track.json'));
  test('valid ready skip', () => expectValid('planner', 'planner-ready-skip.json'));
  test('valid blocked design', () => expectValid('planner', 'planner-blocked-design.json'));
  test('invalid blocked design missing plan_path', () =>
    expectInvalid('planner', 'planner-blocked-design-missing-plan-path.json'));
  test('valid ready brainstorm', () => expectValid('planner', 'planner-ready-brainstorm.json'));
  test('valid blocked brainstorm', () => expectValid('planner', 'planner-blocked-brainstorm.json'));
  test('invalid ready brainstorm missing children', () =>
    expectInvalid('planner', 'planner-ready-brainstorm-missing-children.json'));
  test('invalid ready brainstorm missing artifact_path', () => {
    const errors = validateWorker('planner', {
      status: 'ready',
      plan_path: '.blackhole/plans/issue-298-brainstorm.md',
      track: 'brainstorm',
      children: [
        {
          title: 'Add CSV export',
          body: 'Users need to export the ledger as CSV.',
          acceptance_criteria: ['Export button present'],
          size_estimate: 's',
          suggested_route: { task_type: 'feature', plan_mode: 'quick' },
          gain: 6,
          effort: 3,
        },
      ],
      failing_checks: [],
      clarification_markers: 0,
    });
    expect(errors.some((e) => e.includes('artifact_path'))).toBe(true);
  });
  test('invalid ready brainstorm malformed child object', () => {
    const errors = validateWorker('planner', {
      status: 'ready',
      plan_path: '.blackhole/plans/issue-298-brainstorm.md',
      track: 'brainstorm',
      artifact_path: 'documentation/brainstorms/cashflow-v3-idea.md',
      children: [
        {
          title: 'Add CSV export',
          // missing body, acceptance_criteria, size_estimate, suggested_route, gain, effort
        },
      ],
      failing_checks: [],
      clarification_markers: 0,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
  test('valid ready brainstorm at exactly 5-children cap', () => {
    const errors = validateWorker('planner', {
      status: 'ready',
      plan_path: '.blackhole/plans/issue-298-brainstorm.md',
      track: 'brainstorm',
      artifact_path: 'documentation/brainstorms/cashflow-v3-idea.md',
      children: makeBrainstormChildren(5),
      failing_checks: [],
      clarification_markers: 0,
    });
    expect(errors).toEqual([]);
  });
  test('invalid ready brainstorm exceeds 5-children cap', () => {
    const errors = validateWorker('planner', {
      status: 'ready',
      plan_path: '.blackhole/plans/issue-298-brainstorm.md',
      track: 'brainstorm',
      artifact_path: 'documentation/brainstorms/cashflow-v3-idea.md',
      children: makeBrainstormChildren(6),
      failing_checks: [],
      clarification_markers: 0,
    });
    expect(errors.some((e) => e.includes('children') && e.includes('5'))).toBe(true);
  });
  test('invalid blocked brainstorm missing blocking_question', () => {
    const errors = validateWorker('planner', {
      status: 'blocked',
      track: 'brainstorm',
      failing_checks: ['brainstorm_confidence_below_threshold'],
      clarification_markers: 0,
    });
    expect(errors.some((e) => e.includes('blocking_question'))).toBe(true);
  });
});

describe('validateWorker implementer', () => {
  test('valid complete', () => expectValid('implementer', 'implementer-complete.json'));
  test('invalid tests_passed type', () =>
    expectInvalid('implementer', 'implementer-complete-bad-tests-passed.json'));
  test('valid complete with execution_mode', () =>
    expectValid('implementer', 'implementer-complete-execution-mode.json'));
  test('invalid execution_mode enum', () =>
    expectInvalid('implementer', 'implementer-complete-bad-execution-mode.json'));
  test('invalid execution_mode type confusion', () =>
    expectInvalid('implementer', 'implementer-complete-execution-mode-type-confusion.json'));
  test('valid complete with task_type', () =>
    expectValid('implementer', 'implementer-complete-task-type.json'));
  test('invalid task_type enum', () =>
    expectInvalid('implementer', 'implementer-complete-bad-task-type.json'));
  test('invalid task_type type confusion', () =>
    expectInvalid('implementer', 'implementer-complete-task-type-type-confusion.json'));
  test('valid blocked', () => expectValid('implementer', 'implementer-blocked.json'));
  test('valid blocked with escalation_trigger', () =>
    expectValid('implementer', 'implementer-blocked-escalation-trigger.json'));
  test('invalid escalation_trigger enum', () =>
    expectInvalid('implementer', 'implementer-blocked-bad-escalation-trigger.json'));
  test('invalid escalation_trigger type confusion', () =>
    expectInvalid('implementer', 'implementer-blocked-escalation-trigger-type-confusion.json'));
  test('invalid missing evidence on complete', () =>
    expectInvalid('implementer', 'implementer-complete-missing-evidence.json'));
  test('invalid empty evidence on complete', () =>
    expectInvalid('implementer', 'implementer-complete-empty-evidence.json'));
});

describe('validateWorker implementer decision_records[] (ADR-012 E4)', () => {
  const baseComplete = {
    status: 'complete',
    pr_number: 42,
    branch: 'blackhole/issue-42',
    tests_passed: true,
    touch_paths_honored: true,
    evidence: { command: 'bun test scripts/campaign-status.test.ts', result: '42 pass, 0 fail' },
  };

  test('accepts implementer JSON with decision_records[]', () => {
    const errors = validateWorker('implementer', {
      ...baseComplete,
      decision_records: [
        {
          pr: 42,
          kind: 'root-cause',
          touch_paths: ['src/db/client.ts'],
          decision: 'Use a prepared statement cache keyed by query shape',
          why: 'N+1 query was the actual regression, not the ORM',
        },
        {
          issue: 12,
          kind: 'reuse',
          touch_paths: ['scripts/lib/retry.ts'],
          decision: 'Reused existing retry() instead of a new backoff loop',
          why: 'Avoids a third retry implementation (V-INT-02)',
        },
      ],
    });
    expect(errors).toEqual([]);
  });

  test('accepts implementer JSON without decision_records[]', () => {
    const errors = validateWorker('implementer', { ...baseComplete });
    expect(errors).toEqual([]);
  });

  test.each([
    [
      'invalid kind',
      { pr: 1, kind: 'vibes', touch_paths: ['a.ts'], decision: 'd', why: 'w' },
      'decision_records[0].kind',
    ],
    [
      'both pr and issue absent',
      { kind: 'root-cause', touch_paths: ['a.ts'], decision: 'd', why: 'w' },
      'decision_records[0]',
    ],
    [
      'touch_paths not a string array',
      { pr: 1, kind: 'root-cause', touch_paths: 'src/x.ts', decision: 'd', why: 'w' },
      'touch_paths',
    ],
    [
      'missing decision',
      { pr: 1, kind: 'root-cause', touch_paths: ['a.ts'], why: 'w' },
      'decision',
    ],
    [
      'missing why',
      { pr: 1, kind: 'root-cause', touch_paths: ['a.ts'], decision: 'd' },
      'why',
    ],
  ])('rejects malformed decision_records[] rows: %s', (_label, row, expectedFragment) => {
    const errors = validateWorker('implementer', {
      ...baseComplete,
      decision_records: [row],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes(expectedFragment))).toBe(true);
  });
});

describe('validateWorker implementer sprint_contract_status / ac_results[] (issue #309)', () => {
  const baseComplete = {
    status: 'complete',
    pr_number: 42,
    branch: 'blackhole/issue-42',
    tests_passed: true,
    touch_paths_honored: true,
    evidence: { command: 'bun test scripts/campaign-status.test.ts', result: '42 pass, 0 fail' },
  };

  test('valid complete with sprint_contract_status PASS and ac_results[]', () =>
    expectValid('implementer', 'implementer-complete-sprint-contract-pass.json'));

  test('valid complete with sprint_contract_status N/A and no ac_results[]', () =>
    expectValid('implementer', 'implementer-complete-sprint-contract-na.json'));

  test('accepts implementer JSON without sprint_contract_status/ac_results (backward compatible)', () => {
    const errors = validateWorker('implementer', { ...baseComplete });
    expect(errors).toEqual([]);
  });

  test('invalid sprint_contract_status enum value', () =>
    expectInvalid('implementer', 'implementer-complete-bad-sprint-contract-status.json'));

  test('invalid sprint_contract_status PASS with empty ac_results[]', () => {
    const errors = validateWorker('implementer', {
      ...baseComplete,
      sprint_contract_status: 'PASS',
      ac_results: [],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('ac_results'))).toBe(true);
  });

  test('invalid sprint_contract_status PASS with ac_results absent', () => {
    const errors = validateWorker('implementer', {
      ...baseComplete,
      sprint_contract_status: 'PARTIAL',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('ac_results'))).toBe(true);
  });

  test('valid sprint_contract_status N/A with ac_results absent', () => {
    const errors = validateWorker('implementer', {
      ...baseComplete,
      sprint_contract_status: 'N/A',
    });
    expect(errors).toEqual([]);
  });

  test.each([
    [
      'invalid verdict enum',
      { criterion: 'Export button renders', check: 'bun test -t export', result: '1 pass', verdict: 'MAYBE' },
      'ac_results[0].verdict',
    ],
    [
      'missing criterion',
      { check: 'bun test -t export', result: '1 pass', verdict: 'PASS' },
      'criterion',
    ],
    [
      'missing check',
      { criterion: 'Export button renders', result: '1 pass', verdict: 'PASS' },
      'check',
    ],
    [
      'missing result',
      { criterion: 'Export button renders', check: 'bun test -t export', verdict: 'PASS' },
      'result',
    ],
    [
      'missing verdict',
      { criterion: 'Export button renders', check: 'bun test -t export', result: '1 pass' },
      'verdict',
    ],
  ])('rejects malformed ac_results[] rows: %s', (_label, row, expectedFragment) => {
    const errors = validateWorker('implementer', {
      ...baseComplete,
      sprint_contract_status: 'PASS',
      ac_results: [row],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes(expectedFragment))).toBe(true);
  });
});

describe('validateWorker reviewer', () => {
  test('valid empty findings', () =>
    expectValid('reviewer', 'reviewer-complete-empty.json'));
  test('invalid missing findings', () =>
    expectInvalid('reviewer', 'reviewer-missing-findings.json'));
  test('valid V-DOC-02/04 finding', () =>
    expectValid('reviewer', 'reviewer-complete-vdoc-finding.json'));
  test('valid V-ADA-01 finding', () =>
    expectValid('reviewer', 'reviewer-complete-vada-finding.json'));
});

describe('validateWorker router', () => {
  test('valid routed', () => expectValid('router', 'router-routed.json'));
  test('invalid task_type enum', () =>
    expectInvalid('router', 'router-routed-invalid-task-type.json'));
  test('invalid confidence out of 0-100 range', () =>
    expectInvalid('router', 'router-routed-invalid-confidence-range.json'));
  test('valid error', () => expectValid('router', 'router-error.json'));
  test('invalid error missing error field', () =>
    expectInvalid('router', 'router-error-missing-error-field.json'));
  test('valid routed with needs_analysis and analysis-landed trigger', () =>
    expectValid('router', 'router-routed-needs-analysis.json'));
});

describe('validateWorker hunter', () => {
  test('valid complete with empty findings', () => expectValid('hunter', 'hunter-complete.json'));
  test('valid complete with finding', () =>
    expectValid('hunter', 'hunter-complete-with-finding.json'));
  test('valid complete with populated findings', () =>
    expectValid('hunter', 'hunter-complete-with-findings.json'));
  test('valid error', () => expectValid('hunter', 'hunter-error.json'));
  test('invalid error missing error field', () =>
    expectInvalid('hunter', 'hunter-error-missing-error-field.json'));
  test('invalid severity enum', () =>
    expectInvalid('hunter', 'hunter-complete-invalid-severity.json'));
  test('invalid finding severity enum', () => {
    const data = readFixture('hunter-complete-invalid-severity.json');
    const errors = validateWorker('hunter', data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('findings[0].severity'))).toBe(true);
  });
  test('invalid verification enum', () =>
    expectInvalid('hunter', 'hunter-complete-invalid-verification.json'));
  test('invalid complete missing territory', () =>
    expectInvalid('hunter', 'hunter-complete-missing-territory.json'));
});

describe('validateWorker investigator', () => {
  test('valid complete research', () =>
    expectValid('investigator', 'investigator-complete-research.json'));
  test('valid complete investigate', () =>
    expectValid('investigator', 'investigator-complete-investigate.json'));
  test('valid complete analyze', () =>
    expectValid('investigator', 'investigator-complete-analyze.json'));
  test('invalid sub_mode enum', () =>
    expectInvalid('investigator', 'investigator-complete-invalid-sub-mode.json'));
  test('invalid sub_mode enum still fails against three-value SUB_MODES (regression guard)', () => {
    const data = readFixture('investigator-complete-invalid-sub-mode.json');
    expect(data.sub_mode).toBe('diagnose');
    expect(validateWorker('investigator', data).length).toBeGreaterThan(0);
  });
  test('invalid confidence out of 0-100 range', () =>
    expectInvalid('investigator', 'investigator-complete-invalid-confidence-range.json'));
  test('valid error', () => expectValid('investigator', 'investigator-error.json'));
  test('invalid error missing error field', () =>
    expectInvalid('investigator', 'investigator-error-missing-error-field.json'));
});

describe('extractWorkerJson', () => {
  test('extracts fenced json block', () => {
    const summary = `Done.\n\n\`\`\`json\n{"status":"ready","plan_path":"p.md","track":"quick","failing_checks":[],"clarification_markers":0}\n\`\`\``;
    const obj = extractWorkerJson(summary) as Record<string, unknown>;
    expect(obj.status).toBe('ready');
    expect(obj.track).toBe('quick');
  });

  test('extracts bare object via brace scan', () => {
    const summary = 'Result: {"status":"complete","pr_number":1,"branch":"b","tests_passed":true,"touch_paths_honored":true}';
    const obj = extractWorkerJson(summary) as Record<string, unknown>;
    expect(obj.status).toBe('complete');
    expect(obj.pr_number).toBe(1);
  });

  test('throws when no json found', () => {
    expect(() => extractWorkerJson('no structured output here')).toThrow();
  });
});

describe('resolveRole', () => {
  test('maps bare subagent_type', () => {
    expect(resolveRole({ subagent_type: 'planner' })).toBe('planner');
    expect(resolveRole({ subagent_type: 'implementer' })).toBe('implementer');
    expect(resolveRole({ subagent_type: 'reviewer' })).toBe('reviewer');
    expect(resolveRole({ subagent_type: 'bc-synthesizer' })).toBeNull();
  });

  test('maps plugin-scoped subagent_type', () => {
    expect(resolveRole({ subagent_type: 'blackhole:planner' })).toBe('planner');
    expect(resolveRole({ subagent_type: 'blackhole:implementer' })).toBe('implementer');
    expect(resolveRole({ subagent_type: 'blackhole:reviewer' })).toBe('reviewer');
  });

  test('maps router subagent_type', () => {
    expect(resolveRole({ subagent_type: 'router' })).toBe('router');
    expect(resolveRole({ subagent_type: 'blackhole:router' })).toBe('router');
  });

  test('maps investigator subagent_type', () => {
    expect(resolveRole({ subagent_type: 'investigator' })).toBe('investigator');
    expect(resolveRole({ subagent_type: 'blackhole:investigator' })).toBe('investigator');
  });

  test('maps hunter subagent_type', () => {
    expect(resolveRole({ subagent_type: 'hunter' })).toBe('hunter');
    expect(resolveRole({ subagent_type: 'blackhole:hunter' })).toBe('hunter');
  });

  test('returns null for non-campaign subagents', () => {
    expect(resolveRole({ subagent_type: 'generic-agent' })).toBeNull();
    expect(resolveRole({ description: 'unrelated task' })).toBeNull();
  });

  test('falls back to description/task text', () => {
    expect(resolveRole({ description: 'implementer for issue #18' })).toBe('implementer');
    expect(resolveRole({ task: 'Run reviewer on PR 42' })).toBe('reviewer');
    expect(resolveRole({ description: 'hunter quickwins wave' })).toBe('hunter');
  });
});

describe('readTranscriptTail', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-worker-json-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns only the tail bytes when file exceeds maxBytes', () => {
    const filePath = path.join(tmpDir, 'transcript.txt');
    const marker = 'TAILMARKER1234567890';
    const content = 'x'.repeat(50) + marker;
    fs.writeFileSync(filePath, content, 'utf-8');

    const tail = readTranscriptTail(filePath, marker.length);

    expect(tail).toBe(marker);
    expect(tail?.length).toBe(marker.length);
  });

  test('returns null for a missing file', () => {
    const missingPath = path.join(tmpDir, 'does-not-exist.txt');

    expect(readTranscriptTail(missingPath)).toBeNull();
  });
});

describe('extractFromHookInput', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-worker-json-hook-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('extracts JSON directly from summary when present', () => {
    const input = {
      summary: '{"status":"complete","pr_number":1,"branch":"b","tests_passed":true,"touch_paths_honored":true}',
    };

    const result = extractFromHookInput(input) as Record<string, unknown>;

    expect(result.status).toBe('complete');
    expect(result.pr_number).toBe(1);
  });

  test('falls back to transcript tail when summary has no JSON', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.txt');
    fs.writeFileSync(
      transcriptPath,
      'agent chatter before...\n{"status":"blocked","failing_checks":["x"],"clarification_markers":0}\nmore chatter',
      'utf-8',
    );
    const input = {
      summary: 'no structured output here',
      agent_transcript_path: transcriptPath,
    };

    const result = extractFromHookInput(input) as Record<string, unknown>;

    expect(result.status).toBe('blocked');
    expect(result.clarification_markers).toBe(0);
  });

  test('throws when neither summary nor transcript contain JSON', () => {
    const input = { summary: 'no structured output here' };

    expect(() => extractFromHookInput(input)).toThrow(
      'no worker JSON found in summary or transcript',
    );
  });

  test('throws when transcript path is missing on disk', () => {
    const input = {
      summary: 'no structured output here',
      agent_transcript_path: path.join(tmpDir, 'missing-transcript.txt'),
    };

    expect(() => extractFromHookInput(input)).toThrow(
      'no worker JSON found in summary or transcript',
    );
  });
});

describe('finding shape', () => {
  test('requires gain/effort for V-PARETO-02', () => {
    const errors = validateWorker('reviewer', {
      status: 'complete',
      findings: [
        {
          vcode: 'V-PARETO-02',
          severity: 'WARN',
          file: 'a.ts',
          line: 1,
          summary: 'candidate',
        },
      ],
    });
    expect(errors.some((e) => e.includes('gain'))).toBe(true);
    expect(errors.some((e) => e.includes('effort'))).toBe(true);
  });

  test('accepts V-PARETO-02 with gain and effort', () => {
    const errors = validateWorker('reviewer', {
      status: 'complete',
      findings: [
        {
          vcode: 'V-PARETO-02',
          severity: 'WARN',
          file: 'a.ts',
          line: 1,
          summary: 'candidate',
          gain: 7,
          effort: 2,
        },
      ],
    });
    expect(errors).toEqual([]);
  });
});

const scriptPath = path.join(root, 'scripts/validate-worker-json.ts');

async function runValidateWorkerCli(args: string[], stdin?: string) {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', scriptPath, ...args],
    stdin: stdin !== undefined ? new Blob([stdin]) : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: root,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

const fencedJsonSummary = (payload: unknown) =>
  `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;

const plannerHookInput = (summary: string) =>
  JSON.stringify({
    subagent_type: 'planner',
    summary,
  });

const hunterHookInput = (summary: string) =>
  JSON.stringify({
    subagent_type: 'hunter',
    summary,
  });

describe('validate-worker-json hook CLI', () => {
  test('empty stdin exits 2 with empty payload message', async () => {
    const result = await runValidateWorkerCli(['--hook'], '');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('empty payload');
  });

  test('malformed stdin JSON exits 2 with JSON parse failed message', async () => {
    const result = await runValidateWorkerCli(['--hook'], '{not json');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('JSON parse failed');
  });

  test('status error pass-through exits 0', async () => {
    const result = await runValidateWorkerCli(['--hook'], JSON.stringify({ status: 'error' }));
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('status aborted pass-through exits 0', async () => {
    const result = await runValidateWorkerCli(['--hook'], JSON.stringify({ status: 'aborted' }));
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('non-campaign subagent exits 0 without validation', async () => {
    const result = await runValidateWorkerCli(
      ['--hook'],
      JSON.stringify({ subagent_type: 'generic-agent', summary: 'unrelated work' }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('valid planner stop exits 0', async () => {
    const plannerJson = readFixture('planner-ready.json');
    const result = await runValidateWorkerCli(
      ['--hook'],
      plannerHookInput(fencedJsonSummary(plannerJson)),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('valid hunter stop exits 0', async () => {
    const hunterJson = readFixture('hunter-complete.json');
    const result = await runValidateWorkerCli(
      ['--hook'],
      hunterHookInput(fencedJsonSummary(hunterJson)),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('invalid hunter worker JSON exits 1 with validation error', async () => {
    const invalidHunter = readFixture('hunter-complete-missing-territory.json');
    const result = await runValidateWorkerCli(
      ['--hook'],
      hunterHookInput(fencedJsonSummary(invalidHunter)),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('territory');
  });

  test('invalid planner worker JSON exits 1 with validation error', async () => {
    const invalidPlanner = {
      status: 'ready',
      track: 'standard',
      failing_checks: [],
      clarification_markers: 0,
    };
    const result = await runValidateWorkerCli(
      ['--hook'],
      plannerHookInput(fencedJsonSummary(invalidPlanner)),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('plan_path');
  });

  test('no JSON in summary exits 1 with no worker JSON found', async () => {
    const result = await runValidateWorkerCli(
      ['--hook'],
      plannerHookInput('planning finished without structured output'),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no worker JSON found');
  });

  test('piped stdin without --hook flag auto-enters hook mode', async () => {
    const plannerJson = readFixture('planner-ready.json');
    const result = await runValidateWorkerCli(
      [],
      plannerHookInput(fencedJsonSummary(plannerJson)),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('valid hunter resume-signal hook fixture exits 0', async () => {
    const hookFixturePath = path.join(root, 'fixtures/resume-signal/hook-hunter-stop.json');
    const hookInput = fs.readFileSync(hookFixturePath, 'utf-8');
    const result = await runValidateWorkerCli(['--hook'], hookInput);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('invalid hunter missing kind exits 1 with validation error', async () => {
    const invalidHunter = {
      status: 'complete',
      wave: 1,
      territory: { bands_scanned: ['src/agents'], exhausted: false },
      findings: [],
    };
    const result = await runValidateWorkerCli(
      ['--hook'],
      hunterHookInput(fencedJsonSummary(invalidHunter)),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('kind');
  });

  // readStdin catch (validate-worker-json.ts:709-714) is not reachable in subprocess
  // tests — Bun.stdin.stream() does not throw under normal piped/closed stdin.
});

describe('validate-worker-json CLI mode', () => {
  test('prints usage when no role or hook flags are given', async () => {
    // Subprocess stdin is non-TTY, so argv must be non-empty to avoid auto-hook mode.
    const result = await runValidateWorkerCli(['help']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });

  test('--role without --file or --json exits 1', async () => {
    const result = await runValidateWorkerCli(['--role', 'planner']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('requires --file or --json');
  });

  test('--role planner --file valid fixture exits 0', async () => {
    const fixturePath = path.join(fixturesDir, 'planner-ready.json');
    const result = await runValidateWorkerCli(['--role', 'planner', '--file', fixturePath]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('--role planner --file invalid fixture exits 1 with validation error', async () => {
    const fixturePath = path.join(fixturesDir, 'planner-ready-missing-plan-path.json');
    const result = await runValidateWorkerCli(['--role', 'planner', '--file', fixturePath]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('plan_path');
  });

  test('--role planner --json valid payload exits 0', async () => {
    const payload = JSON.stringify(readFixture('planner-ready.json'));
    const result = await runValidateWorkerCli(['--role', 'planner', '--json', payload]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('--role planner --json invalid JSON exits 1 with parse error', async () => {
    const result = await runValidateWorkerCli(['--role', 'planner', '--json', '{bad']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('JSON Parse error');
  });

  test('--role planner --file missing path exits 1 with file read error', async () => {
    const missingPath = path.join(fixturesDir, 'does-not-exist.json');
    const result = await runValidateWorkerCli(['--role', 'planner', '--file', missingPath]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ENOENT');
  });

  test('--role hunter --file valid fixture exits 0', async () => {
    const fixturePath = path.join(fixturesDir, 'hunter-complete.json');
    const result = await runValidateWorkerCli(['--role', 'hunter', '--file', fixturePath]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  test('--role hunter --file invalid fixture exits 1 with validation error', async () => {
    const fixturePath = path.join(fixturesDir, 'hunter-error-missing-error-field.json');
    const result = await runValidateWorkerCli(['--role', 'hunter', '--file', fixturePath]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('error');
  });

  test('--role hunter --json invalid payload exits 1 with validation error', async () => {
    const payload = JSON.stringify({
      status: 'error',
      kind: 'quickwins',
      findings: [],
    });
    const result = await runValidateWorkerCli(['--role', 'hunter', '--json', payload]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('error');
  });
});

import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  extractWorkerJson,
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

describe('validateWorker planner', () => {
  test('valid ready', () => expectValid('planner', 'planner-ready.json'));
  test('valid blocked', () => expectValid('planner', 'planner-blocked.json'));
  test('invalid missing plan_path on ready', () =>
    expectInvalid('planner', 'planner-ready-missing-plan-path.json'));
  test('invalid track enum', () =>
    expectInvalid('planner', 'planner-ready-invalid-track.json'));
});

describe('validateWorker implementer', () => {
  test('valid complete', () => expectValid('implementer', 'implementer-complete.json'));
  test('invalid tests_passed type', () =>
    expectInvalid('implementer', 'implementer-complete-bad-tests-passed.json'));
});

describe('validateWorker reviewer', () => {
  test('valid empty findings', () =>
    expectValid('reviewer', 'reviewer-complete-empty.json'));
  test('invalid missing findings', () =>
    expectInvalid('reviewer', 'reviewer-missing-findings.json'));
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

  test('returns null for non-campaign subagents', () => {
    expect(resolveRole({ subagent_type: 'generic-agent' })).toBeNull();
    expect(resolveRole({ description: 'unrelated task' })).toBeNull();
  });

  test('falls back to description/task text', () => {
    expect(resolveRole({ description: 'implementer for issue #18' })).toBe('implementer');
    expect(resolveRole({ task: 'Run reviewer on PR 42' })).toBe('reviewer');
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

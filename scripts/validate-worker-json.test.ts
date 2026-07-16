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

  test('returns null for non-campaign subagents', () => {
    expect(resolveRole({ subagent_type: 'generic-agent' })).toBeNull();
    expect(resolveRole({ description: 'unrelated task' })).toBeNull();
  });

  test('falls back to description/task text', () => {
    expect(resolveRole({ description: 'implementer for issue #18' })).toBe('implementer');
    expect(resolveRole({ task: 'Run reviewer on PR 42' })).toBe('reviewer');
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

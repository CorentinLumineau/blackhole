import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findHarnessTokenLeaks,
  runChecks,
  validatePhaseNames,
  validatePlanArtifacts,
  validateSkillModes,
  validateVcodeReferences,
} from './checks/playbook.check.ts';
import { PHASE_PLAYBOOK_FILES } from './build.ts';

describe('findHarnessTokenLeaks (V-HARNESS-01 — #245)', () => {
  test('fail-closed: appendix marker absent treats the whole file as core — a stray token anywhere fails', () => {
    const content = [
      '# Claude Code-Native Orchestration (Pattern C)',
      '',
      '## Capability matrix (core — harness-neutral)',
      '',
      '| C1 | A fan-out mechanism with wave barriers |',
      '',
      'Some later prose that mentions the `Workflow tool` without any appendix marker present.',
    ].join('\n');

    const leaks = findHarnessTokenLeaks(content);
    expect(leaks.length).toBe(1);
    expect(leaks[0]).toContain('Workflow tool');
  });

  test('returns [] for a clean harness-neutral core with tokens confined to the appendix', () => {
    const content = [
      '# Claude Code-Native Orchestration (Pattern C)',
      '',
      '## Capability matrix (core — harness-neutral)',
      '',
      '| Capability | What it provides |',
      '| C1 | A fan-out mechanism with wave barriers |',
      '',
      '## Per-harness mapping appendix',
      '',
      '{{#claude}}',
      '### Claude Code',
      'C1 uses the `Workflow` tool (`parallel()` / `pipeline()`).',
      'C3 is the `AskUserQuestion` tool. Resume uses `resumeFromRunId` and `subagentStop`.',
      '{{/claude}}',
    ].join('\n');

    expect(findHarnessTokenLeaks(content)).toEqual([]);
  });

  test('returns one [token@context] entry per leaked token found before the appendix marker', () => {
    const content = [
      '# Claude Code-Native Orchestration (Pattern C)',
      '',
      '## Capability matrix (core — harness-neutral)',
      '',
      'C1 is the `Workflow tool` fan-out primitive with `parallel(` batches.',
      '',
      '## Per-harness mapping appendix',
      '',
      '{{#claude}}',
      'C3 is the `AskUserQuestion` tool.',
      '{{/claude}}',
    ].join('\n');

    const leaks = findHarnessTokenLeaks(content);
    expect(leaks).toEqual([
      'Workflow tool@C1 is the `Workflow tool` fan-out primitive with `parallel(` batches.',
      'parallel(@C1 is the `Workflow tool` fan-out primitive with `parallel(` batches.',
    ]);
  });

  test('returns [] when the appendix marker is absent but no leak tokens appear anywhere', () => {
    const content = '# Title\n\nHarness-neutral prose with no per-harness tool tokens.';
    expect(findHarnessTokenLeaks(content)).toEqual([]);
  });
});

describe('validatePhaseNames (V-PHASE-01 — #372)', () => {
  const phaseNames = ['handle', 'plan', 'implement', 'review', 'done'] as const;

  const passingPlaybooks = Object.fromEntries(
    PHASE_PLAYBOOK_FILES.map((file, i) => [file, `Phase playbook references ${phaseNames[i % phaseNames.length]}.`]),
  ) as Record<string, string>;

  const passingQueueDag = phaseNames.map((p) => `The \`${p}\` phase is documented here.`).join('\n');

  test('pass: every playbook cites a phase name and queue-dag wraps each phase in backticks', () => {
    const result = validatePhaseNames(passingPlaybooks, passingQueueDag, phaseNames);
    expect(result).toEqual({ id: 'V-PHASE-01', ok: true });
  });

  test('fail playbook: one file with zero phase-name hits cites that file', () => {
    const playbooks = {
      ...passingPlaybooks,
      'phase-handle.md': 'No phase vocabulary in this stub.',
    };
    const result = validatePhaseNames(playbooks, passingQueueDag, phaseNames);
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-PHASE-01');
    expect(result.detail).toContain('phase-handle.md');
    expect(result.detail).toContain('no phase name references');
  });

  test('fail queue-dag: playbooks pass but queue-dag omits one phase', () => {
    const queueDag = phaseNames
      .filter((p) => p !== 'review')
      .map((p) => `Phase \`${p}\` is listed.`)
      .join('\n');
    const result = validatePhaseNames(passingPlaybooks, queueDag, phaseNames);
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-PHASE-01');
    expect(result.detail).toContain('queue-dag.md');
    expect(result.detail).toContain('review');
  });
});

describe('validateVcodeReferences (V-VCODE-01 — #372)', () => {
  test('pass: corpus references most v-codes (under 50% unreferenced threshold)', () => {
    const vcodesContent = [
      '| Code | Description |',
      '| V-TEST-01 | First |',
      '| V-TEST-02 | Second |',
      '| V-TEST-03 | Third |',
    ].join('\n');
    const corpus = 'Agents cite V-TEST-01 and V-TEST-02 in prose.';
    const result = validateVcodeReferences(vcodesContent, corpus);
    expect(result).toEqual({ id: 'V-VCODE-01', ok: true });
  });

  test('fail: many unreferenced codes when corpus is empty', () => {
    const vcodesContent = [
      '| Code | Description |',
      '| V-ALPHA-01 | Alpha |',
      '| V-BETA-02 | Beta |',
      '| V-GAMMA-03 | Gamma |',
    ].join('\n');
    const result = validateVcodeReferences(vcodesContent, '');
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-VCODE-01');
    expect(result.detail).toMatch(/unreferenced/i);
  });
});

describe('validatePlanArtifacts (V-PLAN-01 — #372)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const makeTempCampaign = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playbook-plan-'));
    tempDirs.push(dir);
    return dir;
  };

  test('skip: absent queue file returns ok without scanning plans', () => {
    const campaignDir = makeTempCampaign();
    const queueFile = path.join(campaignDir, 'queue.json');
    const result = validatePlanArtifacts(campaignDir, queueFile, campaignDir);
    expect(result).toEqual({ id: 'V-PLAN-01', ok: true });
  });

  test('fail: malformed queue JSON cites invalid JSON', () => {
    const campaignDir = makeTempCampaign();
    const queueFile = path.join(campaignDir, 'queue.json');
    fs.writeFileSync(queueFile, '{ not valid json');
    const result = validatePlanArtifacts(campaignDir, queueFile, campaignDir);
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-PLAN-01');
    expect(result.detail).toContain('invalid JSON');
  });

  test('fail: in-flight plan entry without plans/issue-N.md cites issue id and path', () => {
    const campaignDir = makeTempCampaign();
    const queueFile = path.join(campaignDir, 'queue.json');
    fs.writeFileSync(
      queueFile,
      JSON.stringify({
        issues: {
          '42': { phase: 'plan', status: 'in-flight' },
        },
      }),
    );
    const result = validatePlanArtifacts(campaignDir, queueFile, campaignDir);
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-PLAN-01');
    expect(result.detail).toContain('issue #42');
    expect(result.detail).toContain('plans/issue-42.md');
  });

  test('pass: in-flight review entry with matching plan artifact on disk', () => {
    const campaignDir = makeTempCampaign();
    const queueFile = path.join(campaignDir, 'queue.json');
    const plansDir = path.join(campaignDir, 'plans');
    fs.mkdirSync(plansDir);
    fs.writeFileSync(path.join(plansDir, 'issue-99.md'), '# Plan for issue 99');
    fs.writeFileSync(
      queueFile,
      JSON.stringify({
        issues: {
          '99': { phase: 'review', status: 'in-flight' },
        },
      }),
    );
    const result = validatePlanArtifacts(campaignDir, queueFile, campaignDir);
    expect(result).toEqual({ id: 'V-PLAN-01', ok: true });
  });
});

describe('validateSkillModes (V-SKILL-01 — #372)', () => {
  const passingSkill = [
    'Modes: run, status, handle, plan, implement, review, campaign-audit.',
    'Phases: phase-handle, phase-plan, phase-implement, phase-review, phase-loop.',
  ].join('\n');

  test('pass: all required modes and phase refs present', () => {
    const result = validateSkillModes(passingSkill);
    expect(result).toEqual({ id: 'V-SKILL-01', ok: true });
  });

  test('fail: missing mode and phase ref are listed in detail', () => {
    const skill = 'Only run and phase-handle are mentioned.';
    const result = validateSkillModes(skill);
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-SKILL-01');
    expect(result.detail).toMatch(/missing modes/i);
    expect(result.detail).toMatch(/missing phase refs/i);
    expect(result.detail).toContain('status');
    expect(result.detail).toContain('phase-plan');
  });
});

describe('playbook runChecks() against the real tree', () => {
  test('returns five CheckResult entries in expected order', () => {
    const results = runChecks();
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.id)).toEqual([
      'V-PHASE-01',
      'V-VCODE-01',
      'V-PLAN-01',
      'V-SKILL-01',
      'V-HARNESS-01',
    ]);
  });

  test('all checks pass against the current tree', () => {
    const results = runChecks();
    for (const result of results) {
      expect(result.detail ?? '').toBe(result.ok ? '' : result.detail);
      expect(result.ok).toBe(true);
    }
  });
});

import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { walkMdFilesAbs, findMissingGateMarkers, isAgentCountError, findHarnessTokenLeaks } from './verify.ts';
import { codexTreeErrors } from './tree-shape.ts';
import { AGENT_YAML_FILES } from './build.ts';

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-verify-vcode-test-'));

describe('walkMdFilesAbs', () => {
  test('survives a subdirectory containing an .md file without throwing EISDIR (#216)', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'top-level.md'), '# top\nV-TOP-01\n');
      fs.mkdirSync(path.join(dir, 'nested'));
      fs.writeFileSync(path.join(dir, 'nested', 'child.md'), '# nested\nV-NESTED-01\n');

      expect(() => walkMdFilesAbs(dir)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns both the top-level and nested .md files, readable without error', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'top-level.md'), '# top\nV-TOP-01\n');
      fs.mkdirSync(path.join(dir, 'nested'));
      fs.writeFileSync(path.join(dir, 'nested', 'child.md'), '# nested\nV-NESTED-01\n');

      const files = walkMdFilesAbs(dir);
      expect(files.sort()).toEqual(
        [path.join(dir, 'top-level.md'), path.join(dir, 'nested', 'child.md')].sort()
      );

      const corpus = files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
      expect(corpus).toContain('V-TOP-01');
      expect(corpus).toContain('V-NESTED-01');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ignores non-.md files and returns [] for a directory that does not exist', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'not markdown');
      expect(walkMdFilesAbs(dir)).toEqual([]);
      expect(walkMdFilesAbs(path.join(dir, 'does-not-exist'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('findMissingGateMarkers', () => {
  test('returns the subset of required markers absent from content', () => {
    const content = '5-step gate\n**IDENTIFY** — what needs verification?\n**RUN** — execute now.';
    const required = ['5-step gate', '**IDENTIFY**', '**RUN**', '**READ**', '**VERIFY**', '**CLAIM**'];
    expect(findMissingGateMarkers(content, required)).toEqual(['**READ**', '**VERIFY**', '**CLAIM**']);
  });

  test('returns [] when all required markers are present', () => {
    const content = '5-step gate\n**IDENTIFY**\n**RUN**\n**READ**\n**VERIFY**\n**CLAIM**';
    const required = ['5-step gate', '**IDENTIFY**', '**RUN**', '**READ**', '**VERIFY**', '**CLAIM**'];
    expect(findMissingGateMarkers(content, required)).toEqual([]);
  });
});

describe('isAgentCountError (V-CODEX-04 filter — #234)', () => {
  test('matches the real agent-count mismatch message codexTreeErrors emits', () => {
    // Simulate codexTreeErrors output with a mismatch: pass zero agent files against the real
    // expected count derived from AGENT_YAML_FILES (SSOT, no hardcoded literal — V-DRY-03).
    // A nonexistent root means the SKILL.md/references checks also fire, giving us unrelated
    // messages in the same array to prove the filter discriminates correctly.
    const bogusRoot = path.join(os.tmpdir(), 'blackhole-verify-vcodex04-nonexistent-root');
    const errors = codexTreeErrors(bogusRoot, [], AGENT_YAML_FILES.size);

    const countError = errors.find((e) => e.includes('agent YAML files'));
    expect(countError).toBeDefined();
    expect(countError).toBe(`Codex: expected ${AGENT_YAML_FILES.size} agent YAML files, got 0`);
    expect(isAgentCountError(countError!)).toBe(true);
  });

  test('does not match unrelated codexTreeErrors messages (SKILL.md / references / per-file)', () => {
    expect(isAgentCountError('Codex: missing codex-skills/blackhole/SKILL.md')).toBe(false);
    expect(isAgentCountError('Codex: missing or empty codex-skills/blackhole/references/')).toBe(false);
    expect(isAgentCountError('Codex: some-agent.yaml missing instructions block scalar')).toBe(false);
  });
});

describe('findHarnessTokenLeaks (V-HARNESS-01 — #245)', () => {
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

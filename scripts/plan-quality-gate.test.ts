import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { extractSection, findMissingAcMapping } from './plan-quality-gate.ts';

// Issue #716 (R-11) — the CLI wrapping plan-quality-gate.check.ts's exported detectors
// (findMissingCriticalFiles, findVagueMitigations) plus this file's own findMissingAcMapping
// against a real plan file on disk. planner.md Step 8 invokes this CLI instead of re-deriving
// the three checks in prose — see scripts/plan-quality-gate.ts's header for the wiring.

describe('findMissingAcMapping', () => {
  test('a task missing **AC**: is flagged', () => {
    const section = ['## Task Breakdown', '1. **First task** — do the first thing.'].join('\n');
    expect(findMissingAcMapping(section)).toEqual(['First task']);
  });

  test('a task carrying **AC**: is not flagged', () => {
    const section = [
      '## Task Breakdown',
      '1. **First task** — do the thing. — **AC**: `bun test` passes.',
    ].join('\n');
    expect(findMissingAcMapping(section)).toEqual([]);
  });

  test('mixed: only the task missing the marker is flagged', () => {
    const section = [
      '## Task Breakdown',
      '1. **First task** — no marker here.',
      '2. **Second task** — has one. — **AC**: `wc -l` reports 5.',
    ].join('\n');
    expect(findMissingAcMapping(section)).toEqual(['First task']);
  });

  test('empty section returns []', () => {
    expect(findMissingAcMapping('## Task Breakdown\n')).toEqual([]);
  });
});

describe('extractSection', () => {
  test('extracts a section bounded by the next ## heading', () => {
    const content = [
      '## Objective',
      'objective text',
      '## Critical Files',
      '- `src/foo.ts`',
      '## Codebase Conventions',
      'conventions text',
    ].join('\n');
    const section = extractSection(content, 'Critical Files');
    expect(section).toContain('src/foo.ts');
    expect(section).not.toContain('objective text');
    expect(section).not.toContain('conventions text');
  });

  test('extracts a section that runs to EOF (no following heading)', () => {
    const content = ['## Objective', 'objective text', '## Task Breakdown', '1. **Task** — text.'].join(
      '\n'
    );
    const section = extractSection(content, 'Task Breakdown');
    expect(section).toContain('**Task**');
  });

  test('a missing heading returns an empty string', () => {
    expect(extractSection('## Objective\ntext\n', 'Critical Files')).toBe('');
  });
});

const scriptPath = path.join(path.resolve(import.meta.dirname), 'plan-quality-gate.ts');

const run = (args: string[]) =>
  Bun.spawn(['bun', 'run', scriptPath, ...args], { stdout: 'pipe', stderr: 'pipe' });

describe('plan-quality-gate CLI — argv parsing', () => {
  test('missing --plan-file exits 2 with usage on stderr', async () => {
    const proc = run([]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });
});

describe('plan-quality-gate CLI — end to end', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir('plan-quality-gate-cli');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('prints JSON with exactly the three boolean keys, all true for a clean fixture', async () => {
    const planPath = path.join(dir, 'plan.md');
    fs.writeFileSync(
      planPath,
      [
        '## Critical Files',
        '- `package.json`',
        '## Execution Strategy & Stop Conditions',
        '- If lint fails, block the merge.',
        '## Task Breakdown',
        '1. **First task** — do it. — **AC**: `bun test` passes.',
      ].join('\n')
    );

    const proc = run(['--plan-file', planPath]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(Object.keys(result).sort()).toEqual([
      'ac_mapping',
      'critical_files_exist',
      'mitigation_concrete',
    ]);
    expect(result).toEqual({ ac_mapping: true, critical_files_exist: true, mitigation_concrete: true });
  });

  test('flags a nonexistent critical file, a vague mitigation, and a missing AC marker', async () => {
    const planPath = path.join(dir, 'plan.md');
    fs.writeFileSync(
      planPath,
      [
        '## Critical Files',
        '- `does/not/exist.ts`',
        '## Execution Strategy & Stop Conditions',
        '- Monitor the rollout.',
        '## Task Breakdown',
        '1. **First task** — no marker here.',
      ].join('\n')
    );

    const proc = run(['--plan-file', planPath]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toEqual({
      ac_mapping: false,
      critical_files_exist: false,
      mitigation_concrete: false,
    });
  });

  test('a plan with no matching sections passes all three trivially', async () => {
    const planPath = path.join(dir, 'plan.md');
    fs.writeFileSync(planPath, '## Objective\nQuick track, no Standard-only sections.\n');

    const proc = run(['--plan-file', planPath]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      ac_mapping: true,
      critical_files_exist: true,
      mitigation_concrete: true,
    });
  });
});

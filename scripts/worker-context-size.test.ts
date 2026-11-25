import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AGENT_NAMES } from './lib/build/facts.ts';
import { computeAgentTokens, estimateTokens, MANDATORY_READS, sizeReport } from './worker-context-size.ts';

const root = path.resolve(import.meta.dirname, '..');

// Issue #1387 — the worker-context size report. Every figure is bytes / 4, an estimate and not
// tokenizer output; the ceiling test below is what turns the saving into a regression guard.

// Reviewer definition ceiling after the on-demand split. The pre-split compiled definition was
// 22,247 estimated tokens (88,990 bytes), so this is a falsifiable bound, not a restated total.
const REVIEWER_TOKEN_CEILING = 13_000;

const tmpRoot = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcs-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
};

describe('estimateTokens', () => {
  test('floors bytes / 4 so the plan baseline of 88,990 bytes reads 22,247', () => {
    expect(estimateTokens(88_990)).toBe(22_247);
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(3)).toBe(0);
  });
});

describe('computeAgentTokens', () => {
  test('measures the byte length of the named file under the given root', () => {
    const dir = tmpRoot({ 'agents/reviewer.md': 'x'.repeat(400) });
    expect(computeAgentTokens('agents/reviewer.md', dir)).toBe(100);
  });

  test('counts multi-byte characters by bytes, not by code points', () => {
    const dir = tmpRoot({ 'agents/a.md': '§'.repeat(40) });
    expect(computeAgentTokens('agents/a.md', dir)).toBe(20);
  });

  test('a missing file is an error, never a silent zero', () => {
    expect(() => computeAgentTokens('agents/none.md', tmpRoot({}))).toThrow(/none\.md/);
  });
});

describe('sizeReport', () => {
  test('lists every agent definition and every mandatory-read file with tokens and bytes', () => {
    const dir = tmpRoot({
      ...Object.fromEntries(AGENT_NAMES.map((n) => [`agents/${n}.md`, 'a'.repeat(4)])),
      'agents/reviewer.md': 'r'.repeat(80),
      'agents/implementer.md': 'i'.repeat(40),
      ...Object.fromEntries(MANDATORY_READS.map((f) => [f, 'm'.repeat(8)])),
    });
    const report = sizeReport(dir);
    expect(report.estimate).toBe('bytes/4');
    expect(report.agents.reviewer).toEqual({ bytes: 80, tokens: 20 });
    expect(report.agents.implementer).toEqual({ bytes: 40, tokens: 10 });
    for (const f of MANDATORY_READS) expect(report.reads[f]).toEqual({ bytes: 8, tokens: 2 });
  });

  test('live tree: all eight agents and the four mandatory reads are measured', () => {
    const report = sizeReport(root);
    expect(Object.keys(report.agents).sort()).toEqual([
      'coordinator', 'hunter', 'implementer', 'investigator', 'orchestrator', 'planner', 'reviewer', 'router',
    ]);
    expect(Object.keys(report.reads).sort()).toEqual([...MANDATORY_READS].sort());
  });

  test('live tree: the reviewer definition stays at or below the ceiling', () => {
    expect(sizeReport(root).agents.reviewer.tokens).toBeLessThanOrEqual(REVIEWER_TOKEN_CEILING);
  });
});

describe('CLI', () => {
  test('--json prints parseable JSON with the reviewer token figure', () => {
    const run = Bun.spawnSync(['bun', 'run', path.join(root, 'scripts/worker-context-size.ts'), '--json'], { cwd: root });
    expect(run.exitCode).toBe(0);
    const parsed = JSON.parse(run.stdout.toString());
    expect(parsed.agents.reviewer.tokens).toBeLessThanOrEqual(REVIEWER_TOKEN_CEILING);
    expect(parsed.estimate).toBe('bytes/4');
  });

  test('an unknown flag exits 2 with the usage line', () => {
    const run = Bun.spawnSync(['bun', 'run', path.join(root, 'scripts/worker-context-size.ts'), '--bogus'], { cwd: root });
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain('usage:');
  });
});

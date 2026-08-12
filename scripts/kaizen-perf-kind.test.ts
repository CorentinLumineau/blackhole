import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Regression/structural tests locking in the `perf` kaizen hunt kind (issue #652, ADR-006
// deferred seam): a hunt kind that audits runtime hot paths with measurement evidence — Option C
// hybrid (static V-PERF-01 heuristics v1 primary + regression when plan Performance Budget
// exists). Pure additive extension: no new scoring formula, no new ledger field, no severity
// floor, calibration table never assigns BLOCK.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('fixtures/config.example.json — kaizen.kinds includes perf', () => {
  const config = JSON.parse(read('fixtures/config.example.json'));

  test('kaizen.kinds is an array containing "perf"', () => {
    expect(Array.isArray(config.kaizen.kinds)).toBe(true);
    expect(config.kaizen.kinds).toContain('perf');
  });
});

describe('config-template.md — perf kind registration', () => {
  const template = read('src/references/config-template.md');

  test('default kaizen.kinds JSON example block contains "perf"', () => {
    const jsonBlockMatch = template.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonBlockMatch).not.toBeNull();
    const jsonBlock = jsonBlockMatch![1];
    expect(jsonBlock).toContain('"kaizen"');
    expect(jsonBlock).toContain('"perf"');
  });

  test('kaizen.kinds prose row documents perf', () => {
    const rowMatch = template.match(/\| `kaizen\.kinds` \|.*\|\n/);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('perf');
  });
});

describe('src/agents/hunter.md — perf kind registration', () => {
  const hunter = read('src/agents/hunter.md');

  test('inline kind-example list contains `perf`', () => {
    const paragraphMatch = hunter.match(/kaizen\.kinds.*?e\.g\.[\s\S]*?\)\s*is set by an explicit/);
    expect(paragraphMatch).not.toBeNull();
    expect(paragraphMatch![0]).toContain('`perf`');
  });
});

describe('src/references/hunt/perf.md — kind reference file', () => {
  const filePath = 'src/references/hunt/perf.md';

  test('file exists', () => {
    expect(fs.existsSync(path.join(root, filePath))).toBe(true);
  });

  test('content-shape: required sections, scoring formula, and dual CONFIRMED paths', () => {
    const content = read(filePath);

    expect(content).toContain('## Territory bands');
    expect(content).toContain('## Scan heuristics');
    expect(content).toContain('## Calibration table');
    expect(content).toContain('## Scoring — V-PARETO-02 SSOT');
    expect(content).toContain('Priority = Gain * (11 - Effort)');
    expect(content).toContain('## No-baseline degradation');
    expect(content).toMatch(/Path 1|Static hot-path/i);
    expect(content).toMatch(/Path 2|Regression/i);
  });

  test('calibration table never assigns severity BLOCK', () => {
    const content = read(filePath);

    const sectionMatch = content.match(/## Calibration table\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const tableRows = sectionMatch![1]
      .split('\n')
      .filter((line) => line.trim().startsWith('|'));
    expect(tableRows.length).toBeGreaterThan(0);
    for (const row of tableRows) {
      expect(row).not.toContain('BLOCK');
    }
  });
});

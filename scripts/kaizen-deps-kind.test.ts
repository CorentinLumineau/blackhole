import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Regression/structural tests locking in the `deps` kaizen hunt kind (issue #651, ADR-006 §
// Hunt kinds deferred seam): a hunt kind that audits unused, outdated, and duplicate/redundant
// npm/bun dependencies. Pure additive extension: no new scoring formula, no new ledger field,
// no new severity tier.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('fixtures/config.example.json — kaizen.kinds includes deps', () => {
  const config = JSON.parse(read('fixtures/config.example.json'));

  test('kaizen.kinds is an array containing "deps"', () => {
    expect(Array.isArray(config.kaizen.kinds)).toBe(true);
    expect(config.kaizen.kinds).toContain('deps');
  });
});

describe('config-template.md — deps kind registration', () => {
  const template = read('src/references/config-template.md');

  test('default kaizen.kinds JSON example block contains "deps"', () => {
    const jsonBlockMatch = template.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonBlockMatch).not.toBeNull();
    const jsonBlock = jsonBlockMatch![1];
    expect(jsonBlock).toContain('"kaizen"');
    expect(jsonBlock).toContain('"deps"');
  });

  test('kaizen.kinds prose row documents deps', () => {
    const rowMatch = template.match(/\| `kaizen\.kinds` \|.*\|\n/);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('deps');
  });
});

describe('src/agents/hunter.md — deps kind registration', () => {
  const hunter = read('src/agents/hunter.md');

  test('inline kind-example list contains `deps`', () => {
    // The `e.g. \`quickwins\`, ...` list wraps across two markdown source lines (one prose
    // paragraph) — match the paragraph as a block rather than a single physical line.
    const paragraphMatch = hunter.match(/kaizen\.kinds.*?e\.g\.[\s\S]*?\)\s*is set by an explicit/);
    expect(paragraphMatch).not.toBeNull();
    expect(paragraphMatch![0]).toContain('`deps`');
  });
});

describe('src/references/hunt/deps.md — kind reference file', () => {
  const filePath = 'src/references/hunt/deps.md';

  test('file exists', () => {
    expect(fs.existsSync(path.join(root, filePath))).toBe(true);
  });

  test('content-shape: required sections, scoring formula, and dependency heuristics', () => {
    const content = read(filePath);

    expect(content).toContain('## Scan heuristics');
    expect(content).toContain('## Calibration table');
    expect(content).toContain('## Scoring — V-PARETO-02 SSOT');
    expect(content).toContain('Priority = Gain * (11 - Effort)');
  });

  test('calibration table never assigns severity BLOCK', () => {
    const content = read(filePath);

    const sectionMatch = content.match(/## Calibration table\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    // Scope strictly to `|`-prefixed table rows — the prose surrounding the table may
    // legitimately discuss the word "BLOCK" (e.g. explaining this kind never assigns it);
    // only the table's own Severity range column values are the assertion's target.
    const tableRows = sectionMatch![1]
      .split('\n')
      .filter((line) => line.trim().startsWith('|'));
    expect(tableRows.length).toBeGreaterThan(0);
    for (const row of tableRows) {
      expect(row).not.toContain('BLOCK');
    }
  });
});

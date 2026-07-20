import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Regression/structural tests locking in Milestone 5's `parity` kaizen hunt kind
// (mercure-parity-program initiative, ADR-013 D1 / Migration Plan step 5, brainstorm F6):
// a 7th hunt kind that audits a campaign's own produced output — artifact set per route,
// doc frontmatter governance, and enforcement evidence in PR bodies — against `PM-NNN`
// provenance read from the (read-only) parity matrix. Pure additive extension: no new
// scoring formula, no new ledger field, no new severity tier (`milestone-5.md` § Objective).

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('fixtures/config.example.json — kaizen.kinds includes parity', () => {
  const config = JSON.parse(read('fixtures/config.example.json'));

  test('kaizen.kinds is an array containing "parity"', () => {
    expect(Array.isArray(config.kaizen.kinds)).toBe(true);
    expect(config.kaizen.kinds).toContain('parity');
  });
});

describe('config-template.md — parity kind registration', () => {
  const template = read('src/references/config-template.md');

  test('default kaizen.kinds JSON example block contains "parity"', () => {
    const jsonBlockMatch = template.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonBlockMatch).not.toBeNull();
    const jsonBlock = jsonBlockMatch![1];
    expect(jsonBlock).toContain('"kaizen"');
    expect(jsonBlock).toContain('"parity"');
  });

  test('kaizen.kinds prose row documents parity', () => {
    const rowMatch = template.match(/\| `kaizen\.kinds` \|.*\|\n/);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('parity');
  });
});

describe('src/agents/hunter.md — parity kind registration', () => {
  const hunter = read('src/agents/hunter.md');

  test('inline kind-example list contains `parity`', () => {
    const lines = hunter.split('\n');
    const kindListLine = lines.find((l) => l.includes('kaizen.kinds') && l.includes('e.g.'));
    expect(kindListLine).toBeDefined();
    expect(kindListLine).toContain('`parity`');
  });
});

describe('src/references/hunt/parity.md — kind reference file', () => {
  const filePath = 'src/references/hunt/parity.md';

  test('file exists', () => {
    expect(fs.existsSync(path.join(root, filePath))).toBe(true);
  });

  test('content-shape: required sections, scoring formula, and PM-NNN provenance', () => {
    const content = read(filePath);

    expect(content).toContain('## Scan heuristics');
    expect(content).toContain('## Calibration table');
    expect(content).toContain('## Scoring — V-PARETO-02 SSOT');
    expect(content).toContain('Priority = Gain * (11 - Effort)');
    expect(content).toMatch(/PM-\d{3}/);
  });

  test('calibration table never assigns severity BLOCK', () => {
    const content = read(filePath);

    const tableMatch = content.match(/## Calibration table\n([\s\S]*?)(\n## |$)/);
    expect(tableMatch).not.toBeNull();
    const tableSection = tableMatch![1];
    expect(tableSection).not.toContain('BLOCK');
  });
});

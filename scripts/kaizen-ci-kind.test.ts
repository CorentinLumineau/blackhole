import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Regression/structural tests locking in issue #650's `ci` kaizen hunt kind: CI/CD pipeline
// speed, cost, and YAML-verifiable hygiene across GitHub Actions, Gitea Actions, and GitLab CI
// (detected from on-disk config, not from blackhole's `forge:` field). Mirrors
// `scripts/kaizen-backlog-kind.test.ts` / `scripts/kaizen-parity-kind.test.ts`: an 11th hunt
// kind, pure additive extension — no new scoring formula, no new ledger field, no new
// orchestrator/hunter/`hunt_state` mechanic, no companion-file scaffold, no severity floor.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('fixtures/config.example.json — kaizen.kinds includes ci', () => {
  const config = JSON.parse(read('fixtures/config.example.json'));

  test('kaizen.kinds is an array containing "ci"', () => {
    expect(Array.isArray(config.kaizen.kinds)).toBe(true);
    expect(config.kaizen.kinds).toContain('ci');
  });
});

describe('config-template.md — ci kind registration', () => {
  const template = read('src/references/config-template.md');

  test('default kaizen.kinds JSON example block contains "ci"', () => {
    const jsonBlockMatch = template.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonBlockMatch).not.toBeNull();
    const jsonBlock = jsonBlockMatch![1];
    expect(jsonBlock).toContain('"kaizen"');
    expect(jsonBlock).toContain('"ci"');
  });

  test('kaizen.kinds prose row documents ci', () => {
    const rowMatch = template.match(/\| `kaizen\.kinds` \|.*\|\n/);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('ci');
  });
});

describe('src/agents/hunter.md — ci kind registration', () => {
  const hunter = read('src/agents/hunter.md');

  test('inline kind-example list contains `ci`', () => {
    const paragraphMatch = hunter.match(/kaizen\.kinds.*?e\.g\.[\s\S]*?\)\s*is set by an explicit/);
    expect(paragraphMatch).not.toBeNull();
    expect(paragraphMatch![0]).toContain('`ci`');
  });
});

describe('src/references/hunt/ci.md — kind reference file', () => {
  const filePath = 'src/references/hunt/ci.md';

  test('file exists', () => {
    expect(fs.existsSync(path.join(root, filePath))).toBe(true);
  });

  test('content-shape: required sections + scoring formula', () => {
    const content = read(filePath);

    expect(content).toContain('## Scan heuristics');
    expect(content).toContain('## Calibration table');
    expect(content).toContain('## Scoring — V-PARETO-02 SSOT');
    expect(content).toContain('Priority = Gain * (11 - Effort)');
  });

  test('detects GitHub Actions, Gitea Actions, and GitLab CI from on-disk config', () => {
    const content = read(filePath);

    const sectionMatch = content.match(/## Scan heuristics\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const section = sectionMatch![1];
    expect(section).toMatch(/\.github\/workflows/);
    expect(section).toMatch(/\.gitea\/workflows/);
    expect(section).toMatch(/\.gitlab-ci\.yml/);
  });

  test('scan heuristics cover speed/cost plus YAML-verifiable hygiene', () => {
    const content = read(filePath);

    const sectionMatch = content.match(/## Scan heuristics\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const section = sectionMatch![1];
    expect(section).toMatch(/cache/i);
    expect(section).toMatch(/concurrency|interruptible/i);
    expect(section).toMatch(/path filter|paths:|rules:.*changes/i);
    expect(section).toMatch(/timeout/i);
    expect(section).toMatch(/duplicate|needs:/i);
    expect(section).toMatch(/matrix/i);
    expect(section).toMatch(/unpin|@main|@master/i);
    expect(section).toMatch(/permissions/i);
    expect(section).toMatch(/artifact|expire_in|retention/i);
  });

  test('## No-CI degradation exists and is a logged no-op, not a dry wave', () => {
    const content = read(filePath);

    expect(content).toContain('## No-CI degradation');
    const sectionMatch = content.match(/## No-CI degradation\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const section = sectionMatch![1];
    expect(section).toMatch(/no-op/i);
    expect(section).toMatch(/dry.?wave/i);
  });

  test('## Territory bands names per-workflow-file banding', () => {
    const content = read(filePath);

    const sectionMatch = content.match(/## Territory bands\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const section = sectionMatch![1];
    expect(section).toMatch(/workflow|pipeline file/i);
  });

  test('## Finding file/line convention exists for ledger dedup', () => {
    const content = read(filePath);

    expect(content).toContain('## Finding file/line convention');
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

describe('scripts/lib/build/facts.ts — HUNT_KINDS includes ci', () => {
  test('HUNT_KINDS array contains "ci"', async () => {
    const { HUNT_KINDS } = await import('./lib/build/facts.ts');
    expect(HUNT_KINDS).toContain('ci');
  });
});

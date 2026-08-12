import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Regression/structural tests locking in issue #452's `backlog` kaizen hunt kind: open-forge-issue
// territory for duplicate detection, stale-referent validation, and low-information enrichment
// (mercure PM-089 / mode-triage Phases 2–4). Mirrors `scripts/kaizen-docs-kind.test.ts`.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('fixtures/config.example.json — kaizen.kinds includes backlog', () => {
  const config = JSON.parse(read('fixtures/config.example.json'));

  test('kaizen.kinds is an array containing "backlog"', () => {
    expect(Array.isArray(config.kaizen.kinds)).toBe(true);
    expect(config.kaizen.kinds).toContain('backlog');
  });
});

describe('config-template.md — backlog kind registration', () => {
  const template = read('src/references/config-template.md');

  test('default kaizen.kinds JSON example block contains "backlog"', () => {
    const jsonBlockMatch = template.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonBlockMatch).not.toBeNull();
    const jsonBlock = jsonBlockMatch![1];
    expect(jsonBlock).toContain('"kaizen"');
    expect(jsonBlock).toContain('"backlog"');
  });

  test('kaizen.kinds prose row documents backlog', () => {
    const rowMatch = template.match(/\| `kaizen\.kinds` \|.*\|\n/);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('backlog');
  });
});

describe('src/agents/hunter.md — backlog kind registration', () => {
  const hunter = read('src/agents/hunter.md');

  test('inline kind-example list contains `backlog`', () => {
    const paragraphMatch = hunter.match(/kaizen\.kinds.*?e\.g\.[\s\S]*?\)\s*is set by an explicit/);
    expect(paragraphMatch).not.toBeNull();
    expect(paragraphMatch![0]).toContain('`backlog`');
  });
});

describe('src/references/hunt/backlog.md — kind reference file', () => {
  const filePath = 'src/references/hunt/backlog.md';

  test('file exists', () => {
    expect(fs.existsSync(path.join(root, filePath))).toBe(true);
  });

  test('content-shape: required sections, scoring formula, and open-issue territory', () => {
    const content = read(filePath);

    expect(content).toContain('## Scan heuristics');
    expect(content).toContain('## Calibration table');
    expect(content).toContain('## Scoring — V-PARETO-02 SSOT');
    expect(content).toContain('Priority = Gain * (11 - Effort)');
    expect(content).toMatch(/open.*issue/i);
  });

  test('scan heuristics cover duplicate, stale-referent, and low-information passes', () => {
    const content = read(filePath);

    const sectionMatch = content.match(/## Scan heuristics\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const section = sectionMatch![1];
    expect(section).toMatch(/duplicate|Jaccard/i);
    expect(section).toMatch(/stale.?referent|Glob|Grep/i);
    expect(section).toMatch(/low.?information|enrichment/i);
    expect(section).toMatch(/0\.55/);
    expect(section).toMatch(/never auto-close|propose consolidation/i);
  });

  test('finding file/line convention documents issue sentinels', () => {
    const content = read(filePath);

    expect(content).toContain('## Finding file/line convention');
    expect(content).toMatch(/issue:</);
  });
});

describe('src/references/phase-loop.md — backlog enrichment pass', () => {
  const phaseLoop = read('src/references/phase-loop.md');

  test('Kaizen step 3 documents orchestrator enrichment for backlog low-info findings', () => {
    expect(phaseLoop).toMatch(/blackhole:enrichment/);
    expect(phaseLoop).toMatch(/backlog.*enrichment|enrichment.*backlog/i);
  });
});

describe('scripts/lib/build/facts.ts — HUNT_KINDS includes backlog', () => {
  test('HUNT_KINDS array contains "backlog"', async () => {
    const { HUNT_KINDS } = await import('./lib/build/facts.ts');
    expect(HUNT_KINDS).toContain('backlog');
  });
});

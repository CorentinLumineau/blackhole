import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Regression/structural tests locking in the `ux-coherence` kaizen hunt kind (issue #421,
// `.blackhole/plans/issue-421.md` Option A — parity-precedent kind + hunt-gated companion
// scaffold): an 8th hunt kind that audits a campaign's own live surfaces + user journeys
// against DESIGN.md + the rulings ledger + journeys.md. Pure additive extension, mirroring
// `scripts/kaizen-parity-kind.test.ts`'s structure exactly (kind name swapped): no new scoring
// formula, no new ledger field, no new severity tier, no orchestrator/hunter/`hunt_state`
// change.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('fixtures/config.example.json — kaizen.kinds includes ux-coherence', () => {
  const config = JSON.parse(read('fixtures/config.example.json'));

  test('kaizen.kinds is an array containing "ux-coherence"', () => {
    expect(Array.isArray(config.kaizen.kinds)).toBe(true);
    expect(config.kaizen.kinds).toContain('ux-coherence');
  });
});

describe('config-template.md — ux-coherence kind registration', () => {
  const template = read('src/references/config-template.md');

  test('default kaizen.kinds JSON example block contains "ux-coherence"', () => {
    const jsonBlockMatch = template.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonBlockMatch).not.toBeNull();
    const jsonBlock = jsonBlockMatch![1];
    expect(jsonBlock).toContain('"kaizen"');
    expect(jsonBlock).toContain('"ux-coherence"');
  });

  test('kaizen.kinds prose row documents ux-coherence', () => {
    const rowMatch = template.match(/\| `kaizen\.kinds` \|.*\|\n/);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('ux-coherence');
  });
});

describe('src/agents/hunter.md — ux-coherence kind registration', () => {
  const hunter = read('src/agents/hunter.md');

  test('inline kind-example list contains `ux-coherence`', () => {
    // The `e.g. \`quickwins\`, ...` list wraps across two markdown source lines (one prose
    // paragraph) — match the paragraph as a block rather than a single physical line.
    const paragraphMatch = hunter.match(/kaizen\.kinds.*?e\.g\.[\s\S]*?\)\s*is set by an explicit/);
    expect(paragraphMatch).not.toBeNull();
    expect(paragraphMatch![0]).toContain('`ux-coherence`');
  });
});

describe('src/references/hunt/ux-coherence.md — kind reference file', () => {
  const filePath = 'src/references/hunt/ux-coherence.md';

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

  test('## Territory bands names both a per-surface band and a journeys band', () => {
    const content = read(filePath);

    const sectionMatch = content.match(/## Territory bands\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const section = sectionMatch![1];
    expect(section).toMatch(/surface/i);
    expect(section).toMatch(/journeys/);
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

describe('templates/companion-files/journeys.md.template — companion-file template', () => {
  const filePath = 'templates/companion-files/journeys.md.template';

  test('file exists', () => {
    expect(fs.existsSync(path.join(root, filePath))).toBe(true);
  });

  test('content-shape: status: template frontmatter, unfilled-template sentinel, example Job section', () => {
    const content = read(filePath);

    expect(content).toContain('status: template');
    expect(content).toContain('<!-- STATUS: unfilled template');
    expect(content).toMatch(/## Job:/);
    expect(content).toContain('**Statement**:');
    expect(content).toContain('**Owning surface**:');
    expect(content).toContain('**Owner-approved**:');
  });
});

describe('templates/companion-files/README.md — journeys.md.template registration', () => {
  const readme = read('templates/companion-files/README.md');

  test('templates table documents a journeys.md.template row', () => {
    expect(readme).toMatch(/\|\s*`journeys\.md\.template`\s*\|/);
  });
});

describe('src/SKILL.md — journeys.md hunt-kind-gated scaffold clause', () => {
  const skill = read('src/SKILL.md');

  test('Phase 0 step 2 gates journeys.md creation on kaizen.kinds containing ux-coherence', () => {
    expect(skill).toContain('journeys.md');
    expect(skill).toContain('kaizen.enabled');
    expect(skill).toContain('kaizen.kinds');
    expect(skill).toContain('ux-coherence');
  });
});

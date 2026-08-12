import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Regression/structural tests locking in issue #496's `docs` kaizen hunt kind: the Scope-2
// (consumer-repo-tree, not blackhole's own) enforcement site for `V-DOC-04` (doc-tree
// structural staleness — dangling `documentation/INDEX.md` rows, unresolved `supersedes:`
// chains). Mirrors `scripts/kaizen-parity-kind.test.ts`'s and
// `scripts/kaizen-ux-coherence-kind.test.ts`'s structure (kind name swapped): a 9th hunt kind,
// pure additive extension — no new scoring formula, no new ledger field, no new orchestrator/
// hunter/`hunt_state` mechanic. Unlike `parity`/`ux-coherence`, this kind's calibration table
// always assigns `severity: BLOCK` — the vcode it enforces (`V-DOC-04`) is declared `BLOCK` in
// `blackhole-vcodes.md` with no severity range, matching the design decision in
// `.blackhole/plans/issue-496-design.md` § Decision C.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('fixtures/config.example.json — kaizen.kinds includes docs', () => {
  const config = JSON.parse(read('fixtures/config.example.json'));

  test('kaizen.kinds is an array containing "docs"', () => {
    expect(Array.isArray(config.kaizen.kinds)).toBe(true);
    expect(config.kaizen.kinds).toContain('docs');
  });
});

describe('config-template.md — docs kind registration', () => {
  const template = read('src/references/config-template.md');

  test('default kaizen.kinds JSON example block contains "docs"', () => {
    const jsonBlockMatch = template.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonBlockMatch).not.toBeNull();
    const jsonBlock = jsonBlockMatch![1];
    expect(jsonBlock).toContain('"kaizen"');
    expect(jsonBlock).toContain('"docs"');
  });

  test('kaizen.kinds prose row documents docs', () => {
    const rowMatch = template.match(/\| `kaizen\.kinds` \|.*\|\n/);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('docs');
  });
});

describe('src/agents/hunter.md — docs kind registration', () => {
  const hunter = read('src/agents/hunter.md');

  test('inline kind-example list contains `docs`', () => {
    // The `e.g. \`quickwins\`, ...` list wraps across two markdown source lines (one prose
    // paragraph) — match the paragraph as a block rather than a single physical line.
    const paragraphMatch = hunter.match(/kaizen\.kinds.*?e\.g\.[\s\S]*?\)\s*is set by an explicit/);
    expect(paragraphMatch).not.toBeNull();
    expect(paragraphMatch![0]).toContain('`docs`');
  });
});

describe('src/references/hunt/docs.md — kind reference file', () => {
  const filePath = 'src/references/hunt/docs.md';

  test('file exists', () => {
    expect(fs.existsSync(path.join(root, filePath))).toBe(true);
  });

  test('content-shape: required sections, scoring formula, and V-DOC-04 provenance', () => {
    const content = read(filePath);

    expect(content).toContain('## Scan heuristics');
    expect(content).toContain('## Calibration table');
    expect(content).toContain('## Scoring — V-PARETO-02 SSOT');
    expect(content).toContain('Priority = Gain * (11 - Effort)');
    expect(content).toContain('V-DOC-04');
  });

  test('scan heuristics cover dangling INDEX rows and unresolved supersedes chains, and defer folder-reorg tracking', () => {
    const content = read(filePath);

    const sectionMatch = content.match(/## Scan heuristics\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const section = sectionMatch![1];
    expect(section).toMatch(/INDEX/);
    expect(section).toMatch(/supersedes/);
    expect(section).toMatch(/deferred|out of scope/i);
  });

  test('calibration table always assigns severity BLOCK, matching V-DOC-04 (no severity range)', () => {
    const content = read(filePath);

    const sectionMatch = content.match(/## Calibration table\n([\s\S]*?)(\n## |$)/);
    expect(sectionMatch).not.toBeNull();
    const tableRows = sectionMatch![1]
      .split('\n')
      .filter((line) => line.trim().startsWith('|'))
      .filter((line) => !/^\|[\s-]*\|/.test(line)) // skip the separator row
      .filter((line) => !line.includes('| Heuristic |')); // skip the header row
    expect(tableRows.length).toBeGreaterThan(0);
    for (const row of tableRows) {
      expect(row).toContain('BLOCK');
    }
  });

  test('severity-term reconciliation note states this kind is not floor-bypassed like bug', () => {
    const content = read(filePath);

    expect(content).toContain('## Severity-term reconciliation note');
    expect(content).toMatch(/bug\.md/);
  });
});

describe('src/references/blackhole-vcodes.md — V-DOC-04 row', () => {
  const vcodes = read('src/references/blackhole-vcodes.md');

  test('V-DOC-04 row exists, is BLOCK severity, and cites the docs hunt kind as its enforcement site', () => {
    const rowMatch = vcodes.match(/^\| V-DOC-04 \|.*\|$/m);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('BLOCK');
    expect(rowMatch![0]).toContain('hunt/docs.md');
  });
});

describe('scripts/lib/build/facts.ts — HUNT_KINDS includes docs', () => {
  test('HUNT_KINDS array contains "docs"', async () => {
    const { HUNT_KINDS } = await import('./lib/build/facts.ts');
    expect(HUNT_KINDS).toContain('docs');
  });
});

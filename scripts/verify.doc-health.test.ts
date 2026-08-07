import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateIndexDangling,
  evaluateOrphanFiles,
  findDanglingIndexRows,
  findDateStampedFilenames,
  findMissingFrontmatter,
  findOrphanDocs,
  findOversizedDocs,
  findStaleDeprecatedDocs,
  isRootIndexRowCeilingExceeded,
  isTreeSizeAdvisoryExceeded,
  parseRootIndexRows,
  runChecks,
} from './checks/doc-health.check.ts';
import { root } from './checks/check-utils.ts';
import { DOC_HEALTH_THRESHOLDS } from './lib/build/facts.ts';
import { makeTempDir } from './lib/fs.ts';

// Issue #462 (ADR-021 D6 Scope 1) — doc-health.check.ts: doc-tree health thresholds +
// INDEX.md integrity for blackhole's own documentation/ tree. Modeled on
// verify.adr-status.test.ts / verify.parity-matrix.test.ts's synthetic-fixture shape: pure
// helper functions are exercised directly with hand-built inputs; a fixture directory
// (makeTempDir, never the live documentation/ tree) exercises the file-absent SKIP branch.

const withFixtureDir = (fn: (dir: string) => void): void => {
  const dir = makeTempDir('doc-health');
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const write = (dir: string, relPath: string, content: string): void => {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

const FM = (fields: Record<string, string>): string =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n# Fixture\n`;

// ---------------------------------------------------------------------------
// (a) V-DOC-GOV-02 — lifecycle frontmatter presence
// ---------------------------------------------------------------------------
describe('findMissingFrontmatter (V-DOC-GOV-02)', () => {
  test('flags a doc missing type or status', () => {
    const files = [
      { relPath: 'foo.md', hasType: true, hasStatus: false },
      { relPath: 'bar.md', hasType: false, hasStatus: true },
      { relPath: 'clean.md', hasType: true, hasStatus: true },
    ];
    expect(findMissingFrontmatter(files)).toEqual(['foo.md', 'bar.md']);
  });

  test('excludes INDEX.md and milestones/_archived/** even when missing frontmatter', () => {
    const files = [
      { relPath: 'INDEX.md', hasType: false, hasStatus: false },
      { relPath: 'milestones/_archived/old.md', hasType: false, hasStatus: false },
    ];
    expect(findMissingFrontmatter(files)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) V-DOC-GOV-03 — canonical filename (date-stamp suffix; ADR files exempt)
// ---------------------------------------------------------------------------
describe('findDateStampedFilenames (V-DOC-GOV-03)', () => {
  test('flags a date-stamped filename', () => {
    expect(findDateStampedFilenames(['audits/analysis-foo-2026-05-07.md'])).toEqual([
      'audits/analysis-foo-2026-05-07.md',
    ]);
  });

  test('exempts ADR-*.md and INDEX.md even when the name looks date-stamped', () => {
    expect(
      findDateStampedFilenames(['decisions/ADR-005-something-2026-07-07.md', 'INDEX.md', 'plans/roadmap.md'])
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Root INDEX.md row parsing (shared by V-DOCHEALTH-01/02/03)
// ---------------------------------------------------------------------------
describe('parseRootIndexRows', () => {
  test('parses path/summary/type/status/review_trigger rows, skipping header/separator', () => {
    const content = `# Doc Index

| path | summary | type | status | review_trigger |
|------|---------|------|--------|----------------|
| audits/foo.md | Foo audit | audit | current | on release |
| decisions/ADR-001-x.md | Decision X | adr | accepted | on protocol change |
`;
    const rows = parseRootIndexRows(content);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      path: 'audits/foo.md',
      summary: 'Foo audit',
      type: 'audit',
      status: 'current',
      reviewTrigger: 'on release',
    });
  });
});

// ---------------------------------------------------------------------------
// (c) V-DOCHEALTH-01 — dangling INDEX.md rows (blocking)
// ---------------------------------------------------------------------------
describe('findDanglingIndexRows (V-DOCHEALTH-01)', () => {
  test('flags a row whose file does not exist on disk', () => {
    const existing = new Set(['audits/foo.md']);
    expect(findDanglingIndexRows(['audits/foo.md', 'audits/missing.md'], existing)).toEqual(['audits/missing.md']);
  });

  test('a fully-resolved INDEX.md passes', () => {
    const existing = new Set(['audits/foo.md', 'plans/bar.md']);
    expect(findDanglingIndexRows(['audits/foo.md', 'plans/bar.md'], existing)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (d) V-DOCHEALTH-02 — orphan files (blocking)
// ---------------------------------------------------------------------------
describe('findOrphanDocs (V-DOCHEALTH-02)', () => {
  test('flags a file with no INDEX.md row', () => {
    const indexed = new Set(['audits/foo.md']);
    expect(findOrphanDocs(['audits/foo.md', 'audits/orphan.md'], indexed)).toEqual(['audits/orphan.md']);
  });

  test('excludes INDEX.md itself and decisions/** (governed by its own per-folder INDEX.md)', () => {
    const indexed = new Set<string>();
    expect(findOrphanDocs(['INDEX.md', 'decisions/ADR-001-x.md'], indexed)).toEqual([]);
  });

  test('excludes milestones/_archived/**', () => {
    const indexed = new Set<string>();
    expect(findOrphanDocs(['milestones/_archived/old.md'], indexed)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (e) V-DOCHEALTH-03 — aggregated thresholds, each crossed + an under-threshold case
// ---------------------------------------------------------------------------
describe('findOversizedDocs (single-doc line ceiling)', () => {
  test('flags a doc over the ceiling, spares one under it', () => {
    const files = [
      { relPath: 'audits/big.md', lineCount: 401 },
      { relPath: 'audits/small.md', lineCount: 399 },
    ];
    expect(findOversizedDocs(files, 400)).toEqual(['audits/big.md']);
  });

  test('excludes INDEX.md from the ceiling (it has its own row ceiling instead)', () => {
    const files = [{ relPath: 'INDEX.md', lineCount: 5000 }];
    expect(findOversizedDocs(files, 400)).toEqual([]);
  });
});

describe('isRootIndexRowCeilingExceeded (root-INDEX row ceiling)', () => {
  test('over the ceiling', () => expect(isRootIndexRowCeilingExceeded(201, 200)).toBe(true));
  test('under the ceiling', () => expect(isRootIndexRowCeilingExceeded(199, 200)).toBe(false));
});

describe('isTreeSizeAdvisoryExceeded (tree-size advisory)', () => {
  test('over the advisory', () => expect(isTreeSizeAdvisoryExceeded(501, 500)).toBe(true));
  test('under the advisory', () => expect(isTreeSizeAdvisoryExceeded(499, 500)).toBe(false));
});

describe('findStaleDeprecatedDocs (deprecation window)', () => {
  const now = new Date('2026-08-07T00:00:00Z');

  test('a deprecated doc past the window is flagged', () => {
    const files = [{ relPath: 'brainstorms/old.md', status: 'deprecated', lastUpdated: '2026-01-01' }];
    expect(findStaleDeprecatedDocs(files, 90, now)).toEqual(['brainstorms/old.md']);
  });

  test('a deprecated doc within the window passes', () => {
    const files = [{ relPath: 'brainstorms/recent.md', status: 'deprecated', lastUpdated: '2026-08-01' }];
    expect(findStaleDeprecatedDocs(files, 90, now)).toEqual([]);
  });

  test('a non-deprecated doc is never flagged regardless of age', () => {
    const files = [{ relPath: 'reference/old.md', status: 'current', lastUpdated: '2020-01-01' }];
    expect(findStaleDeprecatedDocs(files, 90, now)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (f) documentation/INDEX.md absent → V-DOCHEALTH-01/02 SKIP, no read attempted.
// Fixture directory only — never the live tree (see plan Execution Strategy #3): the live
// tree's current absence of INDEX.md is sibling #463's job to resolve, not a fact to bake
// into this assertion.
// ---------------------------------------------------------------------------
describe('runChecks against a fixture tree lacking INDEX.md', () => {
  test('V-DOCHEALTH-01 and V-DOCHEALTH-02 SKIP (ok:true) when INDEX.md is absent', () => {
    withFixtureDir((dir) => {
      write(dir, 'audits/foo.md', FM({ type: 'audit', status: 'current' }));
      // No INDEX.md written — this is the fixture under test.
      expect(fs.existsSync(path.join(dir, 'INDEX.md'))).toBe(false);

      // runChecks() itself always targets the production documentation/ tree (it is
      // glob-discovered with no args, matching every other *.check.ts domain module), so the
      // SKIP branch is exercised directly via the same evaluate* logic runChecks() calls,
      // against this fixture dir.
      expect(evaluateIndexDangling(dir)).toEqual({ id: 'V-DOCHEALTH-01', ok: true });
      expect(evaluateOrphanFiles(dir)).toEqual({ id: 'V-DOCHEALTH-02', ok: true });
    });
  });
});

// ---------------------------------------------------------------------------
// Integration smoke test — runChecks() against the real repo. Structural shape only (5
// results, correct ids in contract order); does not bake in *why* any result is ok:true, per
// Execution Strategy #3.
// ---------------------------------------------------------------------------
describe('runChecks (real repo, structural shape)', () => {
  test('returns exactly the 5 contract CheckResults, all non-blocking on the current tree', () => {
    const results = runChecks();
    expect(results.map((r) => r.id)).toEqual([
      'V-DOC-GOV-02',
      'V-DOC-GOV-03',
      'V-DOCHEALTH-01',
      'V-DOCHEALTH-02',
      'V-DOCHEALTH-03',
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (g) doc-governance.md's stated threshold numbers match facts.ts's exported constants —
// numeric-fact SSOT (Codebase Conventions), never independently hardcoded and eyeballed.
// ---------------------------------------------------------------------------
describe('doc-governance.md threshold prose matches facts.ts DOC_HEALTH_THRESHOLDS', () => {
  test('all 4 thresholds are stated in prose and agree with the live constants', () => {
    const content = fs.readFileSync(path.join(root, 'src/references/doc-governance.md'), 'utf-8');

    const lineCeiling = content.match(/(\d+)-line single-doc ceiling/);
    const rowCeiling = content.match(/(\d+)-row root-INDEX ceiling/);
    const treeAdvisory = content.match(/(\d+)-file tree-size advisory/);
    const deprecationWindow = content.match(/(\d+)-day deprecation window/);

    expect(lineCeiling).not.toBeNull();
    expect(rowCeiling).not.toBeNull();
    expect(treeAdvisory).not.toBeNull();
    expect(deprecationWindow).not.toBeNull();

    expect(Number(lineCeiling![1])).toBe(DOC_HEALTH_THRESHOLDS.singleDocLineCeiling);
    expect(Number(rowCeiling![1])).toBe(DOC_HEALTH_THRESHOLDS.rootIndexRowCeiling);
    expect(Number(treeAdvisory![1])).toBe(DOC_HEALTH_THRESHOLDS.treeSizeAdvisory);
    expect(Number(deprecationWindow![1])).toBe(DOC_HEALTH_THRESHOLDS.deprecationWindowDays);
  });

  test('both new sections are present', () => {
    const content = fs.readFileSync(path.join(root, 'src/references/doc-governance.md'), 'utf-8');
    expect(content).toContain('## Doc-Tree Health Signal');
    expect(content).toContain('## INDEX.md Maintenance');
  });
});

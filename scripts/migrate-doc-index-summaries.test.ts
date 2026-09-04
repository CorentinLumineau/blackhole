import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { applySummaryMigration, computeSummaryMigrationPlan } from './migrate-doc-index-summaries.ts';
import { makeTempDir } from './lib/fs.ts';

// Issue #811 (ADR-031 Phase 1, Task 7/8) — one-time migration: joins parsed INDEX.md rows with
// each doc's current frontmatter and inserts a YAML-safe `summary:` field into every doc
// missing one. Idempotent (a doc that already has `summary:` is left untouched, skipped: true).

const withFixtureDir = (fn: (dir: string) => void): void => {
  const dir = makeTempDir('migrate-doc-index-summaries');
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

const read = (dir: string, relPath: string): string => fs.readFileSync(path.join(dir, relPath), 'utf-8');

const INDEX_HEADER = '| path | summary | type | status | review_trigger |\n|------|---------|------|--------|----------------|\n';

describe('computeSummaryMigrationPlan', () => {
  test('joins a doc missing summary with its INDEX.md row summary cell', () => {
    withFixtureDir((dir) => {
      write(dir, 'audits/foo.md', '---\ntype: audit\nstatus: current\n---\n\n# Foo\n');
      const indexContent = `${INDEX_HEADER}| audits/foo.md | An audit doc | audit | current | on release |\n`;
      const plan = computeSummaryMigrationPlan(dir, indexContent);
      expect(plan).toEqual([{ path: 'audits/foo.md', summary: 'An audit doc', skipped: false }]);
    });
  });

  test('marks a doc already carrying a non-empty summary: field as skipped (idempotent)', () => {
    withFixtureDir((dir) => {
      write(dir, 'audits/foo.md', `---\ntype: audit\nsummary: ${JSON.stringify('Already set')}\nstatus: current\n---\n\n# Foo\n`);
      const indexContent = `${INDEX_HEADER}| audits/foo.md | An audit doc | audit | current | on release |\n`;
      const plan = computeSummaryMigrationPlan(dir, indexContent);
      expect(plan).toEqual([{ path: 'audits/foo.md', summary: 'Already set', skipped: true }]);
    });
  });

  test('excludes decisions/** and milestones/_archived/** from the plan', () => {
    withFixtureDir((dir) => {
      write(dir, 'decisions/ADR-001-x.md', '---\nstatus: accepted\n---\n\n# ADR\n');
      write(dir, 'milestones/_archived/old.md', '---\ntype: plan\nstatus: archived\n---\n\n# Old\n');
      write(dir, 'audits/foo.md', '---\ntype: audit\nstatus: current\n---\n\n# Foo\n');
      const indexContent = `${INDEX_HEADER}| audits/foo.md | An audit doc | audit | current | on release |\n`;
      const plan = computeSummaryMigrationPlan(dir, indexContent);
      expect(plan.map((e) => e.path)).toEqual(['audits/foo.md']);
    });
  });

  test('a doc with no matching INDEX.md row is left skipped rather than assigned a guessed summary', () => {
    withFixtureDir((dir) => {
      write(dir, 'audits/orphan.md', '---\ntype: audit\nstatus: current\n---\n\n# Orphan\n');
      const plan = computeSummaryMigrationPlan(dir, INDEX_HEADER);
      expect(plan).toEqual([{ path: 'audits/orphan.md', summary: '', skipped: true }]);
    });
  });

  test('correctly YAML-escapes (round-trips) a summary value containing a colon, a double quote, and a backtick', () => {
    withFixtureDir((dir) => {
      const tricky = 'Uses `git status`: prints "clean" when empty';
      write(dir, 'audits/tricky.md', '---\ntype: audit\nstatus: current\n---\n\n# Tricky\n');
      const indexContent = `${INDEX_HEADER}| audits/tricky.md | ${tricky} | audit | current | on release |\n`;
      const plan = computeSummaryMigrationPlan(dir, indexContent);
      expect(plan).toEqual([{ path: 'audits/tricky.md', summary: tricky, skipped: false }]);
    });
  });
});

describe('applySummaryMigration', () => {
  test('inserts summary: immediately after the type: line for a non-skipped entry', () => {
    withFixtureDir((dir) => {
      write(dir, 'audits/foo.md', '---\ntype: audit\nstatus: current\n---\n\n# Foo\n');
      const plan = [{ path: 'audits/foo.md', summary: 'An audit doc', skipped: false }];
      const result = applySummaryMigration(dir, plan);
      expect(result.exceptions).toEqual([]);
      expect(result.migrated).toEqual(['audits/foo.md']);
      const content = read(dir, 'audits/foo.md');
      expect(content).toBe(`---\ntype: audit\nsummary: ${JSON.stringify('An audit doc')}\nstatus: current\n---\n\n# Foo\n`);
    });
  });

  test('never writes anything for a skipped entry', () => {
    withFixtureDir((dir) => {
      const original = '---\ntype: audit\nsummary: "Already set"\nstatus: current\n---\n\n# Foo\n';
      write(dir, 'audits/foo.md', original);
      const plan = [{ path: 'audits/foo.md', summary: 'Already set', skipped: true }];
      const result = applySummaryMigration(dir, plan);
      expect(result.migrated).toEqual([]);
      expect(result.exceptions).toEqual([]);
      expect(read(dir, 'audits/foo.md')).toBe(original);
    });
  });

  test('a doc with no type: line goes into the exceptions list, file left untouched', () => {
    withFixtureDir((dir) => {
      const original = '---\nstatus: current\n---\n\n# Foo\n';
      write(dir, 'audits/no-type.md', original);
      const plan = [{ path: 'audits/no-type.md', summary: 'A summary', skipped: false }];
      const result = applySummaryMigration(dir, plan);
      expect(result.migrated).toEqual([]);
      expect(result.exceptions).toEqual([{ path: 'audits/no-type.md', reason: expect.any(String) }]);
      expect(read(dir, 'audits/no-type.md')).toBe(original);
    });
  });

  test('a doc with no frontmatter block at all goes into the exceptions list, file left untouched', () => {
    withFixtureDir((dir) => {
      const original = '# No frontmatter here\n';
      write(dir, 'audits/no-fm.md', original);
      const plan = [{ path: 'audits/no-fm.md', summary: 'A summary', skipped: false }];
      const result = applySummaryMigration(dir, plan);
      expect(result.migrated).toEqual([]);
      expect(result.exceptions).toEqual([{ path: 'audits/no-fm.md', reason: expect.any(String) }]);
      expect(read(dir, 'audits/no-fm.md')).toBe(original);
    });
  });

  test('round-trips a tricky summary (colon, double quote, backtick) byte-identically after insertion', () => {
    withFixtureDir((dir) => {
      const tricky = 'Uses `git status`: prints "clean" when empty';
      write(dir, 'audits/tricky.md', '---\ntype: audit\nstatus: current\n---\n\n# Tricky\n');
      const plan = [{ path: 'audits/tricky.md', summary: tricky, skipped: false }];
      const result = applySummaryMigration(dir, plan);
      expect(result.exceptions).toEqual([]);
      expect(result.migrated).toEqual(['audits/tricky.md']);
      const content = read(dir, 'audits/tricky.md');
      const summaryLine = content.split('\n').find((l) => l.startsWith('summary:'));
      expect(summaryLine).toBe(`summary: ${JSON.stringify(tricky)}`);
    });
  });
});

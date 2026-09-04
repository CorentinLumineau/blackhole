import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { buildDocIndexRows, renderDocIndexTable } from './doc-index-generate.ts';
import { byPathByteOrder, renderIndexRowLine } from './check-common.ts';
import { makeTempDir } from './fs.ts';

// Issue #811 (ADR-031 Phase 1, Task 3/4) — the generator half of the "generated-artifact +
// drift-check" pattern (Codebase Conventions table). Pure function over a fixture directory:
// tree walk + frontmatter read + sorted row build, reusing check-common.ts primitives rather
// than a second tree-walk/sort/render implementation (V-INT-02).

const withFixtureDir = (fn: (dir: string) => void): void => {
  const dir = makeTempDir('doc-index-generate');
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

const doc = (fields: Record<string, string>): string =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n# Fixture\n`;

describe('buildDocIndexRows', () => {
  test('sources path/summary/type/status/reviewTrigger from each fixture doc frontmatter', () => {
    withFixtureDir((dir) => {
      write(
        dir,
        'audits/foo.md',
        doc({
          type: 'audit',
          summary: JSON.stringify('An audit doc'),
          status: 'current',
          review_trigger: JSON.stringify('on release'),
          created: '2026-01-01',
          last_updated: '2026-01-01',
        })
      );
      const rows = buildDocIndexRows(dir);
      expect(rows).toEqual([
        { path: 'audits/foo.md', summary: 'An audit doc', type: 'audit', status: 'current', reviewTrigger: 'on release' },
      ]);
    });
  });

  test('excludes decisions/** from the walk', () => {
    withFixtureDir((dir) => {
      write(dir, 'decisions/ADR-001-x.md', doc({ status: 'accepted' }));
      write(
        dir,
        'audits/foo.md',
        doc({ type: 'audit', summary: JSON.stringify('s'), status: 'current', review_trigger: JSON.stringify('on release') })
      );
      const rows = buildDocIndexRows(dir);
      expect(rows.map((r) => r.path)).toEqual(['audits/foo.md']);
    });
  });

  test('excludes milestones/_archived/** from the walk', () => {
    withFixtureDir((dir) => {
      write(dir, 'milestones/_archived/old.md', doc({ type: 'plan', status: 'archived' }));
      write(
        dir,
        'audits/foo.md',
        doc({ type: 'audit', summary: JSON.stringify('s'), status: 'current', review_trigger: JSON.stringify('on release') })
      );
      const rows = buildDocIndexRows(dir);
      expect(rows.map((r) => r.path)).toEqual(['audits/foo.md']);
    });
  });

  test('excludes INDEX.md itself from the walk', () => {
    withFixtureDir((dir) => {
      write(dir, 'INDEX.md', '# Documentation Index\n\n| path | summary | type | status | review_trigger |\n');
      write(
        dir,
        'audits/foo.md',
        doc({ type: 'audit', summary: JSON.stringify('s'), status: 'current', review_trigger: JSON.stringify('on release') })
      );
      const rows = buildDocIndexRows(dir);
      expect(rows.map((r) => r.path)).toEqual(['audits/foo.md']);
    });
  });

  test('output is sorted via the imported byPathByteOrder comparator, not a re-implemented one', () => {
    withFixtureDir((dir) => {
      for (const p of ['audits/z.md', 'audits/a.md', 'audits/m.md']) {
        write(
          dir,
          p,
          doc({ type: 'audit', summary: JSON.stringify(p), status: 'current', review_trigger: JSON.stringify('on release') })
        );
      }
      const rows = buildDocIndexRows(dir);
      const expected = [...rows].sort(byPathByteOrder);
      expect(rows).toEqual(expected);
      expect(rows.map((r) => r.path)).toEqual(['audits/a.md', 'audits/m.md', 'audits/z.md']);
    });
  });

  test('a doc missing a summary field renders an empty summary cell rather than throwing', () => {
    withFixtureDir((dir) => {
      write(dir, 'audits/bare.md', doc({ type: 'audit', status: 'current', review_trigger: JSON.stringify('on release') }));
      const rows = buildDocIndexRows(dir);
      expect(rows).toEqual([
        { path: 'audits/bare.md', summary: '', type: 'audit', status: 'current', reviewTrigger: 'on release' },
      ]);
    });
  });

  test('decodes a JSON-quoted summary containing a colon, a double quote, and a backtick', () => {
    withFixtureDir((dir) => {
      const tricky = 'Uses `git status`: prints "clean" when empty';
      write(
        dir,
        'audits/tricky.md',
        doc({ type: 'audit', summary: JSON.stringify(tricky), status: 'current', review_trigger: JSON.stringify('on release') })
      );
      const rows = buildDocIndexRows(dir);
      expect(rows[0]!.summary).toBe(tricky);
    });
  });
});

describe('renderDocIndexTable', () => {
  test('renders rows via the shared renderIndexRowLine, one per line', () => {
    const rows = [
      { path: 'audits/a.md', summary: 'A', type: 'audit', status: 'current', reviewTrigger: 'on release' },
      { path: 'audits/b.md', summary: 'B', type: 'audit', status: 'current', reviewTrigger: 'on release' },
    ];
    expect(renderDocIndexTable(rows)).toBe(rows.map(renderIndexRowLine).join('\n'));
  });

  test('renders an empty string for zero rows', () => {
    expect(renderDocIndexTable([])).toBe('');
  });
});

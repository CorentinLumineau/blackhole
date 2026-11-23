import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  buildDocIndexRows,
  diffDocIndexRows,
  isRegenerableRootIndex,
  renderDocIndexTable,
  renderFullIndexFile,
  renderRootIndexFile,
  ROOT_DOC_INDEX_PATH,
} from './doc-index-generate.ts';
import { byPathByteOrder, parseIndexTableRows, renderIndexRowLine } from './check-common.ts';
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

describe('diffDocIndexRows (issue #832, ADR-031 Phase 2)', () => {
  const row = (path: string, summary: string): { path: string; summary: string; type: string; status: string; reviewTrigger: string } => ({
    path,
    summary,
    type: 'audit',
    status: 'current',
    reviewTrigger: 'on release',
  });

  test('a committed-only path is dangling', () => {
    const diff = diffDocIndexRows([row('audits/gone.md', 's')], []);
    expect(diff).toEqual({ dangling: ['audits/gone.md'], orphan: [], stale: [] });
  });

  test('a generated-only path is orphan', () => {
    const diff = diffDocIndexRows([], [row('audits/new.md', 's')]);
    expect(diff).toEqual({ dangling: [], orphan: ['audits/new.md'], stale: [] });
  });

  test('a path on both sides with identical content is neither dangling, orphan, nor stale', () => {
    const diff = diffDocIndexRows([row('audits/foo.md', 's')], [row('audits/foo.md', 's')]);
    expect(diff).toEqual({ dangling: [], orphan: [], stale: [] });
  });

  test('a path on both sides with a differing summary is stale', () => {
    const diff = diffDocIndexRows([row('audits/foo.md', 'old')], [row('audits/foo.md', 'new')]);
    expect(diff).toEqual({ dangling: [], orphan: [], stale: ['audits/foo.md'] });
  });

  test('a path on both sides with a differing type/status/reviewTrigger is also stale', () => {
    const committed = row('audits/foo.md', 's');
    const generated = { ...row('audits/foo.md', 's'), status: 'deprecated' };
    const diff = diffDocIndexRows([committed], [generated]);
    expect(diff.stale).toEqual(['audits/foo.md']);
  });

  test('mixed: one dangling, one orphan, one stale, one clean — all classified independently', () => {
    const diff = diffDocIndexRows(
      [row('audits/gone.md', 's'), row('audits/stale.md', 'old'), row('audits/clean.md', 's')],
      [row('audits/new.md', 's'), row('audits/stale.md', 'new'), row('audits/clean.md', 's')]
    );
    expect(diff).toEqual({
      dangling: ['audits/gone.md'],
      orphan: ['audits/new.md'],
      stale: ['audits/stale.md'],
    });
  });
});

describe('renderFullIndexFile (issue #832, Task 5 — hoisted from generate-doc-index.ts)', () => {
  test('renders the table header + separator + generated rows, matching renderDocIndexTable output', () => {
    withFixtureDir((dir) => {
      write(
        dir,
        'audits/foo.md',
        doc({ type: 'audit', summary: JSON.stringify('An audit doc'), status: 'current', review_trigger: JSON.stringify('on release') })
      );
      const expected =
        '| path | summary | type | status | review_trigger |\n' +
        '|------|---------|------|--------|----------------|\n' +
        `${renderDocIndexTable(buildDocIndexRows(dir))}\n`;
      expect(renderFullIndexFile(dir)).toBe(expected);
    });
  });

  test('output matches the CLI\'s own (no-flag) stdout for the same docsDir', () => {
    const cliPath = path.join(import.meta.dir, '..', 'generate-doc-index.ts');
    const docsDir = path.join(import.meta.dir, '..', '..', 'documentation');
    const cliOutput = execFileSync('bun', ['run', cliPath], { encoding: 'utf-8' });
    expect(cliOutput).toBe(renderFullIndexFile(docsDir));
  });
});

describe('isRegenerableRootIndex (issue #1388)', () => {
  const BLACKHOLE_TABLE =
    '| path | summary | type | status | review_trigger |\n|------|---------|------|--------|----------------|\n';

  test('an absent file is regenerable', () => {
    expect(isRegenerableRootIndex(null)).toBe(true);
  });

  test('a title-only file (headings and blank lines) is regenerable', () => {
    expect(isRegenerableRootIndex('# Documentation Index\n\n')).toBe(true);
  });

  test('a file carrying blackhole\'s exact header is regenerable', () => {
    expect(isRegenerableRootIndex(`# Documentation Index\n\n${BLACKHOLE_TABLE}| a.md | s | t | current | x |\n`)).toBe(true);
  });

  test('a foreign header with capitalised column names is not regenerable', () => {
    const invest = '# Docs\n\n| Path | Summary | Type | Status | Review trigger |\n|---|---|---|---|---|\n| [a.md](a.md) | s | t | current | x |\n';
    expect(isRegenerableRootIndex(invest)).toBe(false);
  });

  test('a 4-column header is not regenerable', () => {
    expect(isRegenerableRootIndex('# Docs\n\n| path | summary | type | status |\n|---|---|---|---|\n')).toBe(false);
  });

  test('a table-less file with prose beyond the title block is not regenerable', () => {
    expect(isRegenerableRootIndex('# Docs\n\nSee the wiki for the doc list.\n')).toBe(false);
  });
});

describe('renderRootIndexFile (#1303)', () => {
  const fixture = (dir: string): void =>
    write(
      dir,
      'audits/foo.md',
      doc({ type: 'audit', summary: JSON.stringify('An audit doc'), status: 'current', review_trigger: JSON.stringify('on release') })
    );

  test('keeps the existing two-line title block and replaces everything below it with the generated table', () => {
    withFixtureDir((dir) => {
      fixture(dir);
      const existing = '# My Index\n\n| path | stale |\n| x | y |\n';
      const out = renderRootIndexFile(existing, dir);
      expect(out.split('\n').slice(0, 2)).toEqual(['# My Index', '']);
      expect(out).toBe(`# My Index\n\n${renderFullIndexFile(dir)}`);
      expect(out).toContain(renderDocIndexTable(buildDocIndexRows(dir)));
      expect(out).not.toContain('| x | y |');
    });
  });

  test('a missing file gets the default title block', () => {
    withFixtureDir((dir) => {
      fixture(dir);
      expect(renderRootIndexFile(null, dir)).toBe(`# Documentation Index\n\n${renderFullIndexFile(dir)}`);
    });
  });

  test('ROOT_DOC_INDEX_PATH names the root index the generator writes', () => {
    expect(ROOT_DOC_INDEX_PATH).toBe('documentation/INDEX.md');
  });
});

describe('a pipe in a frontmatter summary (issue #1414)', () => {
  test('renders an escaped cell that parses back with no stale row', () => {
    withFixtureDir((dir) => {
      write(dir, 'audits/pipe.md', doc({ type: 'audit', summary: '"`string | null` return"', status: 'current', review_trigger: '"on a | b"' }));
      const generated = buildDocIndexRows(dir);
      const file = renderFullIndexFile(dir);
      expect(file).toContain('| audits/pipe.md | `string \\| null` return | audit | current | on a \\| b |');
      const committed = parseIndexTableRows(file);
      expect(committed).toEqual(generated);
      expect(diffDocIndexRows(committed, generated)).toEqual({ dangling: [], orphan: [], stale: [] });
    });
  });
});

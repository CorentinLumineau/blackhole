import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  applyAdrFrontmatterBackfill,
  computeAdrFrontmatterBackfillPlan,
  insertMissingFrontmatterKeys,
  type AdrFrontmatterFields,
} from './backfill-adr-frontmatter.ts';
import { makeTempDir } from './lib/fs.ts';

// Issue #923 — one-time migration: backfills the six doc-governance.md lifecycle frontmatter
// keys (type, summary, status, review_trigger, created, last_updated) onto every ADR file
// missing at least one, sourcing type from a constant, summary/review_trigger from
// documentation/decisions/INDEX.md (verbatim), and created/last_updated from git history via an
// injected dateLookup callback (kept out of the pure function per the plan's own contract, so
// this suite never shells out to git).

const withFixtureDir = (fn: (dir: string) => void): void => {
  const dir = makeTempDir('backfill-adr-frontmatter');
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

const noDates = (): null => null;

describe('computeAdrFrontmatterBackfillPlan', () => {
  test('a status-only fixture plans all five other keys', () => {
    withFixtureDir((dir) => {
      write(dir, 'ADR-037-x.md', '---\nstatus: accepted\n---\n\n# ADR-037\n');
      const indexContent = `${INDEX_HEADER}| ADR-037-x.md | A summary | adr | accepted | on ADR acceptance |\n`;
      const dateLookup = () => ({ created: '2026-09-04', lastUpdated: '2026-09-04' });
      const plan = computeAdrFrontmatterBackfillPlan(dir, indexContent, dateLookup);
      expect(plan.exceptions).toEqual([]);
      expect(plan.entries).toEqual([
        {
          path: 'ADR-037-x.md',
          skipped: false,
          addedKeys: ['type', 'summary', 'review_trigger', 'created', 'last_updated'],
          fields: {
            type: 'adr',
            summary: 'A summary',
            status: 'accepted',
            reviewTrigger: 'on ADR acceptance',
            created: '2026-09-04',
            lastUpdated: '2026-09-04',
          },
        },
      ]);
    });
  });

  test('a type+status fixture plans summary, review_trigger, created, last_updated only', () => {
    withFixtureDir((dir) => {
      write(dir, 'ADR-001-x.md', '---\ntype: adr\nstatus: accepted\n---\n\n# ADR-001\n');
      const indexContent = `${INDEX_HEADER}| ADR-001-x.md | Five-phase lifecycle | adr | accepted | on protocol change |\n`;
      const dateLookup = () => ({ created: '2026-07-05', lastUpdated: '2026-08-07' });
      const plan = computeAdrFrontmatterBackfillPlan(dir, indexContent, dateLookup);
      expect(plan.exceptions).toEqual([]);
      expect(plan.entries[0].addedKeys).toEqual(['summary', 'review_trigger', 'created', 'last_updated']);
      expect(plan.entries[0].fields).toEqual({
        type: 'adr',
        summary: 'Five-phase lifecycle',
        status: 'accepted',
        reviewTrigger: 'on protocol change',
        created: '2026-07-05',
        lastUpdated: '2026-08-07',
      });
    });
  });

  test('a missing-summary-only fixture plans only summary; existing dates pass through unchanged', () => {
    withFixtureDir((dir) => {
      write(
        dir,
        'ADR-007-x.md',
        '---\ntype: adr\nstatus: accepted\ncreated: 2026-07-11\nlast_updated: 2026-07-11\nreview_trigger: "on protocol change"\n---\n\n# ADR-007\n',
      );
      const indexContent = `${INDEX_HEADER}| ADR-007-x.md | Toolchain re-seating | adr | accepted | on protocol change |\n`;
      const plan = computeAdrFrontmatterBackfillPlan(dir, indexContent, noDates);
      expect(plan.exceptions).toEqual([]);
      expect(plan.entries[0].addedKeys).toEqual(['summary']);
      expect(plan.entries[0].fields).toEqual({
        type: 'adr',
        summary: 'Toolchain re-seating',
        status: 'accepted',
        reviewTrigger: 'on protocol change',
        created: '2026-07-11',
        lastUpdated: '2026-07-11',
      });
    });
  });

  test('a missing-summary+review_trigger fixture plans both; existing dates pass through unchanged', () => {
    withFixtureDir((dir) => {
      write(
        dir,
        'ADR-028-x.md',
        '---\ntype: adr\nstatus: accepted\ncreated: 2026-08-20\nlast_updated: 2026-08-21\n---\n\n# ADR-028\n',
      );
      const indexContent = `${INDEX_HEADER}| ADR-028-x.md | Cursor Pattern C-lite | adr | accepted | on ADR acceptance |\n`;
      const plan = computeAdrFrontmatterBackfillPlan(dir, indexContent, noDates);
      expect(plan.exceptions).toEqual([]);
      expect(plan.entries[0].addedKeys).toEqual(['summary', 'review_trigger']);
      expect(plan.entries[0].fields).toEqual({
        type: 'adr',
        summary: 'Cursor Pattern C-lite',
        status: 'accepted',
        reviewTrigger: 'on ADR acceptance',
        created: '2026-08-20',
        lastUpdated: '2026-08-21',
      });
    });
  });

  test('a fully-compliant fixture is skipped, no fields added', () => {
    withFixtureDir((dir) => {
      write(
        dir,
        'ADR-038-x.md',
        `---\ntype: adr\nsummary: ${JSON.stringify('Already compliant')}\nstatus: accepted\nreview_trigger: "on ADR acceptance"\ncreated: 2026-09-01\nlast_updated: 2026-09-01\n---\n\n# ADR-038\n`,
      );
      const indexContent = `${INDEX_HEADER}| ADR-038-x.md | Already compliant | adr | accepted | on ADR acceptance |\n`;
      const plan = computeAdrFrontmatterBackfillPlan(dir, indexContent, noDates);
      expect(plan.exceptions).toEqual([]);
      expect(plan.entries).toEqual([{ path: 'ADR-038-x.md', skipped: true, addedKeys: [] }]);
    });
  });

  test('a fixture with no matching INDEX.md row is reported as an exception, not written', () => {
    withFixtureDir((dir) => {
      write(dir, 'ADR-999-orphan.md', '---\ntype: adr\nstatus: accepted\n---\n\n# ADR-999\n');
      const plan = computeAdrFrontmatterBackfillPlan(dir, INDEX_HEADER, () => ({
        created: '2026-01-01',
        lastUpdated: '2026-01-01',
      }));
      expect(plan.entries).toEqual([]);
      expect(plan.exceptions).toEqual([
        { path: 'ADR-999-orphan.md', reason: expect.any(String) },
      ]);
    });
  });

  test('a dateLookup returning null for an unresolvable creation date is reported as an exception, not written', () => {
    withFixtureDir((dir) => {
      write(dir, 'ADR-998-x.md', '---\nstatus: accepted\n---\n\n# ADR-998\n');
      const indexContent = `${INDEX_HEADER}| ADR-998-x.md | A summary | adr | accepted | on ADR acceptance |\n`;
      const plan = computeAdrFrontmatterBackfillPlan(dir, indexContent, noDates);
      expect(plan.entries).toEqual([]);
      expect(plan.exceptions).toEqual([
        { path: 'ADR-998-x.md', reason: expect.any(String) },
      ]);
    });
  });

  test('YAML-safe encode/decode round-trip for a summary containing a colon, double quote, and backtick', () => {
    withFixtureDir((dir) => {
      const tricky = 'Uses `git status`: prints "clean" when empty';
      write(dir, 'ADR-997-x.md', '---\nstatus: accepted\n---\n\n# ADR-997\n');
      const indexContent = `${INDEX_HEADER}| ADR-997-x.md | ${tricky} | adr | accepted | on ADR acceptance |\n`;
      const plan = computeAdrFrontmatterBackfillPlan(dir, indexContent, () => ({
        created: '2026-01-01',
        lastUpdated: '2026-01-01',
      }));
      expect(plan.exceptions).toEqual([]);
      expect(plan.entries[0].fields?.summary).toBe(tricky);
    });
  });
});

describe('insertMissingFrontmatterKeys', () => {
  const fields: AdrFrontmatterFields = {
    type: 'adr',
    summary: 'A summary',
    status: 'accepted',
    reviewTrigger: 'on ADR acceptance',
    created: '2026-09-04',
    lastUpdated: '2026-09-04',
  };

  test('inserts all five missing keys around a lone status line in canonical order', () => {
    const result = insertMissingFrontmatterKeys(
      ['status: accepted'],
      fields,
      ['type', 'summary', 'review_trigger', 'created', 'last_updated'],
    );
    expect(result).toEqual([
      'type: adr',
      `summary: ${JSON.stringify('A summary')}`,
      'status: accepted',
      `review_trigger: ${JSON.stringify('on ADR acceptance')}`,
      'created: 2026-09-04',
      'last_updated: 2026-09-04',
    ]);
  });

  test('preserves an unrelated existing key (e.g. tracking_initiative:) in its relative position', () => {
    const result = insertMissingFrontmatterKeys(
      ['type: adr', 'tracking_initiative: backlog-campaign-v2', 'status: accepted', 'scope: orchestration'],
      fields,
      ['summary', 'review_trigger', 'created', 'last_updated'],
    );
    expect(result).toEqual([
      'type: adr',
      `summary: ${JSON.stringify('A summary')}`,
      'tracking_initiative: backlog-campaign-v2',
      'status: accepted',
      `review_trigger: ${JSON.stringify('on ADR acceptance')}`,
      'created: 2026-09-04',
      'last_updated: 2026-09-04',
      'scope: orchestration',
    ]);
  });

  test('never reorders a multi-line related: block when only summary is missing', () => {
    const result = insertMissingFrontmatterKeys(
      [
        'type: adr',
        'status: accepted',
        'created: 2026-07-11',
        'last_updated: 2026-07-11',
        'review_trigger: "on protocol change"',
        'related:',
        '  - documentation/decisions/ADR-003-x.md',
      ],
      { ...fields, reviewTrigger: 'on protocol change', created: '2026-07-11', lastUpdated: '2026-07-11' },
      ['summary'],
    );
    expect(result).toEqual([
      'type: adr',
      `summary: ${JSON.stringify('A summary')}`,
      'status: accepted',
      'created: 2026-07-11',
      'last_updated: 2026-07-11',
      'review_trigger: "on protocol change"',
      'related:',
      '  - documentation/decisions/ADR-003-x.md',
    ]);
  });
});

describe('applyAdrFrontmatterBackfill', () => {
  test('writes the planned entry and preserves body content byte-for-byte', () => {
    withFixtureDir((dir) => {
      const original = '---\nstatus: accepted\n---\n\n# ADR-037\n\nBody text.\n';
      write(dir, 'ADR-037-x.md', original);
      const entries = [
        {
          path: 'ADR-037-x.md',
          skipped: false,
          addedKeys: ['type', 'summary', 'review_trigger', 'created', 'last_updated'],
          fields: {
            type: 'adr',
            summary: 'A summary',
            status: 'accepted',
            reviewTrigger: 'on ADR acceptance',
            created: '2026-09-04',
            lastUpdated: '2026-09-04',
          },
        },
      ];
      const result = applyAdrFrontmatterBackfill(dir, entries);
      expect(result.exceptions).toEqual([]);
      expect(result.migrated).toEqual(['ADR-037-x.md']);
      const content = read(dir, 'ADR-037-x.md');
      expect(content).toBe(
        `---\ntype: adr\nsummary: ${JSON.stringify('A summary')}\nstatus: accepted\nreview_trigger: ${JSON.stringify('on ADR acceptance')}\ncreated: 2026-09-04\nlast_updated: 2026-09-04\n---\n\n# ADR-037\n\nBody text.\n`,
      );
    });
  });

  test('never writes anything for a skipped entry', () => {
    withFixtureDir((dir) => {
      const original = '---\ntype: adr\nsummary: "Already set"\nstatus: accepted\n---\n\n# Foo\n';
      write(dir, 'ADR-038-x.md', original);
      const result = applyAdrFrontmatterBackfill(dir, [{ path: 'ADR-038-x.md', skipped: true, addedKeys: [] }]);
      expect(result.migrated).toEqual([]);
      expect(result.exceptions).toEqual([]);
      expect(read(dir, 'ADR-038-x.md')).toBe(original);
    });
  });

  test('preserves an unrelated related: block untouched when writing', () => {
    withFixtureDir((dir) => {
      const original =
        '---\ntype: adr\nstatus: accepted\ncreated: 2026-07-11\nlast_updated: 2026-07-11\nreview_trigger: "on protocol change"\nrelated:\n  - documentation/decisions/ADR-003-x.md\n---\n\n# ADR-007\n';
      write(dir, 'ADR-007-x.md', original);
      const entries = [
        {
          path: 'ADR-007-x.md',
          skipped: false,
          addedKeys: ['summary'],
          fields: {
            type: 'adr',
            summary: 'Toolchain re-seating',
            status: 'accepted',
            reviewTrigger: 'on protocol change',
            created: '2026-07-11',
            lastUpdated: '2026-07-11',
          },
        },
      ];
      const result = applyAdrFrontmatterBackfill(dir, entries);
      expect(result.exceptions).toEqual([]);
      const content = read(dir, 'ADR-007-x.md');
      expect(content).toBe(
        `---\ntype: adr\nsummary: ${JSON.stringify('Toolchain re-seating')}\nstatus: accepted\ncreated: 2026-07-11\nlast_updated: 2026-07-11\nreview_trigger: "on protocol change"\nrelated:\n  - documentation/decisions/ADR-003-x.md\n---\n\n# ADR-007\n`,
      );
    });
  });

  test('a file with no parseable frontmatter block goes into the exceptions list, file left untouched', () => {
    withFixtureDir((dir) => {
      const original = '# No frontmatter here\n';
      write(dir, 'ADR-996-x.md', original);
      const entries = [
        {
          path: 'ADR-996-x.md',
          skipped: false,
          addedKeys: ['type', 'summary', 'status', 'review_trigger', 'created', 'last_updated'],
          fields: {
            type: 'adr',
            summary: 'A summary',
            status: 'accepted',
            reviewTrigger: 'on ADR acceptance',
            created: '2026-09-04',
            lastUpdated: '2026-09-04',
          },
        },
      ];
      const result = applyAdrFrontmatterBackfill(dir, entries);
      expect(result.migrated).toEqual([]);
      expect(result.exceptions).toEqual([{ path: 'ADR-996-x.md', reason: expect.any(String) }]);
      expect(read(dir, 'ADR-996-x.md')).toBe(original);
    });
  });

  test('round-trips a tricky summary (colon, double quote, backtick) byte-identically after insertion', () => {
    withFixtureDir((dir) => {
      const tricky = 'Uses `git status`: prints "clean" when empty';
      write(dir, 'ADR-995-x.md', '---\nstatus: accepted\n---\n\n# ADR-995\n');
      const entries = [
        {
          path: 'ADR-995-x.md',
          skipped: false,
          addedKeys: ['type', 'summary', 'review_trigger', 'created', 'last_updated'],
          fields: {
            type: 'adr',
            summary: tricky,
            status: 'accepted',
            reviewTrigger: 'on ADR acceptance',
            created: '2026-09-04',
            lastUpdated: '2026-09-04',
          },
        },
      ];
      const result = applyAdrFrontmatterBackfill(dir, entries);
      expect(result.exceptions).toEqual([]);
      const content = read(dir, 'ADR-995-x.md');
      const summaryLine = content.split('\n').find((l) => l.startsWith('summary:'));
      expect(summaryLine).toBe(`summary: ${JSON.stringify(tricky)}`);
    });
  });
});

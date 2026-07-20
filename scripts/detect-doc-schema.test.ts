import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT_PATH = path.join(import.meta.dir, 'detect-doc-schema.sh');

const makeFixtureDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'detect-doc-schema-test-'));

const writeFixture = (fixtureDir: string, name: string, content: string): string => {
  const filePath = path.join(fixtureDir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
};

const run = (mode: 'index' | 'frontmatter', filePath: string) =>
  spawnSync('bash', [SCRIPT_PATH, mode, filePath], { encoding: 'utf-8' });

describe('detect-doc-schema.sh — index mode', () => {
  test('mercure header (ADR | Title | Status | Date) -> schema=mercure', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(
        fixtureDir,
        'INDEX.md',
        '# Decision Index\n\n| ADR | Title | Status | Date |\n|-----|-------|--------|------|\n| ADR-001 | Foo | Accepted | 2026-01-01 |\n'
      );
      const result = run('index', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=mercure\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('blackhole header (path | summary | type | status | review_trigger) -> schema=blackhole', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(
        fixtureDir,
        'INDEX.md',
        '# Decision Index\n\n| path | summary | type | status | review_trigger |\n|------|---------|------|--------|----------------|\n| ADR-001-foo.md | Foo | adr | Accepted | on protocol change |\n'
      );
      const result = run('index', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=blackhole\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('short/missing-column header -> schema=ambiguous', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(
        fixtureDir,
        'INDEX.md',
        '| ADR | Title | Status |\n|-----|-------|--------|\n| ADR-001 | Foo | Accepted |\n'
      );
      const result = run('index', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=ambiguous\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('header with extra whitespace/case variance normalizes to schema=mercure', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(
        fixtureDir,
        'INDEX.md',
        '|  ADR  |  Title  |  STATUS  |  Date  |\n|-------|---------|----------|--------|\n|  ADR-001  |  Foo  |  Accepted  |  2026-01-01  |\n'
      );
      const result = run('index', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=mercure\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('reordered columns -> schema=ambiguous', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(
        fixtureDir,
        'INDEX.md',
        '| Title | ADR | Status | Date |\n|-------|-----|--------|------|\n| Foo | ADR-001 | Accepted | 2026-01-01 |\n'
      );
      const result = run('index', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=ambiguous\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('no header row in file -> schema=ambiguous', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(fixtureDir, 'INDEX.md', '# Just some prose\n\nNo table here at all.\n');
      const result = run('index', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=ambiguous\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

describe('detect-doc-schema.sh — frontmatter mode', () => {
  test('mercure-shaped frontmatter (number, source, scope, ...) -> schema=mercure', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(
        fixtureDir,
        'ADR-013-foo.md',
        '---\ntype: adr\nnumber: 13\ntitle: Some Decision\nstatus: Accepted\ncreated: 2026-07-20\nsource: brainstorm\nscope: initiative\n---\n\n# ADR-013 Some Decision\n'
      );
      const result = run('frontmatter', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=mercure\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('blackhole-shaped frontmatter (last_updated, review_trigger) -> schema=blackhole', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(
        fixtureDir,
        'ADR-013-foo.md',
        '---\ntype: adr\nstatus: current\ncreated: 2026-07-20\nlast_updated: 2026-07-20\nreview_trigger: "on protocol change"\n---\n\n# ADR-013 Some Decision\n'
      );
      const result = run('frontmatter', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=blackhole\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('mixed discriminator keys from both schemas -> schema=ambiguous', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(
        fixtureDir,
        'ADR-013-foo.md',
        '---\ntype: adr\nstatus: Accepted\ncreated: 2026-07-20\nnumber: 13\nlast_updated: 2026-07-20\n---\n\n# ADR-013 Some Decision\n'
      );
      const result = run('frontmatter', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=ambiguous\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('only-shared-keys frontmatter (no discriminator from either set) -> schema=ambiguous', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(
        fixtureDir,
        'ADR-013-foo.md',
        '---\ntype: adr\nstatus: current\ncreated: 2026-07-20\nrelated: []\nsupersedes: null\n---\n\n# ADR-013 Some Decision\n'
      );
      const result = run('frontmatter', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=ambiguous\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('unparsable/missing frontmatter block -> schema=ambiguous', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const filePath = writeFixture(fixtureDir, 'ADR-013-foo.md', '# ADR-013 Some Decision\n\nNo frontmatter here.\n');
      const result = run('frontmatter', filePath);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('schema=ambiguous\n');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

describe('detect-doc-schema.sh — stdout contract', () => {
  test('stdout is exactly one line matching schema=(mercure|blackhole|ambiguous) in every case', () => {
    const fixtureDir = makeFixtureDir();
    try {
      const indexPath = writeFixture(
        fixtureDir,
        'INDEX.md',
        '| ADR | Title | Status | Date |\n|-----|-------|--------|------|\n'
      );
      const frontmatterPath = writeFixture(
        fixtureDir,
        'ADR-013-foo.md',
        '---\ntype: adr\nlast_updated: 2026-07-20\nreview_trigger: "on protocol change"\n---\n'
      );
      const ambiguousPath = writeFixture(fixtureDir, 'plain.md', 'no table, no frontmatter\n');

      for (const result of [run('index', indexPath), run('frontmatter', frontmatterPath), run('index', ambiguousPath)]) {
        expect(result.status).toBe(0);
        const lines = result.stdout.split('\n').filter((l) => l.length > 0);
        expect(lines.length).toBe(1);
        expect(lines[0]).toMatch(/^schema=(mercure|blackhole|ambiguous)$/);
      }
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

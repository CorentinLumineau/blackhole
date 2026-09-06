import { describe, expect, test, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { makeTempDir } from './fs.ts';
import { buildMercureVcodeSnapshot, parseMercureVcodeTable } from './mercure-vcode-snapshot.ts';

// Issue #869 — mechanizes V-code severity parity against mercure (ADR-013 D1 extension).
// This file covers the pure table parser (parseMercureVcodeTable) and the fixture-driven
// snapshot builder (buildMercureVcodeSnapshot) — never the real mercure clone at
// /Users/morphism/Documents/git/mercure, which does not exist in CI (plan Task 4 AC).

describe('parseMercureVcodeTable', () => {
  test('extracts id/severity/description from a 3-column | ID | Severity | Description | table', () => {
    const content = [
      '# V-codes: Fixture',
      '',
      '| ID | Severity | Description |',
      '|----|----------|-------------|',
      '| V-SOLID-01 | CRITICAL | SRP violation |',
      '| V-DOC-GOV-01 | HIGH | Search-before-write |',
    ].join('\n');
    expect(parseMercureVcodeTable(content)).toEqual([
      { id: 'V-SOLID-01', severity: 'CRITICAL', description: 'SRP violation' },
      { id: 'V-DOC-GOV-01', severity: 'HIGH', description: 'Search-before-write' },
    ]);
  });

  test('handles a hyphenated-category id and a lowercase-letter-suffix id', () => {
    const content = [
      '| ID | Severity | Description |',
      '|----|----------|-------------|',
      '| V-DOC-GOV-02 | MEDIUM | Missing lifecycle frontmatter |',
      '| V-UX-04a | MEDIUM | Colour-only meaning |',
    ].join('\n');
    expect(parseMercureVcodeTable(content)).toEqual([
      { id: 'V-DOC-GOV-02', severity: 'MEDIUM', description: 'Missing lifecycle frontmatter' },
      { id: 'V-UX-04a', severity: 'MEDIUM', description: 'Colour-only meaning' },
    ]);
  });

  test('skips the header row, the separator row, and non-table prose', () => {
    const content = [
      '### Some Category (V-FAKE)',
      '',
      '| ID | Severity | Description |',
      '|----|----------|-------------|',
      '| V-FAKE-01 | LOW | A fixture row |',
      '',
      'Some prose mentioning V-FAKE-02 that is not a table row.',
    ].join('\n');
    expect(parseMercureVcodeTable(content)).toEqual([{ id: 'V-FAKE-01', severity: 'LOW', description: 'A fixture row' }]);
  });
});

describe('buildMercureVcodeSnapshot', () => {
  const writeFixtureRoot = (tmp: string, opts: { fileNames?: string[]; withGit?: boolean } = {}): void => {
    const refsDir = path.join(tmp, 'mercure-plugin', 'rules', 'references');
    fs.mkdirSync(refsDir, { recursive: true });
    const fileNames = opts.fileNames ?? [
      'v-codes-ada.md',
      'v-codes-architecture.md',
      'v-codes-delegation.md',
      'v-codes-doc-gov.md',
      'v-codes-quality.md',
      'v-codes-security.md',
      'v-codes-testing.md',
      'v-codes-ux.md',
    ];
    for (const [i, fileName] of fileNames.entries()) {
      fs.writeFileSync(
        path.join(refsDir, fileName),
        ['| ID | Severity | Description |', '|----|----------|-------------|', `| V-FIXTURE-${i} | MEDIUM | Fixture row for ${fileName} |`].join('\n'),
      );
    }
    const pluginDir = path.join(tmp, 'mercure-plugin', '.claude-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ version: '9.99.0' }));

    if (opts.withGit) {
      execSync('git init -q', { cwd: tmp });
      execSync('git config user.email test@example.com', { cwd: tmp });
      execSync('git config user.name test', { cwd: tmp });
      execSync('git add -A', { cwd: tmp });
      execSync('git commit -q -m fixture', { cwd: tmp });
    }
  };

  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const tempDir = (): string => {
    const dir = makeTempDir('mercure-vcode-snapshot-test');
    tempDirs.push(dir);
    return dir;
  };

  test('merges rows from all 8 fixture files into one codes map, reads version, and reads git commit', () => {
    const tmp = tempDir();
    writeFixtureRoot(tmp, { withGit: true });
    const now = new Date('2026-09-07T00:00:00.000Z');
    const snapshot = buildMercureVcodeSnapshot(tmp, now);

    expect(Object.keys(snapshot.codes).length).toBe(8);
    expect(snapshot.codes['V-FIXTURE-0']).toEqual({ severity: 'MEDIUM', description: 'Fixture row for v-codes-ada.md' });
    expect(snapshot.mercure_version).toBe('9.99.0');
    expect(snapshot.source_files.length).toBe(8);
    expect(snapshot.synced_at).toBe(now.toISOString());
    expect(typeof snapshot.mercure_commit).toBe('string');
    expect(snapshot.mercure_commit).not.toBeNull();
  });

  test('a non-git mercure root nulls mercure_commit rather than crashing the sync', () => {
    const tmp = tempDir();
    writeFixtureRoot(tmp, { withGit: false });
    const snapshot = buildMercureVcodeSnapshot(tmp);
    expect(snapshot.mercure_commit).toBeNull();
  });

  test('aborts when the references directory does not have exactly 8 v-codes-*.md files (a 9th file)', () => {
    const tmp = tempDir();
    writeFixtureRoot(tmp, {
      fileNames: [
        'v-codes-ada.md',
        'v-codes-architecture.md',
        'v-codes-delegation.md',
        'v-codes-doc-gov.md',
        'v-codes-quality.md',
        'v-codes-security.md',
        'v-codes-testing.md',
        'v-codes-ux.md',
        'v-codes-new-domain.md',
      ],
    });
    expect(() => buildMercureVcodeSnapshot(tmp)).toThrow(/expected 8 v-codes-\*\.md files/);
  });

  test('aborts when a v-codes-*.md file has no parseable rows (a header shape change)', () => {
    const tmp = tempDir();
    writeFixtureRoot(tmp);
    // Overwrite one fixture file with a differently-shaped table (columns reordered, no `V-` id
    // in the first cell) — the parser correctly extracts zero rows from it.
    const refsDir = path.join(tmp, 'mercure-plugin', 'rules', 'references');
    fs.writeFileSync(
      path.join(refsDir, 'v-codes-ada.md'),
      ['| Severity | ID | Description |', '|----------|----|-------------|', '| MEDIUM | V-FIXTURE-BAD | Reordered columns |'].join('\n'),
    );
    expect(() => buildMercureVcodeSnapshot(tmp)).toThrow(/no \| ID \| Severity \| Description \| rows found/);
  });
});

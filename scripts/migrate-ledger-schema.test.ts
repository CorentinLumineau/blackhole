import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { migrateFindings, runMigration } from './migrate-ledger-schema.ts';

// Fixture-driven coverage for migrateFindings' three-way coercion rule and runMigration's file
// protocol, isolated from the live .blackhole/findings-ledger.json via makeTempDir (never
// touches real campaign state — Codebase Conventions).

describe('migrateFindings', () => {
  test('string issue_ref coerces to a number, row counted as changed', () => {
    const { migrated, changed } = migrateFindings([
      { id: 'F-1', issue_ref: '715', pr_ref: null },
    ]);
    expect(migrated[0].issue_ref).toBe(715);
    expect(typeof migrated[0].issue_ref).toBe('number');
    expect(changed).toBe(1);
  });

  test('legacy "pr" key renames to pr_ref, row counted as changed', () => {
    const { migrated, changed } = migrateFindings([
      { id: 'F-2', issue_ref: 100, pr: 745 },
    ]);
    expect(migrated[0].pr_ref).toBe(745);
    expect('pr' in migrated[0]).toBe(false);
    expect(changed).toBe(1);
  });

  test('pr_ref stored as a string coerces to a number, row counted as changed', () => {
    const { migrated, changed } = migrateFindings([
      { id: 'F-3', issue_ref: 100, pr_ref: '773' },
    ]);
    expect(migrated[0].pr_ref).toBe(773);
    expect(typeof migrated[0].pr_ref).toBe('number');
    expect(changed).toBe(1);
  });

  test('a row already correct (number issue_ref, number|null pr_ref) is left untouched and not counted', () => {
    const { migrated, changed } = migrateFindings([
      { id: 'F-4', issue_ref: 100, pr_ref: null },
      { id: 'F-5', issue_ref: 101, pr_ref: 200 },
    ]);
    expect(migrated[0]).toEqual({ id: 'F-4', issue_ref: 100, pr_ref: null });
    expect(migrated[1]).toEqual({ id: 'F-5', issue_ref: 101, pr_ref: 200 });
    expect(changed).toBe(0);
  });

  test('a row with pr_ref key entirely absent is left untouched and not counted (out of scope — never through the aggregator)', () => {
    const { migrated, changed } = migrateFindings([{ id: 'F-6', issue_ref: 100 }]);
    expect('pr_ref' in migrated[0]).toBe(false);
    expect(changed).toBe(0);
  });

  test('a row carrying both "pr" and "pr_ref" throws, naming the row id', () => {
    expect(() =>
      migrateFindings([{ id: 'F-7', issue_ref: 100, pr: 745, pr_ref: 745 }]),
    ).toThrow(/F-7/);
  });

  test('a row with a non-numeric issue_ref string throws, naming the row id', () => {
    expect(() =>
      migrateFindings([{ id: 'F-8', issue_ref: 'not-a-number', pr_ref: null }]),
    ).toThrow(/F-8/);
  });

  test('row count is identical before and after on the success path', () => {
    const input = [
      { id: 'F-9', issue_ref: '1', pr_ref: null },
      { id: 'F-10', issue_ref: 2, pr: 3 },
      { id: 'F-11', issue_ref: 4, pr_ref: 5 },
    ];
    const { migrated } = migrateFindings(input);
    expect(migrated).toHaveLength(input.length);
  });
});

describe('runMigration (file protocol, temp-dir isolated)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('archives a snapshot, writes atomically, and reports before/changed counts', () => {
    const dir = makeTempDir('migrate-ledger-schema-');
    tempDirs.push(dir);
    const livePath = path.join(dir, 'findings-ledger.json');
    const archiveDir = path.join(dir, 'archive');
    fs.writeFileSync(
      livePath,
      JSON.stringify({
        refreshed_at: '2026-01-01T00:00:00.000Z',
        next_id: 3,
        findings: [
          { id: 'F-1', issue_ref: '715', pr_ref: null },
          { id: 'F-2', issue_ref: 100, pr_ref: 200 },
        ],
      }),
    );

    const { before, changed } = runMigration(livePath, archiveDir);

    expect(before).toBe(2);
    expect(changed).toBe(1);

    const written = JSON.parse(fs.readFileSync(livePath, 'utf-8'));
    expect(written.findings).toHaveLength(2);
    expect(written.findings[0].issue_ref).toBe(715);
    expect(typeof written.findings[0].issue_ref).toBe('number');

    const snapshots = fs.readdirSync(archiveDir);
    expect(snapshots).toHaveLength(1);
    const snapshot = JSON.parse(fs.readFileSync(path.join(archiveDir, snapshots[0]), 'utf-8'));
    expect(snapshot.findings[0].issue_ref).toBe('715');
  });

  test('re-running against an already-clean ledger is a no-op (idempotent)', () => {
    const dir = makeTempDir('migrate-ledger-schema-');
    tempDirs.push(dir);
    const livePath = path.join(dir, 'findings-ledger.json');
    const archiveDir = path.join(dir, 'archive');
    fs.writeFileSync(
      livePath,
      JSON.stringify({ findings: [{ id: 'F-1', issue_ref: 715, pr_ref: null }] }),
    );

    const first = runMigration(livePath, archiveDir);
    expect(first.changed).toBe(0);

    const second = runMigration(livePath, archiveDir);
    expect(second.changed).toBe(0);
    expect(second.before).toBe(1);
  });
});

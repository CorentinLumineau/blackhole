import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runRecord } from '../../campaign-record.ts';
import { addScopeEntry, newestFirst, readDecisions, readScopeEntries, scopeEntryFor } from './record.ts';
import type { ScopeEntry } from './types.ts';

const dirs: string[] = [];
function campaign(config: Record<string, unknown> = { repo: 'acme/widgets', merge_mode: 'leave-open' }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-record-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const NOW = new Date('2026-11-13T09:00:00.000Z');
const config = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));

describe('addScopeEntry — the record says what holds now', () => {
  const filter: ScopeEntry = { kind: 'in', text: 'Open issues in milestone v1.0', set_at: '2026-11-10', filter: true };

  test('a new filter line replaces the old one', () => {
    const next = addScopeEntry([filter], { ...filter, text: 'Open issues labelled bug', set_at: '2026-11-12' });
    expect(next).toEqual([{ kind: 'in', text: 'Open issues labelled bug', set_at: '2026-11-12', filter: true }]);
  });

  test('an entry naming refs takes them from older entries, and drops an entry left empty', () => {
    const parked: ScopeEntry = { kind: 'parked', text: 'Export rework', set_at: '2026-11-11', refs: [12, 14] };
    const back = addScopeEntry([filter, parked], { kind: 'in', text: 'Export rework is back', set_at: '2026-11-12', refs: [12, 14] });
    expect(back.map((e) => e.kind)).toEqual(['in', 'in']);
    const partial = addScopeEntry([filter, parked], { kind: 'out', text: 'Not ours', set_at: '2026-11-12', refs: [14] });
    expect(partial[1]).toMatchObject({ kind: 'parked', refs: [12] });
    expect(scopeEntryFor(partial, 14)?.kind).toBe('out');
  });

  test('the same entry twice is recorded once', () => {
    const e: ScopeEntry = { kind: 'deferred', text: 'Docs pass', set_at: '2026-11-12' };
    expect(addScopeEntry(addScopeEntry([], e), e)).toHaveLength(1);
  });

  test('re-recording an entry with refs, or the filter line, on a later day keeps its place and its date', () => {
    const parked: ScopeEntry = { kind: 'parked', text: 'Export rework', set_at: '2026-11-11', refs: [12, 14] };
    const deferred: ScopeEntry = { kind: 'deferred', text: 'Docs pass', set_at: '2026-11-11' };
    const entries = [filter, parked, deferred];
    expect(addScopeEntry(entries, { ...parked, set_at: '2026-11-13' })).toEqual(entries);
    expect(addScopeEntry(entries, { ...filter, set_at: '2026-11-13' })).toEqual(entries);
  });
});

describe('readScopeEntries / readDecisions — malformed state is skipped, never guessed', () => {
  test('entries with an unknown kind, no text or a bad date are dropped', () => {
    const entries = readScopeEntries({
      campaign_scope: {
        entries: [
          { kind: 'in', text: 'ok', set_at: '2026-11-10' },
          { kind: 'maybe', text: 'x', set_at: '2026-11-10' },
          { kind: 'out', text: '', set_at: '2026-11-10' },
          { kind: 'out', text: 'y', set_at: 'yesterday' },
          { kind: 'parked', text: 'z', set_at: '2026-11-10', refs: [3, 'x', -1, 3] },
        ],
      },
    });
    expect(entries).toEqual([
      { kind: 'in', text: 'ok', set_at: '2026-11-10' },
      { kind: 'parked', text: 'z', set_at: '2026-11-10', refs: [3] },
    ]);
    expect(readScopeEntries({})).toEqual([]);
  });

  test('decisions are newest first, same-day ones last recorded first', () => {
    expect(
      newestFirst([
        { date: '2026-11-10', text: 'a' },
        { date: '2026-11-12', text: 'b' },
        { date: '2026-11-12', text: 'c' },
      ]).map((d) => d.text),
    ).toEqual(['c', 'b', 'a']);
  });
});

describe('campaign-record CLI', () => {
  test('scope writes config.json campaign_scope and keeps every other field', () => {
    const dir = campaign();
    runRecord(['scope', '--kind', 'in', '--text', 'Open issues in milestone v1.0', '--filter', '--campaign-dir', dir], NOW);
    runRecord(['scope', '--kind', 'blocked-upstream', '--text', 'Waits on the vendor API', '--refs', '#7', '--reason', 'vendor ticket open', '--campaign-dir', dir], NOW);
    const c = config(dir);
    expect(c.repo).toBe('acme/widgets');
    expect(c.merge_mode).toBe('leave-open');
    expect(c.campaign_scope.entries).toEqual([
      { kind: 'in', text: 'Open issues in milestone v1.0', set_at: '2026-11-13', filter: true },
      { kind: 'blocked_upstream', text: 'Waits on the vendor API', set_at: '2026-11-13', reason: 'vendor ticket open', refs: [7] },
    ]);
  });

  test('re-running the same command changes nothing (idempotent)', () => {
    const dir = campaign();
    const args = ['scope', '--kind', 'parked', '--text', 'Theme work', '--refs', '4', '--campaign-dir', dir];
    runRecord(args, NOW);
    const once = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    runRecord(args, NOW);
    expect(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8')).toBe(once);
  });

  test('re-running a refs entry and the filter line after other entries, on a later day, leaves the file unchanged', () => {
    const dir = campaign();
    const filterArgs = ['scope', '--kind', 'in', '--text', 'Open issues in milestone v1.0', '--filter', '--campaign-dir', dir];
    const parkedArgs = ['scope', '--kind', 'parked', '--text', 'Theme work', '--refs', '4,5', '--reason', 'needs a design', '--campaign-dir', dir];
    runRecord(filterArgs, NOW);
    runRecord(parkedArgs, NOW);
    runRecord(['scope', '--kind', 'deferred', '--text', 'Docs pass', '--campaign-dir', dir], NOW);
    const once = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    const later = new Date('2026-11-20T09:00:00.000Z');
    runRecord(parkedArgs, later);
    runRecord(filterArgs, later);
    expect(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8')).toBe(once);
  });

  test('decision appends to owner-decisions.json with today as the default date', () => {
    const dir = campaign();
    runRecord(['decision', '--text', 'Merge the dependency bumps first', '--campaign-dir', dir], NOW);
    runRecord(['decision', '--text', 'Park the theme work', '--refs', '4', '--date', '2026-11-12', '--campaign-dir', dir], NOW);
    runRecord(['decision', '--text', 'Park the theme work', '--refs', '4', '--date', '2026-11-12', '--campaign-dir', dir], NOW);
    expect(readDecisions(dir)).toEqual([
      { date: '2026-11-13', text: 'Merge the dependency bumps first' },
      { date: '2026-11-12', text: 'Park the theme work', refs: [4] },
    ]);
  });

  test('bad input throws and writes nothing', () => {
    const dir = campaign();
    const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    expect(() => runRecord(['scope', '--kind', 'maybe', '--text', 'x', '--campaign-dir', dir], NOW)).toThrow(/--kind must be one of/);
    expect(() => runRecord(['scope', '--kind', 'out', '--campaign-dir', dir], NOW)).toThrow(/--text is required/);
    expect(() => runRecord(['scope', '--kind', 'out', '--text', 'x', '--filter', '--campaign-dir', dir], NOW)).toThrow(/--filter/);
    expect(() => runRecord(['scope', '--kind', 'out', '--text', 'x', '--refs', 'a', '--campaign-dir', dir], NOW)).toThrow(/--refs/);
    expect(() => runRecord(['decision', '--text', 'x', '--date', '13/11', '--campaign-dir', dir], NOW)).toThrow(/YYYY-MM-DD/);
    expect(() => runRecord(['note', '--campaign-dir', dir], NOW)).toThrow(/Unknown subcommand/);
    expect(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8')).toBe(before);
    expect(fs.existsSync(path.join(dir, 'owner-decisions.json'))).toBe(false);
  });

  test('a decisions file it cannot read is refused, not overwritten', () => {
    const dir = campaign();
    fs.writeFileSync(path.join(dir, 'owner-decisions.json'), '{"decisions": "oops"}');
    expect(() => runRecord(['decision', '--text', 'x', '--campaign-dir', dir], NOW)).toThrow(/no "decisions" array/);
    expect(fs.readFileSync(path.join(dir, 'owner-decisions.json'), 'utf-8')).toBe('{"decisions": "oops"}');
    expect(readDecisions(dir)).toEqual([]);
  });
});

import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildStatusData, STATUS_DATASET_IDS, writeStatusData } from './data.ts';
import { parseStatusArgs } from './cli.ts';
import { fixtureReport as report } from './data-fixture.ts';
import { STALE_AFTER_HOURS } from './staleness.ts';
import type { QueueJson } from './types.ts';

describe('buildStatusData — one source with --json', () => {
  const r = report();
  const data = buildStatusData(r);

  test('overview is one row whose counts, headline and state equal the report', () => {
    expect(data.overview).toHaveLength(1);
    expect(data.overview[0]).toMatchObject({
      title: 'acme/widgets',
      headline: r.headline.text,
      headline_source: r.headline.source,
      state_kind: r.state.kind,
      last_activity_at: r.state.last_activity_at,
      generated_at: r.generated_at,
      forge_checked: r.forge_checked,
      ...r.stage_counts,
    });
  });

  test('stale_after_hours is the one STALE_AFTER_HOURS constant', () => {
    expect(data.overview[0].stale_after_hours).toBe(STALE_AFTER_HOURS);
  });

  test('board, moves, blockers, streams, config, decisions and links are the report lists, row for row', () => {
    expect(data.board.map((c) => c.ref)).toEqual(r.board.map((c) => c.ref));
    expect(data.board.map((c) => c.stage)).toEqual(r.board.map((c) => c.stage));
    expect(data.moves).toEqual(r.moves);
    expect(data.blockers.map((b) => b.text)).toEqual(r.blockers.map((b) => b.text));
    expect(data.streams).toEqual(r.streams);
    expect(data.config).toEqual(r.config_rows);
    expect(data.decisions).toEqual([{ date: '2026-11-10', text: 'Leave every PR open for review' }]);
    expect(data.links).toEqual(r.links);
  });

  test('your move holds the PR delivered at LGTM with its link, then the owner gate', () => {
    expect(data.moves.map((m) => m.ref)).toEqual([10, 1]);
    expect(String(data.moves[0].url)).toBe('https://github.com/acme/widgets/pull/10');
  });

  test('scope rows carry the kind word, the text, the reason and the date', () => {
    expect(data.scope).toEqual([{ kind: 'In', text: 'Open issues in milestone v1.0', reason: 'set at launch', date: '2026-11-10' }]);
  });

  test('every dataset is an array of flat objects', () => {
    for (const id of STATUS_DATASET_IDS) {
      expect(Array.isArray(data[id])).toBe(true);
      for (const row of data[id]) {
        for (const v of Object.values(row)) expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true);
      }
    }
  });
});

describe('buildStatusData — the whole board, the page folds it', () => {
  test('every ready issue is a card; the page shows four per column and folds the rest', () => {
    const issues: QueueJson['issues'] = {};
    for (let n = 1; n <= 12; n++) issues[String(n)] = { title: `t${n}`, status: 'ready', phase: 'handle' };
    const big = report({ issues });
    expect(buildStatusData(big).board.filter((c) => c.stage === 'todo')).toHaveLength(12);
  });
});

describe('writeStatusData', () => {
  test('writes one <id>.json per dataset, parseable and equal to the built rows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-data-'));
    try {
      const r = report();
      const files = writeStatusData(dir, r);
      expect(files.map((f) => path.basename(f)).sort()).toEqual(STATUS_DATASET_IDS.map((id) => `${id}.json`).sort());
      const built = buildStatusData(r);
      for (const id of STATUS_DATASET_IDS) {
        expect(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'))).toEqual(built[id]);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseStatusArgs --data', () => {
  test('--data selects the data mode and resolves the directory', () => {
    const args = parseStatusArgs(['--data', '/abs/out', '--no-gh']);
    expect(args).toMatchObject({ mode: 'data', dataDir: '/abs/out', skipGh: true });
  });

  test('--data is mutually exclusive with --json and --html', () => {
    expect(() => parseStatusArgs(['--data', 'd', '--json'])).toThrow(/only one of/);
    expect(() => parseStatusArgs(['--data', 'd', '--html'])).toThrow(/only one of/);
  });

  test('--data without a value, or followed by a flag, throws instead of printing the text dashboard', () => {
    expect(() => parseStatusArgs(['--data'])).toThrow(/--data requires a directory/);
    expect(() => parseStatusArgs(['--data', '--no-gh'])).toThrow(/--data requires a directory/);
  });

  test('--out still requires --html', () => {
    expect(() => parseStatusArgs(['--data', 'd', '--out', 'x'])).toThrow(/--out requires --html/);
  });
});

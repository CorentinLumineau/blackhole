import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectStatusReport } from '../../campaign-status.ts';
import { runRows } from './run-state.ts';

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
});

const route = { needs_design: true };
const manifestOf = (routes: string[], target = 'documentation/plans/x.md') => ({
  issue: 1,
  updated_at: '2026-11-17T00:00:00.000Z',
  entries: routes.map((r) => ({ route: r, sub_mode: null, produced_by: 'planner', declared_at: 'x', staged_path: 's', target_path: target, target_kind: 'new_file' })),
});

/** A temp repo with `.blackhole/` holding config, queue and per-issue manifests (string = raw file content). */
function campaign(docs: unknown, issues: Record<string, unknown>, manifests: Record<string, unknown | string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-carry-'));
  tmp.push(root);
  const dir = path.join(root, '.blackhole');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ repo: 'acme/w', ...(docs === undefined ? {} : { docs_governance: docs }) }));
  fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify({ refreshed_at: '2026-11-17T00:00:00.000Z', issues }));
  fs.writeFileSync(path.join(dir, 'findings-ledger.json'), JSON.stringify({ findings: [] }));
  for (const [n, m] of Object.entries(manifests)) {
    fs.mkdirSync(path.join(dir, 'staged', n), { recursive: true });
    fs.writeFileSync(path.join(dir, 'staged', n, 'manifest.json'), typeof m === 'string' ? m : JSON.stringify(m));
  }
  return dir;
}

const rowOf = async (dir: string): Promise<string | undefined> => {
  const { report } = await collectStatusReport(dir, true, '2026-11-17T12:00:00.000Z');
  return runRows(report.run).find((r) => r.key === 'Doc carry')?.value;
};

describe('Doc carry through collectStatusReport', () => {
  test('governance off or absent renders off', async () => {
    expect(await rowOf(campaign(undefined, { '1': { status: 'ready', phase: 'handle', route } }))).toBe('off (docs governance off)');
    expect(await rowOf(campaign({ enabled: true, write_governance: false }, { '1': { status: 'ready', phase: 'handle', route } }))).toBe('off (docs governance off)');
  });

  test('scopes issues: live headline, named implement gap, merged history tail, unrouted and unreadable counted', async () => {
    const dir = campaign(
      { enabled: true },
      {
        '1': { status: 'merged', phase: 'done', route }, // merged, no manifest: left out of history
        '2': { status: 'merged', phase: 'done', route, pr: 5 }, // merged with a manifest and a gap: history 1/2
        '3': { status: 'ready', phase: 'handle', route }, // handle: not counted
        '4': { status: 'in-flight', phase: 'implement', route }, // implement with a gap: named
        '5': { status: 'in-flight', phase: 'implement' }, // no route, no manifest: unrouted
        '6': { status: 'in-flight', phase: 'plan', route }, // malformed manifest: unreadable
        '7': { status: 'in-flight', phase: 'review', route }, // fully staged, carried
      },
      {
        '2': manifestOf(['plan'], 'documentation/plans/two.md'),
        '4': manifestOf(['plan'], 'documentation/plans/four.md'),
        '6': '{not json',
        '7': manifestOf(['plan', 'design'], 'documentation/plans/seven.md'),
      },
    );
    fs.mkdirSync(path.join(path.dirname(dir), 'documentation/plans'), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(dir), 'documentation/plans/seven.md'), 'x');
    // live promised past handle: #4 2, #7 2 = 4 (handle #3 and the unreadable #6 are not counted); staged: #4 1, #7 2 = 3; carried: #7 has two entries on one existing target = 2
    expect(await rowOf(dir)).toBe('routes promised 4 · staged 3 · docs carried 2 · unrouted #5 · unreadable 1 · gaps: #4 1/2 · history: 1/2 routes staged');
  });
});

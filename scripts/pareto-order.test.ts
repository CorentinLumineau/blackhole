import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.join(import.meta.dir, 'pareto-order.ts');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const p = (gain: number, effort: number) => ({ gain, effort, priority: gain * (11 - effort) });
function campaign(queue: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pareto-order-'));
  dirs.push(dir);
  if (queue !== null) fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify(queue));
  return dir;
}
const run = (...args: string[]) => {
  const r = Bun.spawnSync(['bun', SCRIPT, ...args], { stderr: 'pipe', stdout: 'pipe' });
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() };
};

describe('pareto-order CLI', () => {
  const queue = {
    issues: {
      '1': { status: 'ready', pareto: p(8, 5) },
      '2': { status: 'ready', pareto: p(10, 4) },
      '3': { status: 'ready', pareto: p(7, 1) },
      '5': { status: 'ready', pareto: p(7, 1) },
      '6': { status: 'ready', pareto: p(10, 1), depends_on: [1] },
    },
  };
  test('prints the ordered batch as JSON and leaves queue.json untouched', () => {
    const dir = campaign(queue);
    const before = fs.readFileSync(path.join(dir, 'queue.json'));
    expect(run('--campaign-dir', dir, '--limit', '2')).toMatchObject({ code: 0, out: '[3,5]' });
    expect(fs.readFileSync(path.join(dir, 'queue.json')).equals(before)).toBe(true);
  });
  test('honors user_queue_order', () => {
    expect(run('--campaign-dir', campaign({ ...queue, user_queue_order: [2] }), '--limit', '2').out).toBe('[2,3]');
  });
  test.each([[undefined], [[]]])('unpinned (user_queue_order %j) follows stored priority', (order) => {
    const q = { ...queue, ...(order ? { user_queue_order: order } : {}) };
    expect(run('--campaign-dir', campaign(q), '--limit', '3').out).toBe('[3,5,2]');
  });
  test('a missing queue exits 1 naming the path', () => {
    const dir = campaign(null);
    const r = run('--campaign-dir', dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain(path.join(dir, 'queue.json'));
  });
  test('an unknown flag or bad limit exits 2 with the usage line', () => {
    for (const args of [['--bogus'], ['--limit', 'x']]) {
      const r = run('--campaign-dir', campaign(queue), ...args);
      expect(r.code).toBe(2);
      expect(r.err).toContain('Usage:');
    }
  });
});

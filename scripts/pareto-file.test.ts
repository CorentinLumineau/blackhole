import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.join(import.meta.dir, 'pareto-file.ts');
const ROOT = path.join(import.meta.dir, '..');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const run = (...args: string[]) => {
  const r = Bun.spawnSync(['bun', SCRIPT, ...args], { stderr: 'pipe', stdout: 'pipe' });
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() };
};

describe('pareto-file CLI', () => {
  test('line prints the formatter line', () => {
    expect(run('line', '--gain', '7', '--effort', '5')).toMatchObject({ code: 0, out: 'Pareto: gain=7 effort=5 priority=42' });
  });
  test('label prints the bucket label', () => {
    expect(run('label', '--gain', '7', '--effort', '5').out).toBe('pareto:P3');
    expect(run('label', '--gain', '10', '--effort', '1').out).toBe('pareto:P1');
    expect(run('label', '--gain', '2', '--effort', '9').out).toBe('pareto:P4');
  });
  test('edit-args swaps a stale label', () => {
    expect(run('edit-args', '--gain', '8', '--effort', '4', '--labels', 'ready,pareto:P3').out).toBe('--add-label pareto:P2 --remove-label pareto:P3');
  });
  test('edit-args is empty when already correct', () => {
    expect(run('edit-args', '--gain', '8', '--effort', '4', '--labels', 'pareto:P2')).toMatchObject({ code: 0, out: '' });
  });
  test('body upserts the line into the file content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pareto-file-'));
    dirs.push(dir);
    const f = path.join(dir, 'body.md');
    fs.writeFileSync(f, 'hello');
    expect(run('body', '--gain', '7', '--effort', '5', '--body-file', f).out).toBe('hello\n\nPareto: gain=7 effort=5 priority=42');
  });
  test('a valueless --gain exits 2 instead of reading as 1', () => {
    const r = run('line', '--gain', '--effort', '5');
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
  });
  test.each([
    [['nope', '--gain', '7', '--effort', '5']],
    [['line', '--effort', '5']],
    [['line', '--gain', '0', '--effort', '5']],
    [['line', '--gain', '7', '--effort', '11']],
    [['line', '--gain', '1.5', '--effort', '5']],
    [['line', '--gain', '7', '--effort', '5', '--bogus', 'x']],
    [['body', '--gain', '7', '--effort', '5', '--body-file', '/nonexistent/body.md']],
  ])('exits 2 with usage for %j', (args) => {
    const r = run(...args);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Usage:');
  });
});

describe('prose coverage', () => {
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  test.each([
    'src/references/forge-sync.md', 'src/references/phase-loop.md', 'src/references/hunt/filing.md',
    'src/references/blackhole-protocol.md', 'src/references/orchestrator-dispatch.md', 'src/references/phase-implement.md',
    'src/agents/orchestrator.md', 'src/agents/coordinator.md',
  ])('%s cites scripts/pareto-file.ts', (rel) => {
    expect(read(rel)).toContain('scripts/pareto-file.ts');
  });
  test.each(['src/references/queue-dag.md', 'src/references/phase-loop.md'])('%s cites scripts/pareto-order.ts', (rel) => {
    expect(read(rel)).toContain('scripts/pareto-order.ts');
  });
});

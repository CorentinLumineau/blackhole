import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';

// CLI exit-code contract for scripts/route-artifacts.ts against tmp campaign dirs.
const root = path.resolve(import.meta.dirname);
const script = path.join(root, 'route-artifacts.ts');

let dir: string;
beforeEach(() => { dir = makeTempDir('route-artifacts'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (rel: string, data: unknown) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
};
const config = (docs: Record<string, unknown> | undefined) => write('config.json', docs ? { docs_governance: docs } : {});
const ON = { enabled: true, write_governance: true };
const route = (flags: Record<string, unknown> = {}) =>
  write('findings-ledger.json', { routing_decisions: [{ id: 'R-00001', issue_ref: 7, route: flags }] });
const manifest = (...routes: Array<[string, string]>) =>
  write('staged/7/manifest.json', {
    issue: 7, updated_at: 'x',
    entries: routes.map(([r, target]) => ({
      route: r, sub_mode: null, produced_by: 'planner', declared_at: 'x',
      staged_path: `.blackhole/staged/7/${r}.md`, target_path: target, target_kind: 'new_file',
    })),
  });

const run = async (args: string[]) => {
  const proc = Bun.spawn(['bun', 'run', script, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, stdout, stderr };
};
const dispatch = () => run(['--issue', '7', '--campaign-dir', dir, '--phase', 'dispatch']);

describe('route-artifacts CLI — usage', () => {
  test('missing --issue exits 2', async () => {
    expect((await run(['--campaign-dir', dir, '--phase', 'dispatch'])).code).toBe(2);
  });
  test('non-numeric --issue exits 2', async () => {
    expect((await run(['--issue', 'x', '--campaign-dir', dir, '--phase', 'dispatch'])).code).toBe(2);
  });
  test('missing --campaign-dir exits 2', async () => {
    expect((await run(['--issue', '7', '--phase', 'dispatch'])).code).toBe(2);
  });
  test('invalid --phase exits 2', async () => {
    expect((await run(['--issue', '7', '--campaign-dir', dir, '--phase', 'merge'])).code).toBe(2);
  });
  test('--phase pr without --diff-file exits 2', async () => {
    expect((await run(['--issue', '7', '--campaign-dir', dir, '--phase', 'pr'])).code).toBe(2);
  });
});

describe('route-artifacts CLI — campaign dir validity', () => {
  test('missing config.json exits 2, never skipped', async () => {
    const r = await dispatch();
    expect(r.code).toBe(2);
    expect(r.stdout).not.toContain('skipped');
  });
  test('nonexistent campaign dir exits 2', async () => {
    expect((await run(['--issue', '7', '--campaign-dir', path.join(dir, 'nope', '.blackhole'), '--phase', 'dispatch'])).code).toBe(2);
  });
  test('relative campaign dir exits 2', async () => {
    expect((await run(['--issue', '7', '--campaign-dir', '.blackhole', '--phase', 'dispatch'])).code).toBe(2);
  });
});

describe('route-artifacts CLI — governance gate', () => {
  test('enabled not true skips with exit 0', async () => {
    config({ enabled: false });
    const r = await dispatch();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('skipped');
  });
  test('absent docs_governance block skips with exit 0', async () => {
    config(undefined);
    expect((await dispatch()).stdout).toContain('skipped');
  });
  test('write_governance false skips with exit 0', async () => {
    config({ enabled: true, write_governance: false });
    expect((await dispatch()).code).toBe(0);
  });
  // Same truth table as the shared resolver (carry-staged-artifacts.test.ts) so the call sites cannot drift.
  test.each([
    ['empty block', {}, true],
    ['enabled unset, write_governance true', { write_governance: true }, true],
    ['enabled true, write_governance unset', { enabled: true }, false],
  ] as Array<[string, Record<string, unknown>, boolean]>)('%s: skipped=%p', async (_n, block, skipped) => {
    config(block);
    const r = await dispatch();
    expect(r.stdout.includes('skipped')).toBe(skipped);
    // Active gate with no recorded route is a V-AUTO-03 failure, never a silent pass.
    expect(r.code).toBe(skipped ? 0 : 1);
  });
});

describe('route-artifacts CLI — dispatch (governance on)', () => {
  test('absent manifest is a gap, never a skip', async () => {
    config(ON); route();
    const r = await dispatch();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('plan');
  });
  test('absent route is a gap, never a skip', async () => {
    config(ON);
    const r = await dispatch();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no route');
  });
  test('promised design route without a staged design entry exits 1', async () => {
    config(ON); route({ needs_design: true }); manifest(['plan', 'documentation/plans/p.md']);
    const r = await dispatch();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('design');
  });
  test('every promised route staged exits 0', async () => {
    config(ON); route({ needs_design: true });
    manifest(['plan', 'documentation/plans/p.md'], ['design', 'documentation/decisions/ADR-1.md']);
    expect((await dispatch()).code).toBe(0);
  });
});

describe('route-artifacts CLI — pr phase', () => {
  const pr = (diff: string) => {
    write('diff.txt', diff);
    return run(['--issue', '7', '--campaign-dir', dir, '--phase', 'pr', '--diff-file', path.join(dir, 'diff.txt')]);
  };
  test('every staged target in the diff exits 0', async () => {
    config(ON); route(); manifest(['plan', 'documentation/plans/p.md']);
    expect((await pr('src/a.ts\ndocumentation/plans/p.md\n')).code).toBe(0);
  });
  test('a staged target missing from the diff exits 1', async () => {
    config(ON); route(); manifest(['plan', 'documentation/plans/p.md']);
    const r = await pr('src/a.ts\n');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('documentation/plans/p.md');
  });
  test('absent manifest exits 1', async () => {
    config(ON); route();
    expect((await pr('src/a.ts\n')).code).toBe(1);
  });
});

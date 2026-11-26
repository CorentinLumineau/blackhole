import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';

const root = path.resolve(import.meta.dirname);
const scriptPath = path.join(root, 'stage-manifest.ts');
const run = (args: string[]) => Bun.spawn(['bun', 'run', scriptPath, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
const out = async (proc: ReturnType<typeof run>) =>
  Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

const entryJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    route: 'plan',
    sub_mode: null,
    produced_by: 'planner',
    declared_at: '2026-11-26T10:00:00.000Z',
    staged_path: '.blackhole/staged/7/p.md',
    target_path: 'documentation/plans/p.md',
    target_kind: 'new_file',
    ...over,
  });

let dir: string;
let manifest: string;
beforeEach(() => {
  dir = makeTempDir('stage-manifest-cli');
  manifest = path.join(dir, 'manifest.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('stage-manifest CLI append', () => {
  test('valid entry: exits 0 and writes the manifest', async () => {
    const [code] = await out(run(['append', '--manifest', manifest, '--issue', '7', '--entry-json', entryJson()]));
    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(manifest, 'utf-8')).entries).toHaveLength(1);
  });

  test('missing flag exits 2 with usage', async () => {
    const [code, , stderr] = await out(run(['append', '--manifest', manifest]));
    expect(code).toBe(2);
    expect(stderr).toContain('Usage');
  });

  test('invalid entry exits 1 naming the manifest path', async () => {
    const [code, , stderr] = await out(run(['append', '--manifest', manifest, '--issue', '7', '--entry-json', entryJson({ target_kind: 'x' })]));
    expect(code).toBe(1);
    expect(stderr).toContain(manifest);
  });

  test('unparseable --entry-json exits 1 naming the manifest path', async () => {
    const [code, , stderr] = await out(run(['append', '--manifest', manifest, '--issue', '7', '--entry-json', '{nope']));
    expect(code).toBe(1);
    expect(stderr).toContain(manifest);
  });

  test('existing zero-byte manifest exits 1 naming the path and stays zero-byte', async () => {
    fs.writeFileSync(manifest, '');
    const [code, , stderr] = await out(run(['append', '--manifest', manifest, '--issue', '7', '--entry-json', entryJson()]));
    expect(code).toBe(1);
    expect(stderr).toContain(manifest);
    expect(fs.statSync(manifest).size).toBe(0);
  });
});

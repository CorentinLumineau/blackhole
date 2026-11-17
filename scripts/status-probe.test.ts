import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordProbe, UNCHANGED_PROBE_HOURS } from './status-probe.ts';

const root = path.resolve(import.meta.dir, '..');
const URL = 'https://claude.ai/code/artifact/abc';
const ARTIFACT = { url: URL, kind: 'data', created_at: '2026-11-01T00:00:00.000Z', template_version: 4, template_sha256: 'ff' };
const NOW = '2026-11-17T10:00:00.000Z';
const dirs: string[] = [];

const campaign = (content: string | null): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-probe-'));
  dirs.push(dir);
  if (content !== null) fs.writeFileSync(path.join(dir, 'status-artifact.json'), content);
  return dir;
};
const run = (dir: string, ...args: string[]) =>
  Bun.spawnSync({ cmd: ['bun', 'run', 'scripts/status-probe.ts', 'record', '--campaign-dir', dir, '--now', NOW, ...args], cwd: root, stdout: 'pipe', stderr: 'pipe' });
const read = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'status-artifact.json'), 'utf-8'));

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('recordProbe', () => {
  test('adds last_probe and keeps every other key', () => {
    const { changed, next } = recordProbe(ARTIFACT, { ok: true, url: URL }, NOW);
    expect(changed).toBe(true);
    expect(next).toEqual({ ...ARTIFACT, last_probe: { at: NOW, ok: true, url: URL } });
  });

  test('a failure carries its reason', () => {
    expect(recordProbe(ARTIFACT, { ok: false, url: URL, reason: 'not found' }, NOW).next.last_probe).toEqual({ at: NOW, ok: false, url: URL, reason: 'not found' });
  });

  test(`an unchanged probe under ${UNCHANGED_PROBE_HOURS}h old is not rewritten; an older one or a different result is`, () => {
    expect(UNCHANGED_PROBE_HOURS).toBe(24);
    const prior = { ...ARTIFACT, last_probe: { at: '2026-11-16T11:00:00.000Z', ok: true, url: URL } };
    expect(recordProbe(prior, { ok: true, url: URL }, NOW)).toEqual({ changed: false, next: prior });
    expect(recordProbe(prior, { ok: false, url: URL, reason: 'gone' }, NOW).changed).toBe(true);
    expect(recordProbe(prior, { ok: true, url: 'https://claude.ai/code/artifact/other' }, NOW).changed).toBe(true);
    const old = { ...ARTIFACT, last_probe: { at: '2026-11-16T09:59:00.000Z', ok: true, url: URL } };
    expect(recordProbe(old, { ok: true, url: URL }, NOW).next.last_probe?.at).toBe(NOW);
  });
});

describe('status-probe.ts record CLI', () => {
  test('--ok writes last_probe atomically, other keys kept, no .tmp left behind', () => {
    const dir = campaign(JSON.stringify(ARTIFACT));
    const proc = run(dir, '--ok');
    expect(proc.exitCode).toBe(0);
    expect(read(dir)).toEqual({ ...ARTIFACT, last_probe: { at: NOW, ok: true, url: URL } });
    expect(fs.readdirSync(dir)).toEqual(['status-artifact.json']);
  });

  test('--fail --reason records the failure against --url', () => {
    const dir = campaign(JSON.stringify(ARTIFACT));
    const other = 'https://claude.ai/code/artifact/other';
    expect(run(dir, '--fail', '--url', other, '--reason', 'permission denied').exitCode).toBe(0);
    expect(read(dir).last_probe).toEqual({ at: NOW, ok: false, url: other, reason: 'permission denied' });
  });

  test('an unchanged recent probe leaves the file byte-identical', () => {
    const body = `${JSON.stringify({ ...ARTIFACT, last_probe: { at: '2026-11-17T09:00:00.000Z', ok: true, url: URL } })}\n`;
    const dir = campaign(body);
    const proc = run(dir, '--ok');
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain('unchanged');
    expect(fs.readFileSync(path.join(dir, 'status-artifact.json'), 'utf-8')).toBe(body);
  });

  for (const [name, content] of [
    ['missing', null],
    ['malformed', '{ not json'],
    ['not an object', '[1, 2]'],
    ['without a url', '{"kind": "data"}'],
  ] as const) {
    test(`a ${name} status-artifact.json exits 2 and is left untouched`, () => {
      const dir = campaign(content);
      const proc = run(dir, '--ok');
      expect(proc.exitCode).toBe(2);
      if (content === null) expect(fs.existsSync(path.join(dir, 'status-artifact.json'))).toBe(false);
      else expect(fs.readFileSync(path.join(dir, 'status-artifact.json'), 'utf-8')).toBe(content);
      expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });
  }

  test('both --ok and --fail, or neither, is a usage error', () => {
    const dir = campaign(JSON.stringify(ARTIFACT));
    expect(run(dir, '--ok', '--fail').exitCode).toBe(2);
    expect(run(dir).exitCode).toBe(2);
    expect(read(dir)).toEqual(ARTIFACT);
  });
});

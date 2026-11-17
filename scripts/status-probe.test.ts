import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PROBE_FRESH_MINUTES, statusPageRow } from './lib/campaign-status/status-page-row.ts';
import { recordProbe } from './status-probe.ts';

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

  test('an identical probe is kept only while it still counts as fresh on the Status page row', () => {
    expect(PROBE_FRESH_MINUTES).toBe(10);
    const prior = { ...ARTIFACT, last_probe: { at: '2026-11-17T09:55:00.000Z', ok: true, url: URL } };
    expect(recordProbe(prior, { ok: true, url: URL }, NOW)).toEqual({ changed: false, next: prior });
    expect(recordProbe(prior, { ok: false, url: URL, reason: 'gone' }, NOW).changed).toBe(true);
    expect(recordProbe(prior, { ok: true, url: 'https://claude.ai/code/artifact/other' }, NOW).changed).toBe(true);
    // Ten minutes old: no longer fresh, so it is rewritten (an hour-old probe used to be kept for 24 h).
    for (const at of ['2026-11-17T09:50:00.000Z', '2026-11-17T09:00:00.000Z']) {
      const old = { ...ARTIFACT, last_probe: { at, ok: true, url: URL } };
      expect(recordProbe(old, { ok: true, url: URL }, NOW).next.last_probe?.at).toBe(NOW);
    }
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

  test('an unchanged fresh probe leaves the file byte-identical', () => {
    const body = `${JSON.stringify({ ...ARTIFACT, last_probe: { at: '2026-11-17T09:58:00.000Z', ok: true, url: URL } })}\n`;
    const dir = campaign(body);
    const proc = run(dir, '--ok');
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain('unchanged');
    expect(fs.readFileSync(path.join(dir, 'status-artifact.json'), 'utf-8')).toBe(body);
  });

  test('round trip: an old probe, then record --ok, and the Status page row reads reachable', () => {
    const dir = campaign(JSON.stringify({ ...ARTIFACT, last_probe: { at: '2026-11-17T09:00:00.000Z', ok: true, url: URL } }));
    const page = (artifact: unknown) => statusPageRow({ enabled: true, publishExpected: true, artifact: artifact as never, templateVersion: 4, nowIso: NOW });
    expect(page(read(dir)).probe_needed).toEqual({ url: URL });
    expect(run(dir, '--ok').exitCode).toBe(0);
    const row = page(read(dir));
    expect(row.value).toBe(`${URL} · reachable (probed 0 min ago) · template v4`);
    expect(row.probe_needed).toBeUndefined();
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

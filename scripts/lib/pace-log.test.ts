import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { appendPaceLog, buildPaceRecord, formatPaceLine, readLatestPaceRecord } from './pace-log.ts';
import { makeTempDir } from './fs.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const logPath = () => {
  const dir = makeTempDir('pace-log-');
  tempDirs.push(dir);
  return path.join(dir, 'pace-log.jsonl');
};
const NOW = 1_800_000_000;
const pace = { verdict: 'THROTTLE' as const, concurrency: 1, reasons: ['five_hour 85% >= 80%'] };
const resource = { verdict: 'degrade' as const, batch_size: 1, reasons: ['load high'] };

describe('buildPaceRecord', () => {
  test('effective concurrency is the smaller of the two gates', () => {
    const r = buildPaceRecord(NOW, 3, pace, { ...resource, batch_size: 0, verdict: 'defer' });
    expect(r.effective).toBe(0);
    expect(r.planned).toBe(3);
    expect(r.at).toBe(new Date(NOW * 1000).toISOString());
  });

  test('a missing resource verdict leaves the pace concurrency and says so', () => {
    const r = buildPaceRecord(NOW, 3, pace, null);
    expect(r.resource).toBeNull();
    expect(r.effective).toBe(1);
  });

  test('reasons merge both gates in order', () => {
    expect(buildPaceRecord(NOW, 3, pace, resource).reasons).toEqual(['five_hour 85% >= 80%', 'load high']);
  });

  test('STOP-NEW is flagged as a rate-limit stop with zero effective workers', () => {
    const r = buildPaceRecord(NOW, 3, { verdict: 'STOP-NEW', concurrency: 0, reasons: ['seven_day 96% >= 95%'] }, resource);
    expect(r).toMatchObject({ effective: 0, rate_limit_stop: true });
    expect(buildPaceRecord(NOW, 3, pace, resource).rate_limit_stop).toBe(false);
  });
});

describe('appendPaceLog', () => {
  test('appends one JSON line per call', () => {
    const p = logPath();
    appendPaceLog(p, buildPaceRecord(NOW, 3, pace, resource));
    appendPaceLog(p, buildPaceRecord(NOW + 60, 2, pace, null));
    expect(fs.readFileSync(p, 'utf-8').trim().split('\n')).toHaveLength(2);
  });

  test('rotation keeps only the newest maxLines', () => {
    const p = logPath();
    for (let i = 0; i < 5; i++) appendPaceLog(p, buildPaceRecord(NOW + i, i, pace, null), 3);
    const lines = fs.readFileSync(p, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.planned)).toEqual([2, 3, 4]);
  });

  test('a corrupt line is dropped, not fatal', () => {
    const p = logPath();
    fs.writeFileSync(p, 'not json\n');
    appendPaceLog(p, buildPaceRecord(NOW, 1, pace, null));
    expect(fs.readFileSync(p, 'utf-8').trim().split('\n')).toHaveLength(1);
  });
});

describe('readLatestPaceRecord / formatPaceLine', () => {
  test('lines that are valid JSON but not records are skipped', () => {
    const p = logPath();
    appendPaceLog(p, buildPaceRecord(NOW, 3, pace, null));
    fs.appendFileSync(p, '5\n{}\nnull\n');
    expect(readLatestPaceRecord(p)?.planned).toBe(3);
  });

  test('missing log gives null', () => {
    expect(readLatestPaceRecord('/nonexistent/pace-log.jsonl')).toBeNull();
  });

  test('returns the last record and formats a one-line summary', () => {
    const p = logPath();
    appendPaceLog(p, buildPaceRecord(NOW, 3, pace, resource));
    const latest = readLatestPaceRecord(p);
    expect(latest?.planned).toBe(3);
    const line = formatPaceLine(latest!);
    expect(line).toContain('THROTTLE');
    expect(line).toContain('planned 3');
    expect(line).toContain('effective 1');
  });
});

describe('pace-log CLI', () => {
  const script = path.join(import.meta.dir, '..', 'pace-log.ts');
  const run = (args: string[]) => Bun.spawnSync(['bun', 'run', script, ...args], { stdout: 'pipe', stderr: 'pipe' });

  test('records a round from verdict JSON and prints the record', () => {
    const p = logPath();
    const res = run(['--log', p, '--planned', '3', '--now', String(NOW), '--pace', JSON.stringify(pace), '--resource', JSON.stringify(resource)]);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout.toString()).effective).toBe(1);
    expect(readLatestPaceRecord(p)?.rate_limit_stop).toBe(false);
  });

  test('bad usage exits 2', () => {
    expect(run(['--log', logPath(), '--planned', 'x']).exitCode).toBe(2);
    expect(run(['--log', logPath(), '--planned', '1', '--pace', '{bad']).exitCode).toBe(2);
  });

  test('a verdict of the wrong shape exits 2 and writes nothing', () => {
    const p = logPath();
    const planned = ['--log', p, '--planned', '1'];
    expect(run([...planned, '--pace', 'null']).exitCode).toBe(2);
    expect(run([...planned, '--pace', '{}']).exitCode).toBe(2);
    expect(run([...planned, '--pace', JSON.stringify(pace), '--resource', JSON.stringify({ verdict: 'go', reasons: [] })]).exitCode).toBe(2);
    expect(fs.existsSync(p)).toBe(false);
  });
});

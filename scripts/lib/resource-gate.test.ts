import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_RESOURCE_GATE,
  countDState,
  evaluateResourceGate,
  parseLoad1,
  parseMemAvailableMb,
  readHostSample,
  resolveResourceGateThresholds,
  type HostSample,
} from './resource-gate.ts';
import { makeTempDir } from './fs.ts';

const SCRIPT_PATH = path.join(import.meta.dir, '..', 'resource-gate.ts');
const healthy: HostSample = { memAvailableMb: 8000, load1: 2, nproc: 12, dState: 0 };
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const fakeProc = (meminfo: string, loadavg: string, states: string[]): string => {
  const dir = makeTempDir('resource-gate');
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'meminfo'), meminfo);
  fs.writeFileSync(path.join(dir, 'loadavg'), loadavg);
  states.forEach((state, i) => {
    fs.mkdirSync(path.join(dir, String(100 + i)));
    fs.writeFileSync(path.join(dir, String(100 + i), 'stat'), `${100 + i} (a (b) c) ${state} 1 2 3`);
  });
  return dir;
};

describe('host metric parsers', () => {
  test('parseMemAvailableMb reads the MemAvailable line in kB and returns MB', () => {
    expect(parseMemAvailableMb('MemTotal: 32000000 kB\nMemAvailable:    2048000 kB\n')).toBe(2000);
  });

  test('parseMemAvailableMb returns null when the line is absent', () => {
    expect(parseMemAvailableMb('MemTotal: 32000000 kB\n')).toBeNull();
  });

  test('parseLoad1 reads the first loadavg field', () => {
    expect(parseLoad1('3.77 2.69 2.66 10/4911 863464\n')).toBe(3.77);
    expect(parseLoad1('')).toBeNull();
  });

  test('countDState reads the state after the last ")" so a comm containing parens cannot shift it', () => {
    expect(countDState(['1 (x) D 0', '2 (a (b) c) D 0', '3 (y) S 0', '4 (z) R 0'])).toBe(2);
  });
});

describe('evaluateResourceGate', () => {
  test('go: healthy host keeps the requested batch', () => {
    expect(evaluateResourceGate(healthy, 4, DEFAULT_RESOURCE_GATE)).toEqual({ verdict: 'go', batch_size: 4, reasons: [] });
  });

  test('degrade: memory between the defer and full thresholds cuts the batch to one', () => {
    const v = evaluateResourceGate({ ...healthy, memAvailableMb: 3000 }, 4, DEFAULT_RESOURCE_GATE);
    expect(v.verdict).toBe('degrade');
    expect(v.batch_size).toBe(1);
    expect(v.reasons[0]).toContain('MemAvailable 3000MB');
  });

  test('degrade: load ratio between 1.0 and 2.0 cuts the batch to one', () => {
    expect(evaluateResourceGate({ ...healthy, load1: 18 }, 4, DEFAULT_RESOURCE_GATE).verdict).toBe('degrade');
  });

  test('defer: low memory spawns nothing', () => {
    expect(evaluateResourceGate({ ...healthy, memAvailableMb: 1900 }, 4, DEFAULT_RESOURCE_GATE)).toMatchObject({
      verdict: 'defer',
      batch_size: 0,
    });
  });

  test('defer: load ratio above 2.0 spawns nothing', () => {
    expect(evaluateResourceGate({ ...healthy, load1: 30 }, 4, DEFAULT_RESOURCE_GATE).verdict).toBe('defer');
  });

  test('defer: D-state count above the threshold wins even when load looks low', () => {
    const v = evaluateResourceGate({ ...healthy, load1: 1, dState: 11 }, 4, DEFAULT_RESOURCE_GATE);
    expect(v.verdict).toBe('defer');
    expect(v.reasons.join(' ')).toContain('D-state 11');
  });

  test('thresholds are exact: the defer and full boundaries sit on the documented side', () => {
    const at = (patch: Partial<HostSample>) => evaluateResourceGate({ ...healthy, ...patch }, 4, DEFAULT_RESOURCE_GATE).verdict;
    expect(at({ memAvailableMb: 2499 })).toBe('defer');
    expect(at({ memAvailableMb: 2500 })).toBe('degrade');
    expect(at({ memAvailableMb: 3499 })).toBe('degrade');
    expect(at({ memAvailableMb: 3500 })).toBe('go');
    expect(at({ load1: 12 })).toBe('go');
    expect(at({ load1: 12.12 })).toBe('degrade');
    expect(at({ load1: 24 })).toBe('degrade');
    expect(at({ load1: 24.12 })).toBe('defer');
    expect(at({ dState: 10 })).toBe('go');
    expect(at({ dState: 11 })).toBe('defer');
  });

  test('a zero-sized request stays zero on go and degrade', () => {
    expect(evaluateResourceGate(healthy, 0, DEFAULT_RESOURCE_GATE).batch_size).toBe(0);
    expect(evaluateResourceGate({ ...healthy, memAvailableMb: 3000 }, 0, DEFAULT_RESOURCE_GATE).batch_size).toBe(0);
  });

  test('defer outranks degrade when both fire', () => {
    expect(evaluateResourceGate({ ...healthy, memAvailableMb: 3000, load1: 30 }, 4, DEFAULT_RESOURCE_GATE).verdict).toBe('defer');
  });

  test('unavailable: no sample fails open with the requested batch and an explicit reason', () => {
    const v = evaluateResourceGate(null, 4, DEFAULT_RESOURCE_GATE);
    expect(v.verdict).toBe('unavailable');
    expect(v.batch_size).toBe(4);
    expect(v.reasons[0]).toContain('unavailable');
  });
});

describe('resolveResourceGateThresholds', () => {
  test('absent resource_policy.gate resolves to the defaults', () => {
    expect(resolveResourceGateThresholds({})).toEqual(DEFAULT_RESOURCE_GATE);
  });

  test('configured keys override only what they name', () => {
    const t = resolveResourceGateThresholds({ resource_policy: { gate: { defer_below_mem_mb: 1000 } } });
    expect(t.deferBelowMemMb).toBe(1000);
    expect(t.fullAboveMemMb).toBe(DEFAULT_RESOURCE_GATE.fullAboveMemMb);
  });

  test('a non-numeric override is rejected rather than silently ignored', () => {
    expect(() => resolveResourceGateThresholds({ resource_policy: { gate: { defer_above_dstate: 'ten' } } })).toThrow(
      'resource_policy.gate.defer_above_dstate',
    );
  });
});

describe('readHostSample', () => {
  test('reads meminfo, loadavg and per-process stat files under the given proc root', () => {
    const dir = fakeProc('MemAvailable: 3072000 kB\n', '5.00 1 1 1/1 1\n', ['D', 'S', 'D']);
    expect(readHostSample(dir, 12)).toEqual({ memAvailableMb: 3000, load1: 5, nproc: 12, dState: 2 });
  });

  test('skips a pid directory whose stat has gone', () => {
    const dir = fakeProc('MemAvailable: 3072000 kB\n', '5.00 1 1 1/1 1\n', ['D']);
    fs.mkdirSync(path.join(dir, '999'));
    expect(readHostSample(dir, 12)?.dState).toBe(1);
  });

  test('returns null for a core count that is not a positive integer', () => {
    const dir = fakeProc('MemAvailable: 3072000 kB\n', '5.00 1 1 1/1 1\n', []);
    expect(readHostSample(dir, 0)).toBeNull();
    expect(readHostSample(dir, Number.NaN)).toBeNull();
  });

  test('returns null when the proc root has no meminfo', () => {
    const dir = makeTempDir('resource-gate');
    tempDirs.push(dir);
    expect(readHostSample(dir, 12)).toBeNull();
  });
});

describe('resource-gate CLI', () => {
  const run = (args: string[]) => {
    const r = Bun.spawnSync(['bun', 'run', SCRIPT_PATH, ...args], { stdout: 'pipe', stderr: 'pipe' });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };

  test('prints the verdict JSON for a fake proc root', () => {
    const dir = fakeProc('MemAvailable: 2048000 kB\n', '1.0 1 1 1/1 1\n', []);
    const r = run(['--requested', '4', '--proc-root', dir, '--nproc', '12']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ verdict: 'defer', batch_size: 0 });
  });

  test('an unavailable host prints the reason on stderr, never a silent pass', () => {
    const dir = makeTempDir('resource-gate');
    tempDirs.push(dir);
    const r = run(['--requested', '3', '--proc-root', dir]);
    expect(JSON.parse(r.out)).toMatchObject({ verdict: 'unavailable', batch_size: 3 });
    expect(r.err).toContain('unavailable');
  });

  test('a non-numeric --nproc exits 2 instead of passing silently', () => {
    const dir = fakeProc('MemAvailable: 9000000 kB\n', '1.0 1 1 1/1 1\n', []);
    expect(run(['--requested', '2', '--proc-root', dir, '--nproc', 'abc']).code).toBe(2);
  });

  test('a malformed resource_policy.gate value exits 2 with a one-line message', () => {
    const dir = fakeProc('MemAvailable: 9000000 kB\n', '1.0 1 1 1/1 1\n', []);
    const config = path.join(dir, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ resource_policy: { gate: { defer_above_dstate: 'ten' } } }));
    const r = run(['--requested', '2', '--proc-root', dir, '--config', config]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('resource_policy.gate.defer_above_dstate');
  });

  test('missing --requested exits 2', () => {
    expect(run([]).code).toBe(2);
  });
});

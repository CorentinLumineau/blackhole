import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, test } from 'bun:test';
import { withTempDir } from './test-fixtures.ts';
import { countQueuedJobs, countRunners, MAX_RUNS_INSPECTED, readCiCapacity, resolveCiCapacityConfig, type CiCapacityConfig } from './ci-capacity-reader.ts';

const runner = (status: string, busy: boolean, ...labels: string[]) => ({ id: 1, status, busy, labels: labels.map((name) => ({ id: 1, name, type: 'custom' })) });
const job = (status: string, ...labels: string[]) => ({ status, labels });
const config: CiCapacityConfig = { enabled: true, lanes: ['ci'], queue_allowance: 1 };

describe('resolveCiCapacityConfig', () => {
  test('an absent block is off with no lanes and the default allowance', () => {
    expect(resolveCiCapacityConfig({})).toEqual({ enabled: false, lanes: [], queue_allowance: 1 });
  });
  test('reads the keys and dedupes lanes', () => {
    expect(resolveCiCapacityConfig({ ci_capacity: { enabled: true, lanes: ['ci', 'ci', 'light'], queue_allowance: 2 } })).toEqual({ enabled: true, lanes: ['ci', 'light'], queue_allowance: 2 });
  });
  test('a wrong type throws with the key path', () => {
    expect(() => resolveCiCapacityConfig({ ci_capacity: { enabled: 'yes' } })).toThrow('ci_capacity.enabled');
    expect(() => resolveCiCapacityConfig({ ci_capacity: { lanes: 'ci' } })).toThrow('ci_capacity.lanes');
    expect(() => resolveCiCapacityConfig({ ci_capacity: { queue_allowance: -1 } })).toThrow('ci_capacity.queue_allowance');
    expect(() => resolveCiCapacityConfig({ ci_capacity: [] })).toThrow('ci_capacity');
  });
});

describe('countRunners', () => {
  test('counts only online runners carrying a configured label, split by busy', () => {
    const payload = { runners: [runner('online', false, 'self-hosted', 'ci'), runner('online', true, 'ci'), runner('offline', false, 'ci'), runner('online', false, 'other')] };
    expect(countRunners(payload, ['ci'])).toEqual({ idle: 1, busy: 1 });
  });
  test('a payload without a runners list throws', () => {
    expect(() => countRunners({}, ['ci'])).toThrow('runners');
  });
});

describe('countQueuedJobs', () => {
  test('counts queued jobs in a lane, string labels', () => {
    expect(countQueuedJobs({ jobs: [job('queued', 'ci'), job('in_progress', 'ci'), job('queued', 'ubuntu-latest'), job('queued', 'self-hosted', 'ci')] }, ['ci'])).toBe(2);
  });
});

describe('readCiCapacity', () => {
  const api = (answers: Record<string, unknown>) => (endpoint: string): unknown => {
    const key = Object.keys(answers).find((k) => endpoint.includes(k));
    if (!key) throw new Error(`unexpected call ${endpoint}`);
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    return answer;
  };

  test('builds the reading from runners, queued runs and their jobs', () => {
    const get = api({
      '/actions/runners': { runners: [runner('online', false, 'ci'), runner('online', true, 'ci')] },
      'status=queued': { workflow_runs: [{ id: 7 }, { id: 8 }] },
      '/runs/7/jobs': { jobs: [job('queued', 'ci'), job('queued', 'ubuntu-latest')] },
      '/runs/8/jobs': { jobs: [job('queued', 'ci')] },
    });
    expect(readCiCapacity('o/r', { ...config, queue_allowance: 2 }, get)).toEqual({
      capacity: { idle_runners: 1, busy_runners: 1, queued_jobs: 2, queue_allowance: 2 },
      warning: null,
    });
  });

  test('runs past the inspection cap each count as one queued job', () => {
    const runs = Array.from({ length: MAX_RUNS_INSPECTED + 3 }, (_, i) => ({ id: i }));
    const calls: string[] = [];
    const get = (endpoint: string): unknown => {
      calls.push(endpoint);
      if (endpoint.includes('/actions/runners')) return { runners: [] };
      if (endpoint.includes('status=queued')) return { workflow_runs: runs };
      return { jobs: [job('queued', 'ci')] };
    };
    expect(readCiCapacity('o/r', config, get).capacity?.queued_jobs).toBe(MAX_RUNS_INSPECTED + 3);
    expect(calls.length).toBe(2 + MAX_RUNS_INSPECTED);
  });

  test('fails open with a warning on a forge error', () => {
    const r = readCiCapacity('o/r', config, api({ '/actions/runners': new Error('HTTP 403: Must have admin rights') }));
    expect(r.capacity).toBeNull();
    expect(r.warning).toContain('HTTP 403');
  });

  test('fails open on an unexpected payload shape', () => {
    expect(readCiCapacity('o/r', config, () => ({})).capacity).toBeNull();
  });

  test('no configured lane is no reading and makes no forge call', () => {
    const r = readCiCapacity('o/r', { ...config, lanes: [] }, () => {
      throw new Error('must not call');
    });
    expect(r.capacity).toBeNull();
    expect(r.warning).toContain('lanes');
  });
});

describe('ci-capacity-read CLI', () => {
  const cli = path.resolve(import.meta.dir, '..', 'ci-capacity-read.ts');
  const run = (config: unknown) =>
    withTempDir('ci-capacity-read', (dir) => {
      const configPath = path.join(dir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      const r = spawnSync('bun', ['run', cli, '--config', configPath], { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '' } });
      return { code: r.status, out: r.stdout.trim(), err: r.stderr };
    });

  test('disabled or absent config prints nothing and exits 0 without a forge call', () => {
    expect(run({})).toEqual({ code: 0, out: '', err: '' });
    expect(run({ repo: 'o/r', ci_capacity: { enabled: false, lanes: ['ci'] } })).toEqual({ code: 0, out: '', err: '' });
  });

  test('a malformed ci_capacity block is a usage error naming the key', () => {
    const r = run({ ci_capacity: { enabled: 'yes' } });
    expect(r.code).toBe(2);
    expect(r.err).toContain('ci_capacity.enabled');
  });

  test('an enabled block with no repo, or a non-GitHub forge, warns and prints no reading', () => {
    expect(run({ ci_capacity: { enabled: true, lanes: ['ci'] } })).toMatchObject({ code: 0, out: '', err: expect.stringContaining('no "repo"') });
    expect(run({ repo: 'o/r', forge: 'gitea', ci_capacity: { enabled: true, lanes: ['ci'] } })).toMatchObject({ code: 0, out: '', err: expect.stringContaining('forge gitea') });
  });
});

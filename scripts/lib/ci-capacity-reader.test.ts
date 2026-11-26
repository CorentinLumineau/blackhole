import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, test } from 'bun:test';
import { withTempDir } from './test-fixtures.ts';
import { parseCiCapacity } from './ci-capacity.ts';
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
      'status=in_progress': { workflow_runs: [] },
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
      if (endpoint.includes('status=in_progress')) return { workflow_runs: [] };
      return { jobs: [job('queued', 'ci')] };
    };
    expect(readCiCapacity('o/r', config, get).capacity?.queued_jobs).toBe(MAX_RUNS_INSPECTED + 3);
    expect(calls.length).toBe(3 + MAX_RUNS_INSPECTED);
  });

  test('queued jobs of a run already in progress count, and a run listed under both statuses is read once', () => {
    const calls: string[] = [];
    const get = (endpoint: string): unknown => {
      calls.push(endpoint);
      if (endpoint.includes('/actions/runners')) return { runners: [] };
      if (endpoint.includes('status=queued')) return { workflow_runs: [{ id: 1 }, { id: 2 }] };
      if (endpoint.includes('status=in_progress')) return { workflow_runs: [{ id: 2 }, { id: 3 }] };
      return { jobs: [job('in_progress', 'ci'), job('queued', 'ci')] };
    };
    expect(readCiCapacity('o/r', config, get).capacity?.queued_jobs).toBe(3);
    expect(calls.filter((c) => c.endsWith('/jobs?per_page=100'))).toHaveLength(3);
  });

  test('one combined inspection cap: queued runs are read first, a run past it counts only when it is queued', () => {
    const queuedRuns = Array.from({ length: MAX_RUNS_INSPECTED }, (_, i) => ({ id: i }));
    const runningRuns = Array.from({ length: 4 }, (_, i) => ({ id: 100 + i }));
    const jobCalls: string[] = [];
    const get = (endpoint: string): unknown => {
      if (endpoint.includes('/actions/runners')) return { runners: [] };
      if (endpoint.includes('status=queued')) return { workflow_runs: [...queuedRuns, { id: 50 }] };
      if (endpoint.includes('status=in_progress')) return { workflow_runs: runningRuns };
      jobCalls.push(endpoint);
      return { jobs: [job('queued', 'ci')] };
    };
    // 10 inspected queued runs, 1 queued run past the cap counts as one, the 4 in-progress runs past the cap count none.
    expect(readCiCapacity('o/r', config, get).capacity?.queued_jobs).toBe(MAX_RUNS_INSPECTED + 1);
    expect(jobCalls).toHaveLength(MAX_RUNS_INSPECTED);
    expect(jobCalls.some((c) => c.includes('/runs/100/'))).toBe(false);
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

  test('a GitHub reading round-trips through parseCiCapacity, reading both run statuses through a stub gh', () => {
    withTempDir('ci-capacity-gh', (dir) => {
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      const answers = {
        runners: { runners: [runner('online', false, 'ci'), runner('online', true, 'ci'), runner('online', false, 'other')] },
        queued: { workflow_runs: [{ id: 7 }] },
        in_progress: { workflow_runs: [{ id: 8 }] },
        jobs7: { jobs: [job('queued', 'ci'), job('queued', 'ubuntu-latest')] },
        jobs8: { jobs: [job('queued', 'ci'), job('in_progress', 'ci')] },
      };
      fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(answers));
      // The stub answers `gh api <method flags> <endpoint>` from the fixture by the endpoint it was asked for.
      fs.writeFileSync(
        path.join(bin, 'gh'),
        `#!/usr/bin/env bun
const answers = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(dir, 'answers.json'))}, 'utf-8'));
const endpoint = process.argv.slice(2).find((a) => a.startsWith('repos/')) ?? '';
const key = endpoint.includes('/actions/runners') ? 'runners' : endpoint.includes('status=queued') ? 'queued' : endpoint.includes('status=in_progress') ? 'in_progress' : endpoint.includes('/runs/7/jobs') ? 'jobs7' : endpoint.includes('/runs/8/jobs') ? 'jobs8' : null;
if (!key) { console.error('unexpected ' + endpoint); process.exit(1); }
console.log(JSON.stringify(answers[key]));
`,
        { mode: 0o755 },
      );
      const configPath = path.join(dir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ repo: 'o/r', forge: 'github', ci_capacity: { enabled: true, lanes: ['ci'], queue_allowance: 2 } }));
      const r = spawnSync('bun', ['run', cli, '--config', configPath], { encoding: 'utf-8', env: { PATH: `${bin}:${process.env.PATH ?? ''}` } });
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(parseCiCapacity(r.stdout.trim())).toEqual({ idle_runners: 1, busy_runners: 1, queued_jobs: 2, queue_allowance: 2 });
    });
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

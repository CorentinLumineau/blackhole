import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  classifyStepLogs,
  createGhRunner,
  diagnoseCi,
  isolateStepLog,
  isVercelPreviewCheck,
  listFailingJobs,
  passesContextCheck,
  pickFailedStep,
  type GhJob,
  type GhRunner,
  type StepLog,
} from './ci-diagnosis';

const root = path.resolve(import.meta.dirname, '..');
const fixturesDir = path.join(root, 'fixtures/ci-diagnosis');
const scriptPath = path.join(root, 'scripts/ci-diagnosis.ts');

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8'));
}

function readLogFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf-8');
}

describe('isVercelPreviewCheck', () => {
  test('matches Vercel preview checks', () => {
    expect(isVercelPreviewCheck('Vercel Preview')).toBe(true);
    expect(isVercelPreviewCheck('test')).toBe(false);
  });
});

describe('passesContextCheck', () => {
  test('rejects comment and fixture lines', () => {
    expect(passesContextCheck('# example: ETIMEDOUT')).toBe(false);
    expect(passesContextCheck('// network timeout in docs')).toBe(false);
    expect(passesContextCheck('fixture: no space left on device')).toBe(false);
    expect(passesContextCheck('"ETIMEDOUT"')).toBe(false);
  });

  test('accepts real error lines', () => {
    expect(passesContextCheck('npm ERR! code ETIMEDOUT')).toBe(true);
    expect(passesContextCheck('error: expect(received).toBe(expected)')).toBe(true);
  });
});

describe('pickFailedStep', () => {
  test('returns first failed step', () => {
    const job = readFixture<{ steps: { name: string; conclusion: string; number: number }[] }>(
      'jobs-genuine.json',
    ).jobs[0];
    const step = pickFailedStep(job.steps);
    expect(step?.name).toBe('Run tests');
  });
});

describe('isolateStepLog', () => {
  test('extracts only the failed step group from a job log', () => {
    const full = readLogFixture('log-genuine.txt');
    const isolated = isolateStepLog(full, 'Run tests');
    expect(isolated).toContain('expect(received).toBe(expected)');
    expect(isolated).not.toContain('##[group]');
  });

  test('returns tail when step group is missing', () => {
    const full = 'line1\nline2\nerror happened';
    const isolated = isolateStepLog(full, 'Missing Step');
    expect(isolated).toContain('error happened');
  });
});

describe('classifyStepLogs', () => {
  test('classifies genuine test failure', () => {
    const logs: StepLog[] = [
      {
        jobId: 1001,
        jobName: 'test',
        stepName: 'Run tests',
        log: readLogFixture('log-genuine.txt'),
      },
    ];
    expect(classifyStepLogs(logs)).toBe('genuine');
  });

  test('classifies environment network timeout', () => {
    const logs: StepLog[] = [
      {
        jobId: 2001,
        jobName: 'build',
        stepName: 'Setup Node',
        log: readLogFixture('log-environment.txt'),
      },
    ];
    expect(classifyStepLogs(logs)).toBe('environment');
  });
});

describe('listFailingJobs', () => {
  test('excludes Vercel preview jobs', () => {
    const jobs = readFixture<{ jobs: GhJob[] }>('jobs-genuine.json').jobs;
    const failing = listFailingJobs(jobs);
    expect(failing).toHaveLength(1);
    expect(failing[0].name).toBe('test');
  });
});

describe('diagnoseCi with fixture gh runner', () => {
  const genuineRunner: GhRunner = {
    getPrHeadSha: async () => readFixture<{ headRefOid: string }>('pr-head.json').headRefOid,
    listWorkflowRuns: async () => readFixture('workflow-runs.json').workflow_runs,
    listJobs: async () => readFixture<{ jobs: GhJob[] }>('jobs-genuine.json').jobs,
    getJobLog: async () => readLogFixture('log-genuine.txt'),
    getFailedRunLog: async () => readLogFixture('log-genuine.txt'),
  };

  test('returns genuine classification with isolated step logs', async () => {
    const result = await diagnoseCi(42, 'owner/repo', genuineRunner);
    expect(result.classification).toBe('genuine');
    expect(result.failing_jobs).toHaveLength(1);
    expect(result.step_logs[0].log).toContain('expect(received).toBe(expected)');
    expect(result.run_ids).toEqual([9001]);
  });

  test('returns environment classification', async () => {
    const envRunner: GhRunner = {
      ...genuineRunner,
      listJobs: async () => readFixture<{ jobs: GhJob[] }>('jobs-environment.json').jobs,
      getJobLog: async () => readLogFixture('log-environment.txt'),
      getFailedRunLog: async () => readLogFixture('log-environment.txt'),
    };
    const result = await diagnoseCi(42, 'owner/repo', envRunner);
    expect(result.classification).toBe('environment');
    expect(result.step_logs[0].stepName).toBe('Setup Node');
  });
});

describe('createGhRunner', () => {
  let spawnSyncSpy: ReturnType<typeof spyOn<typeof childProcess, 'spawnSync'>>;

  afterEach(() => {
    spawnSyncSpy?.mockRestore();
  });

  test('getFailedRunLog passes --repo to gh run view', async () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: 'failed step output',
      stderr: '',
    });

    const runner = createGhRunner();
    const log = await runner.getFailedRunLog(9001, 'owner/repo');

    expect(log).toBe('failed step output');
    const runViewArgs = spawnSyncSpy.mock.calls.find((call) => call[1]?.[0] === 'run')?.[1];
    expect(runViewArgs).toContain('run');
    expect(runViewArgs).toContain('view');
    expect(runViewArgs).toContain('9001');
    expect(runViewArgs).toContain('--repo');
    expect(runViewArgs).toContain('owner/repo');
    expect(runViewArgs).toContain('--log-failed');
  });
});

describe('ci-diagnosis CLI', () => {
  test('prints usage on missing --pr', async () => {
    const proc = Bun.spawn({
      cmd: ['bun', 'run', scriptPath],
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: root,
    });
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('--pr');
  });
});

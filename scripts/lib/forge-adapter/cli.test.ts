import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import { runGh, runGhApiJson, runGhApiText, runGhJson, runGhText } from './cli.ts';

describe('cli (gh)', () => {
  let spawnSyncSpy: ReturnType<typeof spyOn<typeof childProcess, 'spawnSync'>>;

  afterEach(() => {
    spawnSyncSpy?.mockRestore();
  });

  test('runGh appends --repo when options.repo is given and --repo is absent', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    runGh(['pr', 'view', '5'], { repo: 'owner/repo' });

    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'gh',
      ['pr', 'view', '5', '--repo', 'owner/repo'],
      { encoding: 'utf-8' },
    );
  });

  test('runGh does not duplicate --repo when the caller already supplied it', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    runGh(['pr', 'view', '5', '--repo', 'other/repo'], { repo: 'owner/repo' });

    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'gh',
      ['pr', 'view', '5', '--repo', 'other/repo'],
      { encoding: 'utf-8' },
    );
  });

  test('runGh omits --repo entirely when no options are given', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    runGh(['auth', 'status']);

    expect(spawnSyncSpy).toHaveBeenCalledWith('gh', ['auth', 'status'], { encoding: 'utf-8' });
  });

  test('runGhJson parses stdout JSON and returns it', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: '{"number":5,"title":"pr"}',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    const row = runGhJson<{ number: number; title: string }>(['pr', 'view', '5'], {
      repo: 'owner/repo',
    });

    expect(row).toEqual({ number: 5, title: 'pr' });
  });

  test('runGhJson throws with stderr on a non-zero exit', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'connection refused',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    expect(() => runGhJson(['pr', 'view', '5'])).toThrow('connection refused');
  });

  test('runGhJson falls back to stdout, then a generic message, when stderr is empty', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 1,
      stdout: 'partial output',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    expect(() => runGhJson(['pr', 'view', '5'])).toThrow('partial output');

    spawnSyncSpy.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    expect(() => runGhJson(['pr', 'view', '5'])).toThrow('gh pr view 5 failed');
  });

  test('runGhText returns raw stdout on success and throws the same way on failure', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: 'comment posted',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);
    expect(runGhText(['pr', 'comment', '5'])).toBe('comment posted');

    spawnSyncSpy.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'not found',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);
    expect(() => runGhText(['pr', 'comment', '5'])).toThrow('not found');
  });

  test('runGh surfaces an ENOENT error untouched on the raw result', () => {
    const enoent = Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' });
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: null,
      stdout: null,
      stderr: null,
      error: enoent,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    const result = runGh(['auth', 'status']);

    expect(result.status).toBeNull();
    expect(result.error).toBe(enoent);
    expect(result.error?.code).toBe('ENOENT');
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  test('runGhApiJson wraps the endpoint in a gh api call and pins repo passthrough', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: '{"workflow_runs":[]}',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    const data = runGhApiJson<{ workflow_runs: unknown[] }>(
      'repos/owner/repo/actions/runs?head_sha=abc',
      { repo: 'owner/repo' },
    );

    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'gh',
      ['api', 'repos/owner/repo/actions/runs?head_sha=abc', '--repo', 'owner/repo'],
      { encoding: 'utf-8' },
    );
    expect(data).toEqual({ workflow_runs: [] });
  });

  test('runGhApiText wraps the endpoint in a gh api call and returns raw text', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: 'raw log output',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    const log = runGhApiText('repos/owner/repo/actions/jobs/9/logs', { repo: 'owner/repo' });

    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'gh',
      ['api', 'repos/owner/repo/actions/jobs/9/logs', '--repo', 'owner/repo'],
      { encoding: 'utf-8' },
    );
    expect(log).toBe('raw log output');
  });
});

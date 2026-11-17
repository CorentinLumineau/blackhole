import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import { runGh, runGhApiJson, runGhApiText, runGhJson, runGhText } from './cli.ts';
import { FORGE_CLI_MAX_BUFFER } from './spawn.ts';

/**
 * A minimal `child_process.spawnSync` return value shaped for the mocks below — status/stdout/
 * stderr are the only fields any of these tests vary; `pid`/`output`/`signal` are constant
 * filler `spawnSync` always returns but this suite never asserts on.
 */
function mockSpawnResult(
  stdout: string,
  status: number,
  stderr = '',
): ReturnType<typeof childProcess.spawnSync> {
  return {
    status,
    stdout,
    stderr,
    pid: 1,
    output: [],
    signal: null,
  } as unknown as ReturnType<typeof childProcess.spawnSync>;
}

describe('cli (gh)', () => {
  let spawnSyncSpy: ReturnType<typeof spyOn<typeof childProcess, 'spawnSync'>>;

  afterEach(() => {
    spawnSyncSpy?.mockRestore();
  });

  test('runGh appends --repo when options.repo is given and --repo is absent', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('ok', 0));

    runGh(['pr', 'view', '5'], { repo: 'owner/repo' });

    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'gh',
      ['pr', 'view', '5', '--repo', 'owner/repo'],
      { encoding: 'utf-8', maxBuffer: FORGE_CLI_MAX_BUFFER },
    );
  });

  test('runGh does not duplicate --repo when the caller already supplied it', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('ok', 0));

    runGh(['pr', 'view', '5', '--repo', 'other/repo'], { repo: 'owner/repo' });

    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'gh',
      ['pr', 'view', '5', '--repo', 'other/repo'],
      { encoding: 'utf-8', maxBuffer: FORGE_CLI_MAX_BUFFER },
    );
  });

  test('runGh omits --repo entirely when no options are given', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('ok', 0));

    runGh(['auth', 'status']);

    expect(spawnSyncSpy).toHaveBeenCalledWith('gh', ['auth', 'status'], { encoding: 'utf-8', maxBuffer: FORGE_CLI_MAX_BUFFER });
  });

  test('runGhJson parses stdout JSON and returns it', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('{"number":5,"title":"pr"}', 0));

    const row = runGhJson<{ number: number; title: string }>(['pr', 'view', '5'], {
      repo: 'owner/repo',
    });

    expect(row).toEqual({ number: 5, title: 'pr' });
  });

  test('runGhJson throws with stderr on a non-zero exit', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('', 1, 'connection refused'));

    expect(() => runGhJson(['pr', 'view', '5'])).toThrow('connection refused');
  });

  test('runGhJson falls back to stdout, then a generic message, when stderr is empty', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('partial output', 1));

    expect(() => runGhJson(['pr', 'view', '5'])).toThrow('partial output');

    spawnSyncSpy.mockReturnValue(mockSpawnResult('', 1));

    expect(() => runGhJson(['pr', 'view', '5'])).toThrow('gh pr view 5 failed');
  });

  test('runGhText returns raw stdout on success and throws the same way on failure', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('comment posted', 0));
    expect(runGhText(['pr', 'comment', '5'])).toBe('comment posted');

    spawnSyncSpy.mockReturnValue(mockSpawnResult('', 1, 'not found'));
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
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('{"workflow_runs":[]}', 0));

    const data = runGhApiJson<{ workflow_runs: unknown[] }>(
      'repos/owner/repo/actions/runs?head_sha=abc',
      { repo: 'owner/repo' },
    );

    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'gh',
      ['api', 'repos/owner/repo/actions/runs?head_sha=abc', '--repo', 'owner/repo'],
      { encoding: 'utf-8', maxBuffer: FORGE_CLI_MAX_BUFFER },
    );
    expect(data).toEqual({ workflow_runs: [] });
  });

  test('runGhApiText wraps the endpoint in a gh api call and returns raw text', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('raw log output', 0));

    const log = runGhApiText('repos/owner/repo/actions/jobs/9/logs', { repo: 'owner/repo' });

    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'gh',
      ['api', 'repos/owner/repo/actions/jobs/9/logs', '--repo', 'owner/repo'],
      { encoding: 'utf-8', maxBuffer: FORGE_CLI_MAX_BUFFER },
    );
    expect(log).toBe('raw log output');
  });
  test('runGh raises the spawn buffer far above the 1 MiB default', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('ok', 0));

    runGh(['api', 'repos/o/r/pulls?per_page=100']);

    const options = spawnSyncSpy.mock.calls[0]?.[2] as { maxBuffer?: number };
    expect(options.maxBuffer).toBe(FORGE_CLI_MAX_BUFFER);
    expect(FORGE_CLI_MAX_BUFFER).toBeGreaterThanOrEqual(256 * 1024 * 1024);
  });

  test('runGhJson reports ENOBUFS as a buffer overflow, not a JSON parse error over the cut output', () => {
    const truncated = '[{"url":"https://example.test/1","body":"cut mid-str';
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      ...mockSpawnResult(truncated, 0),
      status: null,
      signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync gh ENOBUFS'), { code: 'ENOBUFS' }),
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    let message = '';
    try {
      runGhJson(['api', 'repos/o/r/pulls?per_page=100']);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('ENOBUFS');
    expect(message).toContain('gh api');
    expect(message).toContain(String(FORGE_CLI_MAX_BUFFER));
    expect(message).not.toContain('cut mid-str');
    expect(message).not.toMatch(/JSON/);
  });
});

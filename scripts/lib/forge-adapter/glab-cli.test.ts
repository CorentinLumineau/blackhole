import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import { runGlab, runGlabJson, runGlabText } from './glab-cli.ts';
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

describe('glab-cli', () => {
  let spawnSyncSpy: ReturnType<typeof spyOn<typeof childProcess, 'spawnSync'>>;

  afterEach(() => {
    spawnSyncSpy?.mockRestore();
  });

  test('runGlab spawns glab with the exact argv', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('GitLab: gitlab.com\n', 0));

    const result = runGlab(['auth', 'status']);

    expect(spawnSyncSpy).toHaveBeenCalledWith('glab', ['auth', 'status'], { encoding: 'utf-8', maxBuffer: FORGE_CLI_MAX_BUFFER });
    expect(result).toEqual({ status: 0, stdout: 'GitLab: gitlab.com\n', stderr: '', error: null });
  });

  test('runGlabJson appends --output json when --output is absent from the input args', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('[{"iid":4,"title":"mr"}]', 0));

    runGlabJson(['mr', 'list']);

    expect(spawnSyncSpy).toHaveBeenCalledWith('glab', ['mr', 'list', '--output', 'json'], {
      encoding: 'utf-8',
      maxBuffer: FORGE_CLI_MAX_BUFFER,
    });
  });

  test('runGlabJson does not duplicate --output when already present', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('[]', 0));

    runGlabJson(['mr', 'list', '--output', 'json']);

    expect(spawnSyncSpy).toHaveBeenCalledWith('glab', ['mr', 'list', '--output', 'json'], {
      encoding: 'utf-8',
      maxBuffer: FORGE_CLI_MAX_BUFFER,
    });
  });

  test('runGlabJson parses stdout JSON and returns it', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('[{"iid":4,"title":"mr"}]', 0));

    const rows = runGlabJson<Array<{ iid: number; title: string }>>(['mr', 'list']);

    expect(rows).toEqual([{ iid: 4, title: 'mr' }]);
  });

  test('runGlabJson throws with stderr on a non-zero exit', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('', 1, 'connection refused'));

    expect(() => runGlabJson(['mr', 'list'])).toThrow('connection refused');
  });

  test('runGlabJson falls back to stdout, then a generic message, when stderr is empty', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('partial output', 1));

    expect(() => runGlabJson(['mr', 'list'])).toThrow('partial output');

    spawnSyncSpy.mockReturnValue(mockSpawnResult('', 1));

    expect(() => runGlabJson(['mr', 'list'])).toThrow('glab mr list failed');
  });

  test('runGlabText returns raw stdout on success and throws the same way on failure', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('note posted', 0));
    expect(runGlabText(['mr', 'note', '4'])).toBe('note posted');

    spawnSyncSpy.mockReturnValue(mockSpawnResult('', 1, 'not found'));
    expect(() => runGlabText(['mr', 'note', '4'])).toThrow('not found');
  });

  test('runGlab surfaces an ENOENT error untouched on the raw result', () => {
    const enoent = Object.assign(new Error('spawnSync glab ENOENT'), { code: 'ENOENT' });
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: null,
      stdout: null,
      stderr: null,
      error: enoent,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    const result = runGlab(['auth', 'status']);

    expect(result.status).toBeNull();
    expect(result.error).toBe(enoent);
    expect(result.error?.code).toBe('ENOENT');
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
  test('runGlab raises the spawn buffer far above the 1 MiB default', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('ok', 0));

    runGlab(['mr', 'list']);

    const options = spawnSyncSpy.mock.calls[0]?.[2] as { maxBuffer?: number };
    expect(options.maxBuffer).toBe(FORGE_CLI_MAX_BUFFER);
    expect(FORGE_CLI_MAX_BUFFER).toBeGreaterThanOrEqual(256 * 1024 * 1024);
  });

  test('runGlabJson reports ENOBUFS as a buffer overflow, not a JSON parse error over the cut output', () => {
    const truncated = '[{"url":"https://example.test/1","body":"cut mid-str';
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      ...mockSpawnResult(truncated, 0),
      status: null,
      signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync glab ENOBUFS'), { code: 'ENOBUFS' }),
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    let message = '';
    try {
      runGlabJson(['mr', 'list']);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('ENOBUFS');
    expect(message).toContain('glab mr');
    expect(message).toContain(String(FORGE_CLI_MAX_BUFFER));
    expect(message).not.toContain('cut mid-str');
    expect(message).not.toMatch(/JSON/);
  });
});

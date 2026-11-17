import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import { runTea, runTeaApi, runTeaJson, runTeaText } from './tea-cli.ts';
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

describe('tea-cli', () => {
  let spawnSyncSpy: ReturnType<typeof spyOn<typeof childProcess, 'spawnSync'>>;

  afterEach(() => {
    spawnSyncSpy?.mockRestore();
  });

  test('runTea spawns tea with the exact argv', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('logged in\n', 0));

    const result = runTea(['logins']);

    expect(spawnSyncSpy).toHaveBeenCalledWith('tea', ['logins'], { encoding: 'utf-8', maxBuffer: FORGE_CLI_MAX_BUFFER });
    expect(result).toEqual({ status: 0, stdout: 'logged in\n', stderr: '', error: null });
  });

  test('runTeaJson appends --json when absent from the input args', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('[{"index":3,"title":"issue"}]', 0));

    runTeaJson(['issues', 'list']);

    expect(spawnSyncSpy).toHaveBeenCalledWith('tea', ['issues', 'list', '--json'], {
      encoding: 'utf-8',
      maxBuffer: FORGE_CLI_MAX_BUFFER,
    });
  });

  test('runTeaJson does not duplicate --json when already present', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('[]', 0));

    runTeaJson(['issues', 'list', '--json']);

    expect(spawnSyncSpy).toHaveBeenCalledWith('tea', ['issues', 'list', '--json'], {
      encoding: 'utf-8',
      maxBuffer: FORGE_CLI_MAX_BUFFER,
    });
  });

  test('runTeaJson parses stdout JSON and returns it', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('[{"index":3,"title":"issue"}]', 0));

    const rows = runTeaJson<Array<{ index: number; title: string }>>(['issues', 'list']);

    expect(rows).toEqual([{ index: 3, title: 'issue' }]);
  });

  test('runTeaJson throws with stderr on a non-zero exit', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('', 1, 'connection refused'));

    expect(() => runTeaJson(['issues', 'list'])).toThrow('connection refused');
  });

  test('runTeaJson falls back to stdout, then a generic message, when stderr is empty', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('partial output', 1));

    expect(() => runTeaJson(['issues', 'list'])).toThrow('partial output');

    spawnSyncSpy.mockReturnValue(mockSpawnResult('', 1));

    expect(() => runTeaJson(['issues', 'list'])).toThrow('tea issues list failed');
  });

  test('runTeaText returns raw stdout on success and throws the same way on failure', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('comment posted', 0));
    expect(runTeaText(['issue', 'comment', '4'])).toBe('comment posted');

    spawnSyncSpy.mockReturnValue(mockSpawnResult('', 1, 'not found'));
    expect(() => runTeaText(['issue', 'comment', '4'])).toThrow('not found');
  });

  test('runTea surfaces an ENOENT error untouched on the raw result', () => {
    const enoent = Object.assign(new Error('spawnSync tea ENOENT'), { code: 'ENOENT' });
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: null,
      stdout: null,
      stderr: null,
      error: enoent,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    const result = runTea(['logins']);

    expect(result.status).toBeNull();
    expect(result.error).toBe(enoent);
    expect(result.error?.code).toBe('ENOENT');
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  // `tea api -i` exits 0 on an HTTP 4xx/5xx and prints the error object as the body, so a missing
  // commit or a disabled unit used to parse as a normal, empty reply.
  describe('runTeaApi', () => {
    test('an HTTP error status throws, though tea exited 0', () => {
      spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(
        mockSpawnResult('{"message":"not found","url":"https://forge.example/api/swagger"}', 0, 'HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n'),
      );
      expect(() => runTeaApi('GET', 'repos/acme/widgets/commits/abc/status')).toThrow('HTTP 404');
    });

    test('a 2xx reply returns the body and the headers', () => {
      spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('[]', 0, 'HTTP/2.0 200 OK\r\nX-Total-Count: 0\r\n'));
      expect(runTeaApi('GET', 'repos/acme/widgets/pulls')).toEqual({ body: '[]', headers: 'HTTP/2.0 200 OK\r\nX-Total-Count: 0\r\n' });
    });

    test('the last status line decides, so a redirect followed by a 200 is a success', () => {
      spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('{}', 0, 'HTTP/1.1 301 Moved Permanently\r\n\r\nHTTP/1.1 200 OK\r\n'));
      expect(runTeaApi('GET', 'user').body).toBe('{}');
    });
  });
  test('runTea raises the spawn buffer far above the 1 MiB default', () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue(mockSpawnResult('ok', 0));

    runTea(['issues', 'list']);

    const options = spawnSyncSpy.mock.calls[0]?.[2] as { maxBuffer?: number };
    expect(options.maxBuffer).toBe(FORGE_CLI_MAX_BUFFER);
    expect(FORGE_CLI_MAX_BUFFER).toBeGreaterThanOrEqual(256 * 1024 * 1024);
  });

  test('runTeaJson reports ENOBUFS as a buffer overflow, not a JSON parse error over the cut output', () => {
    const truncated = '[{"url":"https://example.test/1","body":"cut mid-str';
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      ...mockSpawnResult(truncated, 0),
      status: null,
      signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync tea ENOBUFS'), { code: 'ENOBUFS' }),
    } as unknown as ReturnType<typeof childProcess.spawnSync>);

    let message = '';
    try {
      runTeaJson(['issues', 'list']);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('ENOBUFS');
    expect(message).toContain('tea issues');
    expect(message).toContain(String(FORGE_CLI_MAX_BUFFER));
    expect(message).not.toContain('cut mid-str');
    expect(message).not.toMatch(/JSON/);
  });
});

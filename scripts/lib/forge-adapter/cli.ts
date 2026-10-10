import { spawnSync } from 'child_process';

export type GhSpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
};

/** Sole `gh` spawn site for the GitHub forge backend (ADR-027, #679). */
export function runGh(args: string[], options?: { repo?: string; input?: string }): GhSpawnResult {
  const fullArgs = [...args];
  if (options?.repo && !args.includes('--repo')) {
    fullArgs.push('--repo', options.repo);
  }
  const spawnOptions = options?.input === undefined ? { encoding: 'utf-8' as const } : { encoding: 'utf-8' as const, input: options.input };
  const result = spawnSync('gh', fullArgs, spawnOptions);
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: (result.error as NodeJS.ErrnoException | undefined) ?? null,
  };
}

export function runGhJson<T>(args: string[], options?: { repo?: string }): T {
  const result = runGh(args, options);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `gh ${args.join(' ')} failed`);
  }
  return JSON.parse(result.stdout) as T;
}

export function runGhText(args: string[], options?: { repo?: string }): string {
  const result = runGh(args, options);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `gh ${args.join(' ')} failed`);
  }
  return result.stdout;
}

export function runGhApiJson<T>(endpoint: string, options?: { repo?: string }): T {
  return runGhJson<T>(['api', endpoint], options);
}

export function runGhApiText(endpoint: string, options?: { repo?: string }): string {
  return runGhText(['api', endpoint], options);
}

export type GhApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * One GitHub REST call through `gh api` (ADR-048). REST works with a plain token wherever GraphQL
 * is blocked or `gh auth status` fails, so every GitHub adapter call goes through here. A JSON
 * `body` is sent on stdin. Returns the raw spawn result so callers can tell a 404 from a failure.
 */
export function runGhApi(method: GhApiMethod, endpoint: string, body?: unknown): GhSpawnResult {
  const args = ['api', '-X', method, endpoint];
  if (body === undefined) return runGh(args);
  return runGh([...args, '--input', '-'], { input: JSON.stringify(body) });
}

export const isNotFound = (result: GhSpawnResult): boolean => /HTTP 404/.test(result.stderr);

export function runGhApiRestJson<T>(method: GhApiMethod, endpoint: string, body?: unknown): T {
  const result = runGhApi(method, endpoint, body);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `gh api ${method} ${endpoint} failed`);
  }
  return (result.stdout.trim() ? JSON.parse(result.stdout) : null) as T;
}

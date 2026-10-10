import { spawnSync } from 'child_process';

export type GhSpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
};

/** Sole `gh` spawn site for the GitHub forge backend (ADR-027, #679). */
export function runGh(args: string[], options?: { repo?: string }): GhSpawnResult {
  const fullArgs = [...args];
  if (options?.repo && !args.includes('--repo')) {
    fullArgs.push('--repo', options.repo);
  }
  const result = spawnSync('gh', fullArgs, { encoding: 'utf-8' });
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

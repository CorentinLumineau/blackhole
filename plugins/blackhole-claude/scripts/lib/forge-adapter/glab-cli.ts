import { spawnSync } from 'child_process';

export type GlabSpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
};

/** Sole `glab` spawn site for the GitLab forge backend (ADR-027, #681). */
export function runGlab(args: string[]): GlabSpawnResult {
  const result = spawnSync('glab', args, { encoding: 'utf-8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: (result.error as NodeJS.ErrnoException | undefined) ?? null,
  };
}

export function runGlabJson<T>(args: string[]): T {
  const jsonArgs = args.includes('--output') ? args : [...args, '--output', 'json'];
  const result = runGlab(jsonArgs);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `glab ${args.join(' ')} failed`);
  }
  return JSON.parse(result.stdout) as T;
}

export function runGlabText(args: string[]): string {
  const result = runGlab(args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `glab ${args.join(' ')} failed`);
  }
  return result.stdout;
}

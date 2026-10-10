import { spawnSync } from 'child_process';

export type TeaSpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
};

/** Sole `tea` spawn site for the Gitea forge backend (ADR-027, #680). */
export function runTea(args: string[]): TeaSpawnResult {
  const result = spawnSync('tea', args, { encoding: 'utf-8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: (result.error as NodeJS.ErrnoException | undefined) ?? null,
  };
}

export function runTeaJson<T>(args: string[]): T {
  const jsonArgs = args.includes('--json') ? args : [...args, '--json'];
  const result = runTea(jsonArgs);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `tea ${args.join(' ')} failed`);
  }
  return JSON.parse(result.stdout) as T;
}

export function runTeaText(args: string[]): string {
  const result = runTea(args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `tea ${args.join(' ')} failed`);
  }
  return result.stdout;
}

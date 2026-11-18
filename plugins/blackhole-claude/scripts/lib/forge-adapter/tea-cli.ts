import { spawnSync } from 'child_process';
import { FORGE_CLI_MAX_BUFFER, toForgeSpawnResult, type ForgeSpawnResult } from './spawn.ts';

export type TeaSpawnResult = ForgeSpawnResult;

/** Sole `tea` spawn site for the Gitea forge backend (ADR-027, #680). */
export function runTea(args: string[]): TeaSpawnResult {
  const result = spawnSync('tea', args, { encoding: 'utf-8', maxBuffer: FORGE_CLI_MAX_BUFFER });
  return toForgeSpawnResult('tea', args, result);
}

const hasOutputFlag = (args: string[]): boolean =>
  args.some((a) => a === '--output' || a === '-o' || a.startsWith('--output=') || a.startsWith('-o='));

/** tea 0.14.2 has no `--json`; list commands take `--output json` and print only the `--fields` asked for. */
export function runTeaJson<T>(args: string[]): T {
  const jsonArgs = hasOutputFlag(args) ? args : [...args, '--output', 'json'];
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

export type TeaApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type TeaApiResult = { body: string; headers: string };

/**
 * One Gitea REST call through `tea api`. Response headers (`X-Total-Count`) come back on stderr,
 * so a caller can tell a short page from the last page without trusting the server's page-size cap.
 */
export function runTeaApi(method: TeaApiMethod, endpoint: string, body?: unknown): TeaApiResult {
  const args = ['api', '-i', '-X', method, endpoint];
  if (body !== undefined) args.push('-d', JSON.stringify(body));
  const result = runTea(args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `tea api ${method} ${endpoint} failed`);
  }
  // `tea api` exits 0 on an HTTP 4xx/5xx and prints the error object as the body: without this
  // check a missing resource parses as an empty, successful reply.
  const codes = [...result.stderr.matchAll(/^HTTP\/\S+\s+(\d{3})/gm)];
  const code = codes.length ? Number(codes[codes.length - 1][1]) : 0;
  if (code >= 400) throw new Error(`tea api ${method} ${endpoint} failed: HTTP ${code}`);
  return { body: result.stdout, headers: result.stderr };
}

export function runTeaApiJson<T>(method: TeaApiMethod, endpoint: string, body?: unknown): { data: T; headers: string } {
  const { body: text, headers } = runTeaApi(method, endpoint, body);
  return { data: (text.trim() ? JSON.parse(text) : null) as T, headers };
}

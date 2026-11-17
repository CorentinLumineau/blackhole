import type { SpawnSyncReturns } from 'child_process';

/**
 * Output ceiling for every forge CLI spawn (`gh`, `tea`, `glab`). Node's `spawnSync` default is
 * 1 MiB, which one page of 100 pull requests with full bodies already exceeds.
 */
export const FORGE_CLI_MAX_BUFFER = 256 * 1024 * 1024;

export type ForgeSpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
};

/**
 * Normalizes a forge CLI `spawnSync` result. Output past the buffer is cut off mid-stream, so an
 * `ENOBUFS` result is thrown here, before any caller can parse or print the partial stdout.
 */
export function toForgeSpawnResult(tool: string, args: string[], raw: SpawnSyncReturns<string>): ForgeSpawnResult {
  const error = (raw.error as NodeJS.ErrnoException | undefined) ?? null;
  if (error?.code === 'ENOBUFS') {
    throw new Error(
      `${tool} ${args.join(' ')}: output exceeded the ${FORGE_CLI_MAX_BUFFER}-byte spawn buffer (ENOBUFS) and was cut off`,
    );
  }
  return { status: raw.status, stdout: raw.stdout ?? '', stderr: raw.stderr ?? '', error };
}

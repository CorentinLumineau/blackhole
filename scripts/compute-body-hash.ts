import { computeBodyHash } from './lib/body-hash.ts';

// Issue #885 — thin CLI wrapper around `computeBodyHash` (`scripts/lib/body-hash.ts`),
// the copy-pasteable recipe for router agents and for `recovery-protocol.md` §8's
// recompute step. Reads `{"title": "...", "body": "..."}` as JSON from stdin rather
// than shell-interpolated argv: issue titles/bodies contain quotes, backticks, `$`,
// and newlines that would break naive `--title "$TITLE"` argv passing. Same
// CLI/library split convention as `scripts/lib/plugin-drift.ts` / `scripts/plugin-drift-signal.ts`.

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function main(): Promise<number> {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error('compute-body-hash: empty stdin payload');
    return 2;
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    console.error(`compute-body-hash: stdin JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (
    typeof input !== 'object' ||
    input === null ||
    typeof (input as Record<string, unknown>).title !== 'string' ||
    typeof (input as Record<string, unknown>).body !== 'string'
  ) {
    console.error('compute-body-hash: stdin payload must be {"title": string, "body": string}');
    return 2;
  }

  const { title, body } = input as { title: string; body: string };
  console.log(computeBodyHash(title, body));
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}

import * as fs from 'fs';
import { readJsonFile } from './fs.ts';

// Issue #489 — the write-protocol guard `blackhole-state.md` § Write protocol prescribes before
// every atomic install of a `.tmp` file over `queue.json`/`findings-ledger.json`. Replaces the
// bare `jq empty <file>` guard, which exits 0 on a zero-byte file: it detects malformed JSON,
// not *absent* JSON. A heredoc-authored `jq` program that failed to compile left a 0-byte `.tmp`
// file (shell redirects truncate before the command runs); `jq empty` passed it, and the
// campaign's entire `queue.json` (98 issue entries) was silently overwritten. This is the SSOT
// both the protocol doc and any script call site reference (V-INT-02, one definition).

export type StateWriteGuardResult = { ok: true } | { ok: false; reason: string };

export type StateWriteGuardParams = {
  /** The `.tmp` file about to be installed over `livePath`. */
  tmpPath: string;
  /** The live file `tmpPath` would replace, or `null`/a non-existent path for a first write. */
  livePath: string | null;
  /** Top-level key whose entries are counted — `issues` for queue.json, `findings` for the ledger. */
  entityKey: string;
  /** Explicit escape hatch for a legitimate shrink (an issue removed, a ledger rotated to
   *  archive/). Widens the non-regression check to allow a smaller-but-non-zero count; it never
   *  waives the zero-entity refusal below — a declared shrink is not a declared wipe. */
  allowShrink?: boolean;
};

const countEntities = (parsed: unknown, entityKey: string): number | null => {
  if (typeof parsed !== 'object' || parsed === null || !(entityKey in parsed)) return null;
  const value = (parsed as Record<string, unknown>)[entityKey];
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object' && value !== null) return Object.keys(value).length;
  return null;
};

export const validateStateWrite = ({
  tmpPath,
  livePath,
  entityKey,
  allowShrink = false,
}: StateWriteGuardParams): StateWriteGuardResult => {
  // Non-trivial size — the guard `jq empty` cannot express. A 0-byte file is refused outright,
  // before it is even handed to a JSON parser.
  if (fs.statSync(tmpPath).size === 0) {
    return { ok: false, reason: `${tmpPath} is empty (0 bytes) — refusing to install over live state` };
  }

  let parsed: unknown;
  try {
    parsed = readJsonFile(tmpPath, tmpPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `malformed JSON: ${message}` };
  }

  const tmpCount = countEntities(parsed, entityKey);
  if (tmpCount === null) {
    return { ok: false, reason: `${tmpPath} is missing the required "${entityKey}" key or it is not an object/array` };
  }

  const liveExists = livePath !== null && fs.existsSync(livePath);
  if (!liveExists) return { ok: true };

  const liveParsed = readJsonFile(livePath as string, livePath as string);
  const liveCount = countEntities(liveParsed, entityKey);
  if (liveCount === null) return { ok: true }; // live file itself is structurally degenerate — nothing to regress against

  // A full collapse to zero is refused even when the caller declared a shrink: the escape hatch
  // covers "one fewer issue", not "every issue gone at once" — the exact incident shape.
  if (tmpCount === 0 && liveCount > 0) {
    return { ok: false, reason: `${entityKey} count would collapse to zero (was ${liveCount}) — refusing even with allowShrink` };
  }

  if (tmpCount < liveCount && !allowShrink) {
    return {
      ok: false,
      reason: `${entityKey} count would regress from ${liveCount} to ${tmpCount} — pass allowShrink to confirm a deliberate removal`,
    };
  }

  return { ok: true };
};

// Issue #543 — CLI entrypoint so `blackhole-state.md` § Write protocol can cite a runnable
// command instead of a bare function name. Exit codes let a caller branch on the outcome:
//   0 — validation passed, safe to install the .tmp file over live state
//   1 — validation refused; the reason is printed to stderr
//   2 — malformed CLI usage (missing required flags)
function parseCliArgs(argv: string[]): {
  tmp?: string;
  live?: string;
  entityKey?: string;
  allowShrink: boolean;
} {
  let tmp: string | undefined;
  let live: string | undefined;
  let entityKey: string | undefined;
  let allowShrink = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tmp' && argv[i + 1]) {
      tmp = argv[++i];
    } else if (arg === '--live' && argv[i + 1]) {
      live = argv[++i];
    } else if (arg === '--entity-key' && argv[i + 1]) {
      entityKey = argv[++i];
    } else if (arg === '--allow-shrink') {
      allowShrink = true;
    }
  }

  return { tmp, live, entityKey, allowShrink };
}

function main(): number {
  const { tmp, live, entityKey, allowShrink } = parseCliArgs(process.argv.slice(2));

  if (!tmp || !entityKey) {
    console.error(
      'Usage: bun run scripts/lib/state-write-guard.ts --tmp <path> --entity-key <key> [--live <path>] [--allow-shrink]',
    );
    return 2;
  }

  const result = validateStateWrite({
    tmpPath: tmp,
    livePath: live ?? null,
    entityKey,
    allowShrink,
  });

  if (!result.ok) {
    console.error(result.reason);
    return 1;
  }

  return 0;
}

if (import.meta.main) {
  process.exit(main());
}

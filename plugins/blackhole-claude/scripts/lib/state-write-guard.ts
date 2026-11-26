import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './fs.ts';
import { parseFlags } from './argv-flags.ts';
import { QUEUE_PHASES, QUEUE_STATUSES } from './campaign-status/queue.ts';

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

type ContainerKind = 'array' | 'object';

const containerKind = (parsed: unknown, entityKey: string): ContainerKind | null => {
  if (typeof parsed !== 'object' || parsed === null || !(entityKey in parsed)) return null;
  const value = (parsed as Record<string, unknown>)[entityKey];
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' && value !== null ? 'object' : null;
};

const countEntities = (parsed: unknown, entityKey: string): number | null => {
  const kind = containerKind(parsed, entityKey);
  if (kind === null) return null;
  const value = (parsed as Record<string, unknown>)[entityKey] as object;
  return kind === 'array' ? (value as unknown[]).length : Object.keys(value).length;
};

// queue.json's entity key. Only its entries carry the `status`/`phase` enums of `QUEUE_STATUSES` /
// `QUEUE_PHASES`; the ledger's `findings` use their own status vocabulary and are not checked here.
const QUEUE_ENTITY_KEY = 'issues';

// The remedy for a queue written before the enums were enforced: legacy values (`done`,
// `in-review`, `excluded`, phase `loop`) have a documented mapping in `scripts/queue-migrate.ts`.
const QUEUE_MIGRATE_REMEDY =
  'Legacy values are migrated by scripts/queue-migrate.ts in the blackhole plugin (dry run by default, --apply to write; queue-dag.md § Legacy values)';

/** The first `issues` object key that is not a positive issue number, as a refusal reason. */
const queueKeyError = (entries: unknown): string | null => {
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) return null;
  const bad = Object.keys(entries).find((key) => !/^[1-9]\d*$/.test(key));
  return bad === undefined ? null : `queue key ${JSON.stringify(bad)} is not an issue number (positive integer)`;
};

/** The first queue entry whose `status` or `phase` is present but undocumented, as a refusal reason. */
const queueEnumError = (entries: unknown): string | null => {
  if (typeof entries !== 'object' || entries === null) return null;
  const fields: Array<[string, readonly string[]]> = [
    ['status', QUEUE_STATUSES],
    ['phase', QUEUE_PHASES],
  ];
  for (const [num, entry] of Object.entries(entries)) {
    if (typeof entry !== 'object' || entry === null) continue;
    for (const [field, allowed] of fields) {
      const value = (entry as Record<string, unknown>)[field];
      if (value === undefined || (typeof value === 'string' && allowed.includes(value))) continue;
      return `queue entry #${num} has ${field} ${JSON.stringify(value)} — valid values: ${allowed.join(', ')}. ${QUEUE_MIGRATE_REMEDY}`;
    }
  }
  return null;
};

export type InstallStateFileParams = {
  livePath: string;
  archiveDir: string;
  /** Serialized candidate content, written verbatim to `<livePath>.tmp`. */
  content: string;
  entityKey: string;
  allowShrink?: boolean;
};

/** Write protocol steps 1-4: snapshot the live file (when one exists) into `archiveDir`, write the candidate to
 *  `<livePath>.tmp`, validate it, then atomically install it. A refused candidate leaves the live
 *  file untouched and the `.tmp` removed. */
export const installStateFile = ({
  livePath,
  archiveDir,
  content,
  entityKey,
  allowShrink,
}: InstallStateFileParams): StateWriteGuardResult => {
  fs.mkdirSync(archiveDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(livePath, path.extname(livePath));
  // A first write has nothing to snapshot yet.
  if (fs.existsSync(livePath)) fs.copyFileSync(livePath, path.join(archiveDir, `${base}-${timestamp}.json`));

  const tmpPath = `${livePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');

  const validation = validateStateWrite({ tmpPath, livePath, entityKey, allowShrink });
  if (!validation.ok) {
    fs.rmSync(tmpPath);
    return validation;
  }

  fs.renameSync(tmpPath, livePath);
  return { ok: true };
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

  if (entityKey === QUEUE_ENTITY_KEY) {
    const entries = (parsed as Record<string, unknown>)[entityKey];
    const structureError = queueKeyError(entries) ?? queueEnumError(entries);
    if (structureError) return { ok: false, reason: structureError };
  }

  const liveExists = livePath !== null && fs.existsSync(livePath);
  if (!liveExists) return { ok: true };

  const liveParsed = readJsonFile(livePath as string, livePath as string);
  const liveCount = countEntities(liveParsed, entityKey);
  if (liveCount === null) return { ok: true }; // live file itself is structurally degenerate — nothing to regress against

  // Counts alone cannot see an object rewritten into a same-size array (or the reverse), which
  // readers keyed on the live shape would then misread: the shape must not change.
  const liveKind = containerKind(liveParsed, entityKey);
  const tmpKind = containerKind(parsed, entityKey);
  if (liveKind !== tmpKind) {
    return {
      ok: false,
      reason: `${entityKey} container type would change from ${liveKind} to ${tmpKind} — a rewrite must keep the live file's shape`,
    };
  }

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
  const flags = parseFlags(argv);
  return {
    tmp: typeof flags.tmp === 'string' ? flags.tmp : undefined,
    live: typeof flags.live === 'string' ? flags.live : undefined,
    entityKey: typeof flags['entity-key'] === 'string' ? flags['entity-key'] : undefined,
    allowShrink: flags['allow-shrink'] === true,
  };
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

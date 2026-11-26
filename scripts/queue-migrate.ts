import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { DONE_STATUSES, QUEUE_PHASES, QUEUE_STATUSES } from './lib/campaign-status/queue.ts';
import { installStateFile } from './lib/state-write-guard.ts';

// One-shot migration of a consumer `queue.json` that still carries legacy `status`/`phase` values
// the state-write guard now refuses (`queue-dag.md` § Legacy values). Dry run by default; `--apply`
// snapshots the live file to `archive/` and installs through `installStateFile`, so the guard
// validates the result. Every entry is kept: a value with no documented mapping throws, naming the
// entry, rather than being guessed or dropped. It also drops the ingest-appended numbers from
// `user_queue_order`, which must hold only owner pins (`migrateUserQueueOrder`).

const USAGE = 'Usage: bun run scripts/queue-migrate.ts [--campaign-dir <dir>] [--apply]';

type Entry = Record<string, unknown>;

/** The note a migrated `excluded` entry carries: the owner gate first, then why. */
export const EXCLUDED_NOTE = 'awaiting-user-clarification: legacy status excluded, confirm whether it rejoins the campaign';

/** Legacy phase -> documented phase. `loop` was the post-merge phase that `done` replaced. */
export const LEGACY_PHASE_MAP: Readonly<Record<string, string>> = { loop: 'done' };

/** Legacy status -> the documented fields it becomes. `done` resolves on the entry's `pr` (below). */
export const LEGACY_STATUS_MAP: Readonly<Record<string, (entry: Entry) => Entry>> = {
  // Terminal either way; a recorded PR number says it landed through a PR.
  done: (entry) => ({ status: typeof entry.pr === 'number' ? 'merged' : 'closed', phase: 'done' }),
  // A review in progress is status in-flight with phase review (`queue-dag.md` § Per-issue fields).
  'in-review': () => ({ status: 'in-flight', phase: 'review' }),
  // Blocked behind the documented owner gate, not ready: the owner had taken it out of the
  // campaign, so the promotion rule (`queue-dag.md` § Step 2, "user gates pass") must not pick it
  // up again until the owner answers. The leading `awaiting-user-clarification` token is what the
  // status page and the resume signal read as an owner gate.
  excluded: (entry) => ({
    status: 'blocked',
    notes: typeof entry.notes === 'string' && entry.notes ? `${EXCLUDED_NOTE}; ${entry.notes}` : EXCLUDED_NOTE,
  }),
};

export type QueueChange = { issue: string; field: 'status' | 'phase'; from: string; to: string };

const legacyError = (num: string, field: string, value: unknown, allowed: readonly string[], legacy: Record<string, unknown>) =>
  new Error(
    `queue entry #${num} has ${field} ${JSON.stringify(value)}, which has no documented mapping — valid values: ${allowed.join(', ')}; migrated legacy values: ${Object.keys(legacy).join(', ')}. Fix this entry by hand.`,
  );

/** Maps every legacy status/phase to documented values. Pure; throws on a value it cannot map. */
export function migrateQueueEntries(issues: Record<string, unknown>): { issues: Record<string, unknown>; changes: QueueChange[] } {
  const changes: QueueChange[] = [];
  const out: Record<string, unknown> = {};
  for (const [num, raw] of Object.entries(issues)) {
    if (typeof raw !== 'object' || raw === null) {
      out[num] = raw;
      continue;
    }
    let entry: Entry = { ...(raw as Entry) };
    const status = entry.status;
    if (status !== undefined && !(typeof status === 'string' && QUEUE_STATUSES.includes(status))) {
      const map = typeof status === 'string' ? LEGACY_STATUS_MAP[status] : undefined;
      if (!map) throw legacyError(num, 'status', status, QUEUE_STATUSES, LEGACY_STATUS_MAP);
      const before = entry;
      entry = { ...entry, ...map(entry) };
      changes.push({ issue: num, field: 'status', from: status as string, to: entry.status as string });
      if (entry.phase !== before.phase) changes.push({ issue: num, field: 'phase', from: String(before.phase ?? '(none)'), to: entry.phase as string });
    }
    const phase = entry.phase;
    if (phase !== undefined && !(typeof phase === 'string' && QUEUE_PHASES.includes(phase))) {
      const mapped = typeof phase === 'string' ? LEGACY_PHASE_MAP[phase] : undefined;
      if (!mapped) throw legacyError(num, 'phase', phase, QUEUE_PHASES, LEGACY_PHASE_MAP);
      entry = { ...entry, phase: mapped };
      changes.push({ issue: num, field: 'phase', from: phase as string, to: mapped });
    }
    out[num] = entry;
  }
  return { issues: out, changes };
}

/** Notes an ingest-created entry carries (`auto-sync ingest`, `Ingested turn 13 ...`). */
export const INGEST_NOTE_RE = /\bauto-sync\b|^\s*ingested\b/i;

/**
 * Splits `user_queue_order` into owner pins and leftovers of the old ingest append. Ingest left no
 * marker, so the rule is conservative: drop a number only when it has no queue entry, its entry is
 * terminal, or its entry is still `ready` with an ingest note; keep everything else (a kept ingest
 * entry is harmless, a dropped owner pin is lost intent). Pure; order of kept entries is preserved.
 */
export function migrateUserQueueOrder(queue: { user_queue_order?: unknown; issues?: Record<string, unknown> }): {
  order: number[];
  dropped: number[];
  kept: number[];
} {
  const order: number[] = [];
  const dropped: number[] = [];
  const raw = Array.isArray(queue.user_queue_order) ? queue.user_queue_order : [];
  for (const n of raw as number[]) {
    const entry = queue.issues?.[String(n)] as Entry | undefined;
    const notes = typeof entry?.notes === 'string' ? entry.notes : '';
    const ingestOnly = entry?.status === 'ready' && INGEST_NOTE_RE.test(notes);
    const drop = !entry || DONE_STATUSES.includes(String(entry.status ?? '')) || ingestOnly;
    (drop ? dropped : order).push(n);
  }
  return { order, dropped, kept: [...order] };
}

/** Reads `<campaignDir>/queue.json`, migrates it, and with `apply` installs it through the guard. */
export function runQueueMigration(
  campaignDir: string,
  opts: { apply?: boolean; now?: string } = {},
): { changes: QueueChange[]; orderDropped: number[]; orderKept: number[]; applied: boolean } {
  const livePath = path.join(campaignDir, 'queue.json');
  const live = readJsonFile(livePath, livePath) as { issues?: Record<string, unknown>; [key: string]: unknown };
  if (typeof live.issues !== 'object' || live.issues === null) throw new Error(`${livePath} has no "issues" object`);
  const { issues, changes } = migrateQueueEntries(live.issues);
  const { order, dropped, kept } = migrateUserQueueOrder({ user_queue_order: live.user_queue_order, issues });
  const report = { changes, orderDropped: dropped, orderKept: kept };
  if (!opts.apply || (changes.length === 0 && dropped.length === 0)) return { ...report, applied: false };

  const result = installStateFile({
    livePath,
    archiveDir: path.join(campaignDir, 'archive'),
    content: `${JSON.stringify({ ...live, refreshed_at: opts.now ?? new Date().toISOString(), ...(Array.isArray(live.user_queue_order) ? { user_queue_order: order } : {}), issues }, null, 2)}\n`,
    entityKey: 'issues',
  });
  if (!result.ok) throw new Error(`state-write-guard refused the migrated queue: ${result.reason}`);
  return { ...report, applied: true };
}

/** Parses the CLI flags; an error string means print usage and exit 2. */
export function parseCliArgs(argv: string[], cwd: string = process.cwd()): { campaignDir: string; apply: boolean } | { error: string } {
  const flags = parseFlags(argv);
  const unknown = unknownFlagKeys(flags, ['campaign-dir', 'apply']);
  if (unknown.length) return { error: `Unknown flag(s): ${unknown.join(', ')}` };
  const dir = flags['campaign-dir'];
  if (dir === true) return { error: '--campaign-dir needs a value' };
  if (flags.apply !== undefined && flags.apply !== true) return { error: '--apply takes no value' };
  return { campaignDir: path.resolve(cwd, dir ?? '.blackhole'), apply: flags.apply === true };
}

if (import.meta.main) {
  const args = parseCliArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(`${args.error}\n${USAGE}`);
    process.exit(2);
  }
  const { campaignDir } = args;
  try {
    const { changes, orderDropped, orderKept, applied } = runQueueMigration(campaignDir, { apply: args.apply });
    for (const c of changes) console.log(`#${c.issue} ${c.field}: ${c.from} -> ${c.to}`);
    for (const n of orderDropped) console.log(`dropped from user_queue_order: #${n}`);
    for (const n of orderKept) console.log(`kept pin: #${n}`);
    const issues = new Set(changes.map((c) => c.issue)).size;
    if (changes.length === 0 && orderDropped.length === 0) console.log('queue-migrate: no legacy values or ingest-appended pins, nothing to do');
    else console.log(applied ? `queue-migrate: ${issues} entries migrated, ${orderDropped.length} dropped from user_queue_order` : `queue-migrate: ${issues} entries, ${orderDropped.length} user_queue_order entries would change (dry run; pass --apply to write)`);
  } catch (error) {
    console.error(`queue-migrate: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

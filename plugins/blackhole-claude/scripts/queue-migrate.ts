import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { QUEUE_PHASES, QUEUE_STATUSES } from './lib/campaign-status/queue.ts';
import { installStateFile } from './lib/state-write-guard.ts';

// One-shot migration of a consumer `queue.json` that still carries legacy `status`/`phase` values
// the state-write guard now refuses (`queue-dag.md` § Legacy values). Dry run by default; `--apply`
// snapshots the live file to `archive/` and installs through `installStateFile`, so the guard
// validates the result. Every entry is kept: a value with no documented mapping throws, naming the
// entry, rather than being guessed or dropped.

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

/** Reads `<campaignDir>/queue.json`, migrates it, and with `apply` installs it through the guard. */
export function runQueueMigration(
  campaignDir: string,
  opts: { apply?: boolean; now?: string } = {},
): { changes: QueueChange[]; applied: boolean } {
  const livePath = path.join(campaignDir, 'queue.json');
  const live = readJsonFile(livePath, livePath) as { issues?: Record<string, unknown>; [key: string]: unknown };
  if (typeof live.issues !== 'object' || live.issues === null) throw new Error(`${livePath} has no "issues" object`);
  const { issues, changes } = migrateQueueEntries(live.issues);
  if (!opts.apply || changes.length === 0) return { changes, applied: false };

  const result = installStateFile({
    livePath,
    archiveDir: path.join(campaignDir, 'archive'),
    content: `${JSON.stringify({ ...live, refreshed_at: opts.now ?? new Date().toISOString(), issues }, null, 2)}\n`,
    entityKey: 'issues',
  });
  if (!result.ok) throw new Error(`state-write-guard refused the migrated queue: ${result.reason}`);
  return { changes, applied: true };
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
    const { changes, applied } = runQueueMigration(campaignDir, { apply: args.apply });
    for (const c of changes) console.log(`#${c.issue} ${c.field}: ${c.from} -> ${c.to}`);
    const issues = new Set(changes.map((c) => c.issue)).size;
    if (changes.length === 0) console.log('queue-migrate: no legacy values, nothing to do');
    else console.log(applied ? `queue-migrate: ${issues} entries migrated` : `queue-migrate: ${issues} entries would change (dry run; pass --apply to write)`);
  } catch (error) {
    console.error(`queue-migrate: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

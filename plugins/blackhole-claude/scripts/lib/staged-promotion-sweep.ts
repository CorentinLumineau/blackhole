import { isCarryTargetAllowed } from './carry-target-allowlist.ts';
import { DONE_STATUSES } from './campaign-status/queue.ts';
import { appendConstraintBulletIfAbsent, appendPipeTableRowIfAbsent } from './carry-staged-artifacts.ts';
import { ROOT_DOC_INDEX_PATH } from './doc-index-generate.ts';

/**
 * Classification of one staged manifest entry. Ledger-worthy: `unpromoted_merged`,
 * `target_outside_allowlist`. Reported only: `legacy_manifest_shape`, `manifest_unreadable`,
 * `staged_path_missing`, `pending_open_issue`, `carried`.
 */
export type SweepState =
  | 'carried'
  | 'pending_open_issue'
  | 'unpromoted_merged'
  | 'target_outside_allowlist'
  | 'legacy_manifest_shape'
  | 'manifest_unreadable'
  | 'staged_path_missing';

/** One sweep result row; `entry_index` is -1 for a whole-manifest state. */
export type SweepRow = {
  issue: number;
  issue_status: string | null;
  entry_index: number;
  target_path: string | null;
  state: SweepState;
};

/** Inputs injected into `sweepStaged` so it stays pure. */
export type SweepInput = {
  /** `manifest` is the parsed JSON, or null when the file would not parse. */
  manifests: { issue: number; manifest: unknown }[];
  queue: Record<string, { status?: string }>;
  /** Whether `target_path` exists on the merged trunk ref. */
  targetExists: (targetPath: string) => boolean;
  stagedPathExists: (stagedPath: string) => boolean;
  /**
   * Content of `target_path` on the trunk ref, or null when unreadable. With `readStaged`, lets an
   * `append_row` entry count as carried only when its row is actually in the target.
   */
  readTarget?: (targetPath: string) => string | null;
  /** Content of the staged fragment, or null when it cannot be read. */
  readStaged?: (stagedPath: string) => string | null;
  packageRoot?: string;
};

/**
 * Whether the staged `append_row` fragment is already in the target, judged by the carry step's
 * own dedup (`appended === false`). Any throw (malformed fragment or index) means not carried.
 */
const rowIsCarried = (targetPath: string, target: string, fragment: string): boolean => {
  try {
    const result =
      targetPath === 'ARCHITECTURE.md'
        ? appendConstraintBulletIfAbsent(target, fragment)
        : appendPipeTableRowIfAbsent(target, fragment);
    return !result.appended;
  } catch {
    return false;
  }
};

const isMerged = (status: string | null): boolean => status !== null && DONE_STATUSES.includes(status);

/**
 * Post-merge counterpart of the pre-merge V-AUTO-02 audit: classifies every staged manifest
 * entry as carried, still pending, or silently unpromoted. Pure, advisory, and tolerant of the
 * legacy bare-array manifest that `loadManifest` refuses.
 */
export function sweepStaged(input: SweepInput): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const { issue, manifest } of input.manifests) {
    const status = input.queue[String(issue)]?.status ?? null;
    const row = (entry_index: number, target_path: string | null, state: SweepState): SweepRow => ({
      issue,
      issue_status: status,
      entry_index,
      target_path,
      state,
    });
    if (Array.isArray(manifest)) {
      rows.push(row(-1, null, 'legacy_manifest_shape'));
      continue;
    }
    const entries = (manifest as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(entries)) {
      rows.push(row(-1, null, 'manifest_unreadable'));
      continue;
    }
    entries.forEach((raw, index) => {
      const e = (raw ?? {}) as { target_path?: unknown; staged_path?: unknown; target_kind?: unknown };
      if (typeof e.target_path !== 'string' || typeof e.staged_path !== 'string') {
        rows.push(row(index, null, 'manifest_unreadable'));
      } else if (!isCarryTargetAllowed(e.target_path, input.packageRoot)) {
        rows.push(row(index, e.target_path, 'target_outside_allowlist'));
      } else if (input.targetExists(e.target_path)) {
        const verify =
          e.target_kind === 'append_row' && e.target_path !== ROOT_DOC_INDEX_PATH && input.readTarget && input.readStaged;
        if (!verify) {
          rows.push(row(index, e.target_path, 'carried'));
          return;
        }
        const fragment = input.readStaged!(e.staged_path)?.trim();
        const target = input.readTarget!(e.target_path);
        if (fragment === undefined || target === null) {
          rows.push(row(index, e.target_path, 'staged_path_missing'));
        } else if (rowIsCarried(e.target_path, target, fragment)) {
          rows.push(row(index, e.target_path, 'carried'));
        } else {
          rows.push(row(index, e.target_path, isMerged(status) ? 'unpromoted_merged' : 'pending_open_issue'));
        }
      } else if (!input.stagedPathExists(e.staged_path)) {
        rows.push(row(index, e.target_path, 'staged_path_missing'));
      } else {
        rows.push(row(index, e.target_path, isMerged(status) ? 'unpromoted_merged' : 'pending_open_issue'));
      }
    });
  }
  return rows;
}

import { DONE_STATUSES } from './queue.ts';
import type { BlockedClassKind, IssueRow, QueueIssue } from './types.ts';

// Shared by report.ts (the page and `--data`/`--json` feed) and dashboard.ts (the text view). It sits
// below both: report.ts imports dashboard.ts, so the classifier cannot live in either of them.

/** Blocked-Iteration escalation note (checkpoint-protocol.md § Blocked-Iteration Counter). */
const ESCALATED_PREFIX = 'blocked-escalated:';

export type WaitReason = { waitsOn: string; owner: boolean };

export function waitReason(issue: QueueIssue, issues: Record<string, QueueIssue>): WaitReason {
  const notes = (issue.notes ?? '').trim();
  const token = (notes.split(/\s/)[0] ?? '').replace(/:$/, '');
  if (token.startsWith('awaiting-')) return { waitsOn: token, owner: true };
  if (notes.startsWith(ESCALATED_PREFIX)) return { waitsOn: 'blocked-escalated', owner: true };
  if (notes.startsWith('merge-conflict-semantic')) return { waitsOn: 'merge-conflict', owner: false };
  if (/overlap with #\d+/.test(notes)) return { waitsOn: 'overlap', owner: false };
  const unmet = (issue.depends_on ?? []).some((d) => {
    const dep = issues[String(d)];
    return dep != null && !DONE_STATUSES.includes(dep.status ?? '');
  });
  return { waitsOn: unmet ? 'dependency' : 'other', owner: false };
}

// The campaign's own lanes: the contributor contract gives Claude and Blackhole `claude/*` / `blackhole/*`.
// No config key declares them, so they are fixed here. Any other `in-progress:*` / `agent:*` lane is foreign.
const OWN_LANES = new Set(['claude', 'blackhole']);
const LANE_LABEL = /^(?:in-progress|agent):(.+)$/;

function inForeignLane(issue: QueueIssue): boolean {
  return (issue.labels ?? []).some((label) => {
    const lane = LANE_LABEL.exec(label)?.[1];
    return lane != null && !OWN_LANES.has(lane);
  });
}

// Display order: the campaign's own waits first, another lane's last (not the campaign's work).
export const BLOCKED_CLASS_LABELS: [BlockedClassKind, string][] = [
  ['tracking_issue', 'Tracking issue'],
  ['dependency', 'Dependency / upstream'],
  ['merge_conflict', 'Merge conflict'],
  ['overlap', 'Overlapping issue'],
  ['sequenced_phase', 'Sequenced phase'],
  ['other', 'Other'],
  ['another_lane', 'Another lane'],
];

/** The one classifier for a blocked non-owner issue. First match wins: lane, tracking, sequence, dependency. */
export function classifyBlocked(issue: QueueIssue, issues: Record<string, QueueIssue>): BlockedClassKind {
  if (inForeignLane(issue)) return 'another_lane';
  const notes = issue.notes ?? '';
  if (/\btracking issue\b/i.test(notes)) return 'tracking_issue';
  if (/\bin sequence\b/i.test(notes)) return 'sequenced_phase';
  const waits = waitReason(issue, issues).waitsOn;
  if (waits === 'merge-conflict') return 'merge_conflict';
  if (waits === 'overlap') return 'overlap';
  if (waits === 'dependency' || /^(?:dependency|upstream)\b|\bupstream\b|\bdepends on\b/i.test(notes.trim())) {
    return 'dependency';
  }
  return 'other';
}

export type BlockedRowGroup = { kind: BlockedClassKind; label: string; rows: IssueRow[] };

/** Non-owner blocked rows grouped by reason class, in display order; empty classes are left out. */
export function groupBlockedRows(blocked: IssueRow[], issues: Record<string, QueueIssue>): BlockedRowGroup[] {
  const byKind = new Map<BlockedClassKind, IssueRow[]>();
  for (const row of blocked) {
    if (waitReason(row.issue, issues).owner) continue;
    const kind = classifyBlocked(row.issue, issues);
    byKind.set(kind, [...(byKind.get(kind) ?? []), row]);
  }
  return BLOCKED_CLASS_LABELS.filter(([kind]) => byKind.has(kind)).map(([kind, label]) => ({
    kind,
    label,
    rows: byKind.get(kind) ?? [],
  }));
}

/** How many issue numbers a class line names before "and N more". */
export const CLASS_PREVIEW = 3;

export function classPreview<T>(items: T[], count: number): { first: T[]; more: number } {
  return { first: items.slice(0, CLASS_PREVIEW), more: Math.max(0, count - CLASS_PREVIEW) };
}

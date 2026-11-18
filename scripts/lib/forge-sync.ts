import { parseDependsFromBody, parseEpicParentFromBody } from '../forge-deps.ts';
import { issueMatchesScope, type CampaignScope } from '../forge-scope.ts';
import type { ForgeIssue, ForgePr } from './forge-adapter/types.ts';
import { foreignLaneLabel, isOwnLaneBranch } from './campaign-status/blocked-classes.ts';
import { closedIssues } from './campaign-status/merged.ts';
import { latestClosingPrActivity } from './forge-adapter/claim.ts';
import { DEFAULT_CLAIM_LEASE_HOURS, isClaimStale, LANE_LABEL_PREFIX, laneOfLabel } from './lane.ts';
import { DONE_STATUSES } from './campaign-status/queue.ts';
import type { QueueIssue, QueueJson } from './campaign-status/types.ts';

// `forge-sync.md` § Sync protocol steps 4, 5, 6 and 7 as one pure function: the queue as the forge
// has it. `scripts/forge-sync.ts` reads the forge and writes the result through the state write
// guard. Entries are never removed; an entry the forge did not list is kept unchanged.

/** A queue entry as the sync writes it: the fields `QueueIssue` reads plus the ingest-only ones. */
export type SyncedEntry = QueueIssue & Record<string, unknown>;

export type SyncInput = {
  /** The current `queue.json`; null on a fresh checkout. Not mutated. */
  queue: (QueueJson & { user_queue_order?: number[] }) | null;
  /** Open and closed issues; `state` tells them apart. */
  issues: ForgeIssue[];
  /** Open and merged PRs. */
  prs: ForgePr[];
  scope: CampaignScope;
  config: { default_touch_paths?: string[]; size_label_prefix?: string };
  now: string;
  /** The account's lane (ADR-054 C4). Absent or null: the legacy `claude`/`blackhole` ownership. */
  lane?: string | null;
  /** Hours without issue or PR activity before another lane's `in-progress:*` claim is stale; used with a lane. */
  claimLeaseHours?: number;
};

export type SyncResult = {
  queue: QueueJson & { issues: Record<string, SyncedEntry>; user_queue_order: number[] };
  added: number[];
  closed: number[];
  linked: number[];
};

/** The notes this sync writes on a ready entry held elsewhere; only these exact notes are cleared again. */
export const ANOTHER_LANE = 'another lane:';
export const OPEN_PR = 'open PR:';
const LANE_NOTE = /^(?:another lane|open PR): \S+$/;
/** A campaign branch names its issue: `claude/issue-N…` or `blackhole/issue-N…`. */
const BRANCH_ISSUE_RE = /^(?:claude|blackhole)\/issue-(\d+)(?:\D|$)/;
/** Dependency bots: their PR is an open PR, not another agent lane. */
const BOT_BRANCH = /^(?:renovate|dependabot)\//;

const isLaneNote = (notes: string | null | undefined): boolean => LANE_NOTE.test(notes ?? '');

function forgeFields(i: ForgeIssue, sizePrefix: string) {
  const labels = i.labels.map((l) => l.name);
  const size = labels.find((l) => l.startsWith(sizePrefix))?.slice(sizePrefix.length) ?? null;
  return { title: i.title, labels, milestone: i.milestone?.title ?? null, size, epic_parent: parseEpicParentFromBody(i.body ?? '') };
}

/** How an issue's labels settle who owns a PR closing it; only consulted when a lane is configured. */
type LaneLabels = (issue: number) => readonly string[];

/**
 * Open PRs per issue. With a lane, the issue's lane label decides: the own lane label makes the PR
 * the campaign's own, another lane's label makes it foreign, and only an issue with no lane label
 * falls back to the branch prefix (ADR-054 C4). Without a lane the prefix always decides. Own PRs:
 * closing keyword first, then an `…/issue-N` branch, then lowest number. A foreign PR holds the
 * issue elsewhere, with the note to write.
 */
function openPrIndex(prs: ForgePr[], lane: string | null, labelsOf: LaneLabels): { own: Map<number, ForgePr>; foreign: Map<number, string> } {
  const own = new Map<number, ForgePr>();
  const foreign = new Map<number, string>();
  const open = prs.filter((p) => p.state === 'OPEN').sort((a, b) => a.number - b.number);
  const isOwn = (n: number, branch: string): boolean => {
    if (lane === null) return isOwnLaneBranch(branch);
    const lanes = labelsOf(n).map(laneOfLabel).filter((l): l is string => l !== null);
    if (lanes.length === 0) return isOwnLaneBranch(branch);
    return lanes.includes(lane);
  };
  for (const byKeyword of [true, false]) {
    for (const p of open) {
      const branch = p.headRefName ?? '';
      const named = BRANCH_ISSUE_RE.exec(branch);
      const targets = byKeyword ? closedIssues(p.body ?? '') : named ? [Number(named[1])] : [];
      for (const n of targets) {
        if (!isOwn(n, branch)) {
          if (!foreign.has(n)) foreign.set(n, `${BOT_BRANCH.test(branch) ? OPEN_PR : ANOTHER_LANE} ${branch}`);
        } else if (!own.has(n)) own.set(n, p);
      }
    }
  }
  return { own, foreign };
}

/** Merged PRs per issue, by closing keyword only: a `Part of #N` or branch match never closes an issue. */
function mergedPrIndex(prs: ForgePr[]): Map<number, ForgePr> {
  const merged = new Map<number, ForgePr>();
  for (const p of prs.filter((x) => x.state === 'MERGED').sort((a, b) => a.number - b.number)) {
    for (const n of closedIssues(p.body ?? '')) if (!merged.has(n)) merged.set(n, p);
  }
  return merged;
}

function ingest(i: ForgeIssue, input: SyncInput, sizePrefix: string): SyncedEntry {
  const f = forgeFields(i, sizePrefix);
  return {
    title: f.title,
    phase: 'handle',
    status: 'ready',
    depends_on: parseDependsFromBody(i.body ?? ''),
    blocks: [],
    worktree: null,
    pr: null,
    migration_slot: false,
    touch_paths: [...(input.config.default_touch_paths ?? [])],
    size: f.size,
    labels: f.labels,
    milestone: f.milestone,
    epic_parent: f.epic_parent,
    notes: 'auto-sync ingest',
  };
}

function reconcile(entry: SyncedEntry, i: ForgeIssue, sizePrefix: string): SyncedEntry {
  const f = forgeFields(i, sizePrefix);
  const deps = [...new Set([...(entry.depends_on ?? []), ...parseDependsFromBody(i.body ?? '')])];
  return { ...entry, title: f.title, labels: f.labels, milestone: f.milestone, size: f.size ?? entry.size ?? null, depends_on: deps, ...(f.epic_parent !== null ? { epic_parent: f.epic_parent } : {}) };
}

/**
 * Held elsewhere: a `ready` entry turns blocked with the lane note; a note this sync wrote follows
 * the lane, and goes back to ready once it is gone. Any other note (an owner gate, a trunk fix, an
 * overlap) is never touched, and in-flight work is never taken over.
 */
function applyLane(entry: SyncedEntry, note: string | null): SyncedEntry {
  const ours = entry.status === 'blocked' && isLaneNote(entry.notes);
  if (note) return entry.status === 'ready' || ours ? { ...entry, status: 'blocked', notes: note } : entry;
  return ours ? { ...entry, status: 'ready', notes: null } : entry;
}

export function syncQueue(input: SyncInput): SyncResult {
  const sizePrefix = input.config.size_label_prefix ?? 'size:';
  const issues: Record<string, SyncedEntry> = {};
  for (const [n, e] of Object.entries(input.queue?.issues ?? {})) issues[n] = { ...(e as SyncedEntry) };
  const added: number[] = [];
  const closed: number[] = [];
  const linked: number[] = [];
  const forgeState = new Map<string, ForgeIssue['state']>();

  for (const i of [...input.issues].sort((a, b) => a.number - b.number)) {
    const key = String(i.number);
    forgeState.set(key, i.state);
    if (issues[key]) issues[key] = reconcile(issues[key], i, sizePrefix);
    else if (i.state === 'OPEN' && issueMatchesScope(i, input.scope)) {
      issues[key] = ingest(i, input, sizePrefix);
      added.push(i.number);
    }
  }

  const merged = mergedPrIndex(input.prs);
  const lane = input.lane ?? null;
  const updatedAt = new Map(input.issues.map((i) => [String(i.number), i.updatedAt] as const));
  const nowMs = Date.parse(input.now);
  // Lease staleness is decided once, before the PR index, so an expired claim stops deciding
  // ownership there too: its PRs are inactive by definition (their activity feeds the lease).
  const stale = new Set<string>();
  if (lane !== null) {
    for (const key of Object.keys(issues)) {
      if (isClaimStale({ updatedAt: updatedAt.get(key), activityAt: latestClosingPrActivity(input.prs, Number(key)), now: nowMs, leaseHours: input.claimLeaseHours ?? DEFAULT_CLAIM_LEASE_HOURS })) stale.add(key);
    }
  }
  // A stale lease frees the issue from `in-progress:*` claims only; `agent:*` never leases.
  const liveLabels = (key: string): string[] => {
    const labels = issues[key]?.labels ?? [];
    return stale.has(key) ? labels.filter((l) => !l.startsWith(LANE_LABEL_PREFIX)) : labels;
  };
  const open = openPrIndex(input.prs, lane, (n) => liveLabels(String(n)));
  for (const [key, entry] of Object.entries(issues)) {
    if (DONE_STATUSES.includes(entry.status ?? '')) continue;
    const n = Number(key);
    const state = forgeState.get(key);
    const mergedPr = state === 'OPEN' ? undefined : merged.get(n);
    if (mergedPr || state === 'CLOSED') {
      issues[key] = { ...entry, status: mergedPr ? 'merged' : 'closed', phase: 'done', pr: mergedPr?.number ?? entry.pr ?? null };
      closed.push(n);
      continue;
    }
    const isStale = stale.has(key);
    const label = state ? foreignLaneLabel(liveLabels(key), lane) : null;
    const prHold = isStale ? null : (open.foreign.get(n) ?? null);
    let next = state ? applyLane(entry, label ? `${ANOTHER_LANE} ${label}` : prHold) : entry;
    const ownPr = open.own.get(n);
    if (ownPr && next.pr !== ownPr.number && !isLaneNote(next.notes)) {
      next = { ...next, pr: ownPr.number, phase: next.phase === 'implement' ? 'review' : next.phase };
      linked.push(n);
    }
    issues[key] = next;
  }

  const order = [...(input.queue?.user_queue_order ?? [])];
  for (const n of added) if (!order.includes(n)) order.push(n);
  return {
    queue: { ...(input.queue ?? {}), refreshed_at: input.now, campaign_started_at: input.queue?.campaign_started_at ?? input.now, user_queue_order: order, issues },
    added,
    closed: closed.sort((a, b) => a - b),
    linked: linked.sort((a, b) => a - b),
  };
}

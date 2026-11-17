import { parseDependsFromBody } from '../forge-deps.ts';
import { issueMatchesScope, type CampaignScope } from '../forge-scope.ts';
import type { ForgeIssue, ForgePr } from './forge-adapter/types.ts';
import { closedIssues } from './campaign-status/merged.ts';
import { DONE_STATUSES } from './campaign-status/queue.ts';
import type { QueueIssue, QueueJson } from './campaign-status/types.ts';

// `forge-sync.md` § Sync protocol steps 4, 5, 6 and 7 as one pure function: the queue as the forge
// has it. `scripts/forge-sync.ts` reads the forge and writes the result through the state write
// guard. Entries are never removed; an entry the forge did not list is kept unchanged.

/** A queue entry as the sync writes it: the fields `QueueIssue` reads plus the ingest-only ones. */
export type SyncedEntry = QueueIssue & Record<string, unknown>;

export type SyncInput = {
  /** The current `queue.json`; null on a fresh checkout. Not mutated. */
  queue: QueueJson | null;
  /** Open and closed issues; `state` tells them apart. */
  issues: ForgeIssue[];
  /** Open and merged PRs. */
  prs: ForgePr[];
  scope: CampaignScope;
  config: { default_touch_paths?: string[]; size_label_prefix?: string };
  now: string;
};

export type SyncResult = {
  queue: QueueJson & { issues: Record<string, SyncedEntry> };
  added: number[];
  closed: number[];
  linked: number[];
};

const EPIC_RE = /^\s*part of\s+#(\d+)\s*$/im;
const BRANCH_ISSUE_RE = /(?:^|\/)issue-(\d+)(?:\D|$)/;

/** The issue each PR names: its closing keywords, else a `…/issue-N…` branch. */
function prIssues(p: ForgePr): number[] {
  const closes = closedIssues(p.body ?? '');
  if (closes.length) return closes;
  const branch = BRANCH_ISSUE_RE.exec(p.headRefName ?? '');
  return branch ? [Number(branch[1])] : [];
}

function forgeFields(i: ForgeIssue, sizePrefix: string) {
  const labels = i.labels.map((l) => l.name);
  const size = labels.find((l) => l.startsWith(sizePrefix))?.slice(sizePrefix.length) ?? null;
  const epic = EPIC_RE.exec(i.body ?? '');
  return { title: i.title, labels, milestone: i.milestone?.title ?? null, size, epic_parent: epic ? Number(epic[1]) : null };
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

export function syncQueue(input: SyncInput): SyncResult {
  const sizePrefix = input.config.size_label_prefix ?? 'size:';
  const issues: Record<string, SyncedEntry> = {};
  for (const [n, e] of Object.entries(input.queue?.issues ?? {})) issues[n] = { ...(e as SyncedEntry) };
  const added: number[] = [];
  const closed: number[] = [];
  const linked: number[] = [];

  for (const i of [...input.issues].sort((a, b) => a.number - b.number)) {
    const key = String(i.number);
    if (issues[key]) issues[key] = reconcile(issues[key], i, sizePrefix);
    else if (i.state === 'OPEN' && issueMatchesScope(i, input.scope)) {
      issues[key] = ingest(i, input, sizePrefix);
      added.push(i.number);
    }
  }

  const mergedFor = new Map<number, ForgePr>();
  const openFor = new Map<number, ForgePr>();
  for (const p of [...input.prs].sort((a, b) => a.number - b.number)) {
    const target = p.state === 'MERGED' ? mergedFor : p.state === 'OPEN' ? openFor : null;
    for (const n of target ? prIssues(p) : []) if (!target!.has(n)) target!.set(n, p);
  }

  const state = new Map(input.issues.map((i) => [String(i.number), i.state]));
  for (const [key, entry] of Object.entries(issues)) {
    if (DONE_STATUSES.includes(entry.status ?? '')) continue;
    const n = Number(key);
    const merged = mergedFor.get(n);
    if (merged || state.get(key) === 'CLOSED') {
      issues[key] = { ...entry, status: merged ? 'merged' : 'closed', phase: 'done', pr: merged?.number ?? entry.pr ?? null };
      closed.push(n);
      continue;
    }
    const open = openFor.get(n);
    if (open && entry.pr !== open.number) {
      issues[key] = { ...entry, pr: open.number, phase: entry.phase === 'implement' ? 'review' : entry.phase };
      linked.push(n);
    }
  }

  return {
    queue: { ...(input.queue ?? {}), refreshed_at: input.now, campaign_started_at: input.queue?.campaign_started_at ?? input.now, issues },
    added,
    closed: closed.sort((a, b) => a - b),
    linked: linked.sort((a, b) => a - b),
  };
}

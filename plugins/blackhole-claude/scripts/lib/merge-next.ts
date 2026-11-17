import { effectiveParent } from './stack-overlap.ts';
import { isOpenPr, type StackCandidate } from './stack-parent.ts';

// The owner's "Merge next" list (status-page.md § Merge next): every open PR in the order to
// merge it, CI-fix PRs first, then parents, then children, each with the thing it waits on named.
// Edges are stack edges (`effectiveParent`), `depends_on` issues that have an open PR, and the
// trunk-red base fix a `waiting-on-trunk-fix #N` note names (queue-dag.md § Trunk-red).

export type MergeNextCandidate = StackCandidate & { depends_on?: number[]; notes?: string | null };

export type MergeNextItem = {
  issue: number;
  pr: number;
  /** `ci-fix` is in the CI-fix list; `child` waits on another open PR; `parent` waits on none. */
  kind: 'ci-fix' | 'parent' | 'child';
  /** What stops this PR merging now, in words; `none` when nothing does. */
  blocker: string;
};

/** `cycles` lists each set of open PRs whose edges loop (ascending); they are left out of `items`. */
export type MergeNextOrder = { items: MergeNextItem[]; cycles: number[][] };

const CLOSED = new Set(['merged', 'closed']);

type Edge = { from: number; why: 'stacked on' | 'depends on' | 'trunk fix' };

const TRUNK_FIX_NOTE = /waiting-on-trunk-fix #(\d+)/;

/** The base-fix issue a `waiting-on-trunk-fix #N` note names; null without one. */
const trunkFixOf = (issue: MergeNextCandidate): number | null => {
  const m = TRUNK_FIX_NOTE.exec(issue.notes ?? '');
  return m ? Number(m[1]) : null;
};

/**
 * The trunk-red base-fix issues, ascending: each one a parked PR's `waiting-on-trunk-fix #N`
 * note names. The notes are set from `classifyTrunkRed` (`scripts/trunk-red.ts`), so this reads
 * that verdict from the queue rather than classifying again. Pass it to `mergeNextOrder`.
 */
export const trunkFixIssues = (issues: Record<string, MergeNextCandidate>): number[] =>
  [...new Set(Object.values(issues).map(trunkFixOf).filter((n): n is number => n != null))].sort((a, b) => a - b);

/** Open-PR predecessors of `n`, stack parent first, each once. */
const upstream = (issues: Record<string, MergeNextCandidate>, n: number, open: Set<number>): Edge[] => {
  const me = issues[String(n)]!;
  const out: Edge[] = [];
  const parent = effectiveParent(issues, me);
  if (parent != null && open.has(parent)) out.push({ from: parent, why: 'stacked on' });
  for (const d of me.depends_on ?? []) {
    if (open.has(d) && !out.some((e) => e.from === d)) out.push({ from: d, why: 'depends on' });
  }
  const fix = trunkFixOf(me);
  if (fix != null && fix !== n && open.has(fix) && !out.some((e) => e.from === fix)) out.push({ from: fix, why: 'trunk fix' });
  return out;
};

/** Every node `start` waits on, directly or through others; a node on a loop reaches itself. */
const ancestors = (preds: Map<number, Edge[]>, start: number): Set<number> => {
  const seen = new Set<number>();
  const stack = (preds.get(start) ?? []).map((e) => e.from);
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const e of preds.get(n) ?? []) stack.push(e.from);
  }
  return seen;
};

/** Ascending sets of nodes that can reach themselves; small graphs, so plain reachability. */
const findCycles = (nodes: number[], preds: Map<number, Edge[]>): number[][] => {
  const reaches = new Map(nodes.map((n) => [n, ancestors(preds, n)]));
  const done = new Set<number>();
  const cycles: number[][] = [];
  for (const n of [...nodes].sort((a, b) => a - b)) {
    if (done.has(n) || !reaches.get(n)!.has(n)) continue;
    const scc = nodes.filter((m) => m === n || (reaches.get(n)!.has(m) && reaches.get(m)!.has(n))).sort((a, b) => a - b);
    for (const m of scc) done.add(m);
    cycles.push(scc);
  }
  return cycles;
};

/**
 * Kahn's order over `nodes`, ignoring edges from `skip`: among ready nodes a CI fix goes first,
 * then the shallower node, then the lower issue number. Returns the ordered nodes; nodes on or
 * behind a loop never become ready and are left out.
 */
const kahn = (nodes: number[], preds: Map<number, Edge[]>, ciFix: Set<number>, skip: Set<number>): number[] => {
  const live = new Set(nodes);
  const pending = new Map(nodes.map((n) => [n, (preds.get(n) ?? []).filter((e) => live.has(e.from) && !skip.has(e.from)).length]));
  const level = new Map<number, number>();
  const ready = nodes.filter((n) => pending.get(n) === 0);
  for (const n of ready) level.set(n, 0);
  const order: number[] = [];
  const rank = (n: number) => [ciFix.has(n) ? 0 : 1, level.get(n)!, n];
  while (ready.length) {
    ready.sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
    });
    const n = ready.shift()!;
    order.push(n);
    for (const m of nodes) {
      if (!(preds.get(m) ?? []).some((e) => e.from === n)) continue;
      level.set(m, Math.max(level.get(m) ?? 0, level.get(n)! + 1));
      const left = pending.get(m)! - 1;
      pending.set(m, left);
      if (left === 0) ready.push(m);
    }
  }
  return order;
};

const blockerOf = (
  issues: Record<string, MergeNextCandidate>,
  n: number,
  edges: Edge[],
  ciFix: number[],
  preds: Map<number, Edge[]>,
): string => {
  const me = issues[String(n)]!;
  const parts: string[] = [];
  // While the base fix is open, its edge names the wait; the parking note would only repeat it.
  const parkedOnOpenFix = edges.some((e) => e.why === 'trunk fix') && me.notes?.trim() === `waiting-on-trunk-fix #${trunkFixOf(me)}`;
  if (me.status === 'blocked' && !parkedOnOpenFix) parts.push(`blocked: ${me.notes ?? 'no reason recorded'}`);
  for (const e of edges) parts.push(`waits on #${e.from} (${e.why})`);
  for (const d of me.depends_on ?? []) {
    if (edges.some((e) => e.from === d)) continue;
    const dep = issues[String(d)];
    if (dep === undefined) parts.push(`waits on #${d} (depends on, not in queue)`);
    else if (!CLOSED.has(dep.status ?? '') && dep.pr == null) parts.push(`waits on #${d} (depends on, no PR yet)`);
  }
  if (parts.length) return parts.join('; ');
  if (ciFix.includes(n)) return 'none — CI fix, merge first';
  // A CI fix stacked on `n` cannot merge before it, so it is not named as `n`'s blocker.
  const ahead = ciFix.filter((c) => !ancestors(preds, c).has(n));
  return ahead.length ? `after CI fix ${ahead.map((c) => `#${c}`).join(', ')}` : 'none';
};

/**
 * Every open PR of the queue in merge order. `ciFixIssues` names the issues whose PR fixes a red
 * check every other PR fails on (the trunk-red base fix); those merge first. A loop of stack or
 * dependency edges is reported in `cycles`, never walked.
 */
export const mergeNextOrder = (issues: Record<string, MergeNextCandidate>, ciFixIssues: number[]): MergeNextOrder => {
  const nodes = Object.keys(issues)
    .map(Number)
    .filter((n) => isOpenPr(issues[String(n)]))
    .sort((a, b) => a - b);
  const open = new Set(nodes);
  const ciFix = new Set(ciFixIssues.filter((n) => open.has(n)));
  const ciFixOpen = [...ciFix].sort((a, b) => a - b);
  const preds = new Map(nodes.map((n) => [n, upstream(issues, n, open)]));
  const first = kahn(nodes, preds, ciFix, new Set());
  const placed = new Set(first);
  const leftover = nodes.filter((n) => !placed.has(n));
  const cycles = findCycles(leftover, preds);
  const onCycle = new Set(cycles.flat());
  const behind = kahn(leftover.filter((n) => !onCycle.has(n)), preds, ciFix, onCycle);
  const items = [...first, ...behind].map((n): MergeNextItem => {
    const edges = preds.get(n)!;
    return {
      issue: n,
      pr: issues[String(n)]!.pr as number,
      kind: ciFix.has(n) ? 'ci-fix' : edges.length ? 'child' : 'parent',
      blocker: blockerOf(issues, n, edges, ciFixOpen, preds),
    };
  });
  return { items, cycles };
};

/** `#2 (PR #12) — waits on #1 (stacked on)`. */
export const formatMergeNextItem = (item: MergeNextItem): string => `#${item.issue} (PR #${item.pr}) — ${item.blocker}`;

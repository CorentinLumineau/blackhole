import type { GitResult, OpenPrSnapshot, SnapshotPr } from './open-pr-snapshot.ts';

// Stack-parent selection over the forge's PR graph (ADR-051). Pure: the snapshot and the
// merge-tree decider are inputs. A shared changed file is only a prefilter; two PRs are stacked
// only when `git merge-tree` of their heads reports a real conflict (owner decision D1).

/** Longest stack the campaign builds. A constant, not a config key: a key is the start of an opt-out. */
export const STACK_DEPTH_CAP = 4;

export type ConflictVerdict = 'conflict' | 'clean' | 'unknown';

// ---- graph helpers over a parent-edge function, shared with the queue-based dispatch pick ----

export type StackGraph = {
  nodes(): Iterable<number>;
  has(node: number): boolean;
  /** The node this one is based on, or null/undefined for a root. */
  parentOf(node: number): number | null | undefined;
};

/** True when walking parent edges from `from` reaches `target`; a loop in the data ends the walk. */
export const reachesNode = (graph: StackGraph, from: number, target: number): boolean => {
  const seen = new Set<number>();
  for (let cur: number | null | undefined = from; cur != null && !seen.has(cur); cur = graph.parentOf(cur)) {
    if (cur === target) return true;
    seen.add(cur);
  }
  return false;
};

/** Depth of `node` in its chain: a root is 1. A loop in the data stops counting where it repeats. */
export const chainDepth = (graph: StackGraph, node: number): number => {
  const seen = new Set<number>();
  let depth = 0;
  for (let cur: number | null | undefined = node; cur != null && !seen.has(cur) && graph.has(cur); cur = graph.parentOf(cur)) {
    seen.add(cur);
    depth++;
  }
  return depth;
};

/**
 * Deepest descendant of `root` outside `exclude`, following child edges downward; the lowest number
 * breaks ties. With `prefer`, the walk first descends toward the preferred nodes (lowest-numbered
 * child that is, or leads to, one) and only then extends to the deepest tip below where it stopped,
 * so the result lies inside the branch holding them instead of in an unrelated sibling branch.
 */
export const chainTip = (
  graph: StackGraph,
  root: number,
  exclude: ReadonlySet<number> = new Set(),
  prefer: ReadonlySet<number> = new Set(),
): number => {
  const all = [...graph.nodes()];
  const childrenOf = (n: number, seen: ReadonlySet<number>): number[] =>
    all.filter((c) => graph.parentOf(c) === n && !seen.has(c) && !exclude.has(c)).sort((x, y) => x - y);

  const visited = new Set<number>([root]);
  let start = root;
  for (;;) {
    const next = childrenOf(start, visited).find((c) => [...prefer].some((p) => reachesNode(graph, p, c)));
    if (next === undefined) break;
    visited.add(next);
    start = next;
  }

  const deepest = (node: number, seen: ReadonlySet<number>): { tip: number; depth: number } => {
    let best = { tip: node, depth: 0 };
    for (const c of childrenOf(node, seen)) {
      const sub = deepest(c, new Set([...seen, c]));
      if (sub.depth + 1 > best.depth) best = { tip: sub.tip, depth: sub.depth + 1 };
    }
    return best;
  };
  return deepest(start, visited).tip;
};

// ---- merge-tree decider ----

/**
 * `git merge-tree --write-tree` of two revisions. Exit 0 merges clean. Exit 1 means conflicts only
 * when stdout opens with the result tree id: git also exits 1 for a revision it cannot resolve, and
 * an old git without `--write-tree` fails another way. Neither of those is ever read as clean.
 */
export const mergeTreeVerdict = (git: (args: string[]) => GitResult, a: string, b: string): ConflictVerdict => {
  const r = git(['merge-tree', '--write-tree', '--no-messages', a, b]);
  if (r.code === 0) return 'clean';
  if (r.code === 1 && /^[0-9a-f]{40,64}$/.test(r.stdout.split('\n')[0].trim())) return 'conflict';
  return 'unknown';
};

// ---- PR-graph pick ----

export type PickParentOptions = {
  /** Decides whether two PRs with a shared file would conflict. Called only for file-overlapping pairs. */
  conflicts: (me: SnapshotPr, other: SnapshotPr) => ConflictVerdict;
  maxDepth?: number;
};

export type PickParentResult =
  | { kind: 'none' }
  | { kind: 'stack'; parent: number; parentBranch: string; alsoOverlaps: number[]; depth: number }
  | { kind: 'defer'; reason: 'depth'; parent: number }
  | { kind: 'unstackable'; reason: 'fork'; parent: number }
  | { kind: 'unknown'; reason: string };

const shares = (a: string[], b: string[]): boolean => {
  const set = new Set(a);
  return b.some((f) => set.has(f));
};

/**
 * The parent PR `meNumber` must be stacked on, or why none is chosen. Edges come from each PR's
 * base branch; the parent is the tip of the branch holding the overlapping PRs of the lowest-numbered root, and any other
 * overlapping chain is reported in `alsoOverlaps`. A PR that is already an ancestor of `me`, or a
 * descendant of it, is not an overlap to act on.
 */
export const pickParent = (meNumber: number, snapshot: OpenPrSnapshot, opts: PickParentOptions): PickParentResult => {
  if (snapshot.status !== 'ok') return { kind: 'unknown', reason: snapshot.reason };
  const byNumber = new Map(snapshot.prs.map((p) => [p.number, p]));
  const me = byNumber.get(meNumber);
  if (!me) return { kind: 'unknown', reason: `PR #${meNumber} is not in the open-PR snapshot` };
  if (me.files === null) return { kind: 'unknown', reason: `files of PR #${meNumber} could not be read` };

  const byHeadBranch = new Map(snapshot.prs.filter((p) => !p.isFork).map((p) => [p.headRefName, p]));
  const graph: StackGraph = {
    nodes: () => byNumber.keys(),
    has: (n) => byNumber.has(n),
    parentOf: (n) => {
      const p = byNumber.get(n);
      return p ? byHeadBranch.get(p.baseRefName)?.number : undefined;
    },
  };
  const everyNode = snapshot.prs.map((p) => p.number);

  const overlapping: SnapshotPr[] = [];
  let unreadable = false;
  let undecided = false;
  for (const other of snapshot.prs) {
    if (other.number === meNumber) continue;
    if (reachesNode(graph, other.number, meNumber) || reachesNode(graph, meNumber, other.number)) continue;
    if (other.files === null) {
      unreadable = true;
      continue;
    }
    if (!shares(me.files, other.files)) continue;
    const verdict = opts.conflicts(me, other);
    if (verdict === 'conflict') overlapping.push(other);
    else if (verdict === 'unknown') undecided = true;
  }

  const rootOf = (n: number): number | null => {
    const seen = new Set<number>();
    let cur = n;
    for (;;) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      const up = graph.parentOf(cur);
      if (up == null) return cur;
      cur = up;
    }
  };

  const roots = new Map<number, SnapshotPr[]>();
  for (const o of overlapping) {
    const root = rootOf(o.number);
    if (root === null) return { kind: 'unknown', reason: `PR #${o.number} sits in a base-branch cycle` };
    roots.set(root, [...(roots.get(root) ?? []), o]);
  }
  const chosenRoot = [...roots.keys()].sort((a, b) => a - b)[0];

  if (chosenRoot === undefined) {
    if (undecided) return { kind: 'unknown', reason: 'merge-tree could not decide a file overlap' };
    if (unreadable) return { kind: 'unknown', reason: 'files of an open PR could not be read' };
    return { kind: 'none' };
  }

  // The tip may not be me or anything stacked on me: those are on my side of the graph.
  const mine = new Set(everyNode.filter((n) => n === meNumber || reachesNode(graph, n, meNumber)));
  const tip = chainTip(graph, chosenRoot, mine, new Set(roots.get(chosenRoot)!.map((o) => o.number)));
  const tipPr = byNumber.get(tip)!;
  const alsoOverlaps = [...roots.entries()]
    .filter(([root]) => root !== chosenRoot)
    .flatMap(([, prs]) => prs.map((p) => p.number))
    .sort((a, b) => a - b);

  if (tipPr.isFork) return { kind: 'unstackable', reason: 'fork', parent: tip };
  const depth = chainDepth(graph, tip) + 1;
  if (depth > (opts.maxDepth ?? STACK_DEPTH_CAP)) return { kind: 'defer', reason: 'depth', parent: tip };
  return { kind: 'stack', parent: tip, parentBranch: tipPr.headRefName, alsoOverlaps, depth };
};

import { childBranchFor } from '../stack-repair.ts';

// Dispatch-time stack-parent selection (queue-dag.md § Step 3b). A ready issue whose touch_paths
// overlap an issue that already has an open, unmerged PR is cut from that PR's branch instead of
// the target branch, so overlapping work forms a chain rather than independent siblings.

export type StackCandidate = {
  status?: string;
  pr?: number | null;
  touch_paths?: string[];
  stacked_on?: number | null;
};

export type StackParentPick = {
  parent: number;
  parentBranch: string;
  parentPr: number;
  /** Pre-merge PR bodies use `Part of #N`; the retarget to the target branch switches to `Closes #N`. */
  issueLinkKeyword: 'Part of';
};

const CLOSED_STATUSES = new Set(['merged', 'closed']);

const staticPrefix = (glob: string): string => {
  const cut = glob.search(/[*?[{]/);
  return (cut === -1 ? glob : glob.slice(0, cut)).replace(/\/+$/, '');
};

/** Conservative overlap of two glob lists: one literal prefix contains the other. Root-only prefixes never match. */
export const touchPathsOverlap = (a: string[], b: string[]): boolean =>
  a.some((ga) =>
    b.some((gb) => {
      const pa = staticPrefix(ga);
      const pb = staticPrefix(gb);
      if (pa === '' || pb === '') return false;
      return pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
    }),
  );

export type StackParentOptions = {
  /** Config `default_touch_paths`: a list equal to this is the unnarrowed default, i.e. unknown. */
  defaultTouchPaths?: string[];
  /** Parent issue -> files its open PR actually changes; preferred over the parent's declared globs. */
  parentFiles?: Record<string, string[]>;
};

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((g) => b.includes(g));

/** Narrowed paths only: the default list and root-only/empty-prefix globs say nothing about overlap. */
const knownPaths = (paths: string[] | undefined, defaults: string[] | undefined): string[] =>
  !paths?.length || (defaults?.length && sameList(paths, defaults))
    ? []
    : paths.filter((g) => staticPrefix(g) !== '');

const reachesIssue = (issues: Record<string, StackCandidate>, from: number, target: number): boolean => {
  const seen = new Set<number>();
  for (let cur: number | null | undefined = from; cur != null && !seen.has(cur); cur = issues[String(cur)]?.stacked_on) {
    if (cur === target) return true;
    seen.add(cur);
  }
  return false;
};

/** Deepest open descendant of `root` (follows `stacked_on` edges downward; lowest number breaks ties). */
const chainTip = (issues: Record<string, StackCandidate>, root: number): number => {
  const visited = new Set<number>([root]);
  let tip = root;
  for (;;) {
    const child = Object.entries(issues)
      .map(([k, v]) => ({ n: Number(k), v }))
      .filter(({ n, v }) => v.stacked_on === tip && v.pr != null && !CLOSED_STATUSES.has(v.status ?? '') && !visited.has(n))
      .sort((x, y) => x.n - y.n)[0];
    if (!child) return tip;
    visited.add(child.n);
    tip = child.n;
  }
};

/**
 * Parent for `issue`: among other open-PR issues whose changed files (`parentFiles`) or narrowed
 * touch_paths overlap, the lowest-numbered is the chain root and the parent is that chain's tip, so
 * a third overlapping issue extends the stack instead of forking from its root. Returns null when
 * nothing overlaps, `issue` already has a stack edge, the edge would close a cycle, or the paths
 * are unknown (defaults / root-only globs never trigger stacking on their own).
 */
export const pickStackParent = (
  issues: Record<string, StackCandidate>,
  issue: number,
  opts: StackParentOptions = {},
): StackParentPick | null => {
  const me = issues[String(issue)];
  if (!me || me.stacked_on != null) return null;
  const mine = knownPaths(me.touch_paths, opts.defaultTouchPaths);
  if (!mine.length) return null;
  const roots = Object.entries(issues)
    .map(([k, v]) => ({ n: Number(k), v }))
    .filter(({ n, v }) => {
      if (n === issue || v.pr == null || CLOSED_STATUSES.has(v.status ?? '')) return false;
      const theirs = opts.parentFiles?.[String(n)] ?? knownPaths(v.touch_paths, opts.defaultTouchPaths);
      return theirs.length > 0 && touchPathsOverlap(mine, theirs);
    })
    .sort((x, y) => x.n - y.n);
  const root = roots[0];
  if (!root) return null;
  const parent = chainTip(issues, root.n);
  if (parent === issue || reachesIssue(issues, parent, issue)) return null;
  return {
    parent,
    parentBranch: childBranchFor(parent),
    parentPr: issues[String(parent)]!.pr as number,
    issueLinkKeyword: 'Part of',
  };
};

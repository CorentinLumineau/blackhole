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

/** Conservative overlap: two globs overlap when one literal prefix contains the other. */
export const touchPathsOverlap = (a: string[], b: string[]): boolean =>
  a.some((ga) =>
    b.some((gb) => {
      const pa = staticPrefix(ga);
      const pb = staticPrefix(gb);
      if (pa === '' || pb === '') return true;
      return pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
    }),
  );

const reachesIssue = (issues: Record<string, StackCandidate>, from: number, target: number): boolean => {
  const seen = new Set<number>();
  for (let cur: number | null | undefined = from; cur != null && !seen.has(cur); cur = issues[String(cur)]?.stacked_on) {
    if (cur === target) return true;
    seen.add(cur);
  }
  return false;
};

/**
 * Parent for `issue`: the lowest-numbered other issue with an open PR and overlapping touch_paths,
 * independent of merge_mode. Returns null when none, when `issue` already has a stack edge, or when
 * the edge would close a cycle. The tip of a chain is reached transitively because a parent that is
 * itself stacked keeps its own `stacked_on`.
 */
export const pickStackParent = (
  issues: Record<string, StackCandidate>,
  issue: number,
): StackParentPick | null => {
  const me = issues[String(issue)];
  if (!me || me.stacked_on != null || !me.touch_paths?.length) return null;
  const parents = Object.entries(issues)
    .map(([k, v]) => ({ n: Number(k), v }))
    .filter(
      ({ n, v }) =>
        n !== issue &&
        v.pr != null &&
        !CLOSED_STATUSES.has(v.status ?? '') &&
        v.touch_paths?.length &&
        touchPathsOverlap(me.touch_paths!, v.touch_paths) &&
        !reachesIssue(issues, n, issue),
    )
    .sort((x, y) => x.n - y.n);
  const first = parents[0];
  if (!first) return null;
  return {
    parent: first.n,
    parentBranch: childBranchFor(first.n),
    parentPr: first.v.pr as number,
    issueLinkKeyword: 'Part of',
  };
};

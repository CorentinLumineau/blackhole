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

const hasWildcard = (glob: string): boolean => /[*?[{]/.test(glob);

/** Broad = a wildcard with at most one literal path segment before it (`**`, `*.md`, `src/**`). */
const isBroad = (glob: string): boolean =>
  hasWildcard(glob) && !staticPrefix(glob).includes('/');

/** Overlap between two glob lists, by literal-prefix containment; used only when no concrete files are known. */
export const touchPathsOverlap = (a: string[], b: string[]): boolean =>
  a.some((ga) =>
    b.some((gb) => {
      const pa = staticPrefix(ga);
      const pb = staticPrefix(gb);
      if (pa === '' || pb === '') return false;
      return pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
    }),
  );

/** True when any of `globs` matches any concrete file path. */
export const globsMatchFiles = (globs: string[], files: string[]): boolean =>
  globs.some((g) => {
    const matcher = new Bun.Glob(g);
    return files.some((f) => matcher.match(f));
  });

export type StackParentOptions = {
  /** Config `default_touch_paths`: each member is the unnarrowed default, i.e. unknown. */
  defaultTouchPaths?: string[];
  /**
   * Parent issue -> files its open PR actually changes. A non-empty list is matched as concrete
   * files; an empty or absent list is unknown (not "no overlap") and falls back to the parent's
   * narrowed touch_paths.
   */
  parentFiles?: Record<string, string[]>;
};

/** Narrowed paths only: each default member and each broad/root-only glob is dropped individually. */
const knownPaths = (paths: string[] | undefined, defaults: string[] | undefined): string[] =>
  (paths ?? []).filter((g) => !defaults?.includes(g) && !isBroad(g));

/** Paths that may match concrete files: broad globs count here, as real files are evidence; prefixless ones never do. */
const matchablePaths = (paths: string[] | undefined, defaults: string[] | undefined): string[] =>
  (paths ?? []).filter((g) => !defaults?.includes(g) && staticPrefix(g) !== '');

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
  const matchable = matchablePaths(me.touch_paths, opts.defaultTouchPaths);
  if (!matchable.length) return null;
  const roots = Object.entries(issues)
    .map(([k, v]) => ({ n: Number(k), v }))
    .filter(({ n, v }) => {
      if (n === issue || v.pr == null || CLOSED_STATUSES.has(v.status ?? '')) return false;
      const files = opts.parentFiles?.[String(n)];
      if (files?.length) return globsMatchFiles(matchable, files);
      const theirs = knownPaths(v.touch_paths, opts.defaultTouchPaths);
      return mine.length > 0 && theirs.length > 0 && touchPathsOverlap(mine, theirs);
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

/** Changed files of every other open PR, for `parentFiles`; a null read is left out, so it stays unknown. */
export const collectParentFiles = (
  issues: Record<string, StackCandidate>,
  issue: number,
  readPrFiles: (pr: number) => string[] | null,
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(issues)) {
    if (Number(k) === issue || !isOpenPr(v)) continue;
    const files = readPrFiles(v.pr as number);
    if (files) out[k] = files;
  }
  return out;
};

export type StackStep = { issue: number; stackedOn: number | null };

const isOpenPr = (v: StackCandidate | undefined): boolean =>
  !!v && v.pr != null && !CLOSED_STATUSES.has(v.status ?? '');

/**
 * Merge order of every open stacked PR chain. A stack is rooted at an open-PR issue whose parent is
 * absent or already merged/closed; children follow depth-first, lowest-numbered branch first (the
 * same tie-break `chainTip` uses). Roots with no open child are independent PRs and are omitted.
 */
export const stackMergeOrder = (issues: Record<string, StackCandidate>): StackStep[][] => {
  const open = Object.entries(issues)
    .filter(([, v]) => isOpenPr(v))
    .map(([k, v]) => ({ n: Number(k), parent: v.stacked_on ?? null }))
    .sort((a, b) => a.n - b.n);
  const openSet = new Set(open.map((o) => o.n));
  const childrenOf = (p: number) => open.filter((o) => o.parent === p).map((o) => o.n);
  const stacks: StackStep[][] = [];
  for (const root of open.filter((o) => o.parent == null || !openSet.has(o.parent))) {
    const steps: StackStep[] = [];
    const seen = new Set<number>();
    const walk = (n: number, parent: number | null): void => {
      if (seen.has(n)) return;
      seen.add(n);
      steps.push({ issue: n, stackedOn: parent });
      for (const c of childrenOf(n)) walk(c, n);
    };
    walk(root.n, null);
    if (steps.length > 1) stacks.push(steps);
  }
  return stacks;
};

/** One line per stack: `merge #A, then #B (stacked on #A), then #C (stacked on #B)`. */
export const formatStackMergeOrder = (stack: StackStep[]): string =>
  stack
    .map((s, i) => {
      const base = i === 0 ? `merge #${s.issue}` : `then #${s.issue}`;
      return s.stackedOn == null ? base : `${base} (stacked on #${s.stackedOn})`;
    })
    .join(', ');

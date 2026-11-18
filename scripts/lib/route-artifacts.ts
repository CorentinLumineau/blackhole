import { validateEntries, type Manifest } from './carry-staged-artifacts.ts';

// V-AUTO-03 — pure checks that a route's promised documentation artifacts were
// staged (dispatch) and carried (PR). The manifest loader and entry validator are
// `carry-staged-artifacts.ts`'s; this module only compares their output against the route flags.

export type RouteFlags = Record<string, unknown>;

type LedgerShape = { routing_decisions?: Array<{ id?: string; issue_ref?: number; route?: RouteFlags }> };
type QueueShape = { issues?: Record<string, { route?: RouteFlags } | undefined> };

const idNumber = (id: unknown): number => Number(String(id ?? '').replace(/\D/g, '')) || 0;

/** Highest-id `routing_decisions` route for the issue, else the queue entry's `route`, else null. */
export const latestRoute = (ledger: LedgerShape | null, queue: QueueShape | null, issue: number): RouteFlags | null => {
  const rows = (ledger?.routing_decisions ?? []).filter((r) => r.issue_ref === issue && r.route);
  if (rows.length > 0) {
    return rows.reduce((a, b) => (idNumber(b.id) > idNumber(a.id) ? b : a)).route as RouteFlags;
  }
  return queue?.issues?.[String(issue)]?.route ?? null;
};

const FLAG_TO_ROUTE: Array<[string, string]> = [
  ['needs_design', 'design'],
  ['needs_analysis', 'analyze'],
  ['needs_investigation', 'investigate'],
  ['needs_research', 'research'],
];

/** Manifest routes the issue's route promises: `plan` always, plus one per set `needs_*` flag. */
export const promisedRoutes = (route: RouteFlags): string[] => [
  'plan',
  ...FLAG_TO_ROUTE.filter(([flag]) => route[flag] === true).map(([, name]) => name),
];

/** Promised routes with no valid manifest entry; a null manifest is every promised route. */
export const dispatchGaps = (promised: string[], manifest: Manifest | null): string[] => {
  const staged = new Set(validateEntries(manifest?.entries ?? []).valid.map((e) => e.route));
  return promised.filter((route) => !staged.has(route));
};

/** `pr` phase: staged `new_file` targets absent from the PR's changed-files list. */
export const checkRouteArtifacts = (manifest: Manifest | null, diffFiles: string[]): string[] => {
  const changed = new Set(diffFiles.map((f) => f.trim()).filter(Boolean));
  return validateEntries(manifest?.entries ?? []).valid
    .filter((e) => e.target_kind === 'new_file' && !changed.has(e.target_path))
    .map((e) => e.target_path);
};

/** Counts of staged `new_file` docs and how many `isCarried` reports as present. */
export const collectDocCarry = (
  manifest: Manifest | null,
  isCarried: (targetPath: string) => boolean,
): { staged: number; carried: number } => {
  const files = validateEntries(manifest?.entries ?? []).valid.filter((e) => e.target_kind === 'new_file');
  return { staged: files.length, carried: files.filter((e) => isCarried(e.target_path)).length };
};

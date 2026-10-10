import type { LedgerFinding, QueueIssue, Route } from './types.ts';

export function countLedgerByStatus(findings: LedgerFinding[]) {
  const open = findings.filter((f) => f.status === 'open');
  const deferred = findings.filter((f) => f.status === 'deferred');
  const block = open.filter((f) => f.severity === 'BLOCK').length;
  const warn = open.filter((f) => f.severity === 'WARN').length;
  const note = open.filter((f) => f.severity === 'NOTE' || f.severity === 'INFO').length;
  return { open: open.length, deferred: deferred.length, block, warn, note };
}

// Terminal queue statuses — single source shared by every "is this issue active?" check
// (groupIssuesByPhase, computeWaves). Adding a new terminal status here keeps the dashboard
// sections and the wave computation in agreement (prevents a silent active/done split).
export const DONE_STATUSES = ['merged', 'closed'];

const isDone = (issue: QueueIssue) => DONE_STATUSES.includes(issue.status ?? '');

export function groupIssuesByPhase(issues: Record<string, QueueIssue>) {
  const rows: { num: number; issue: QueueIssue }[] = Object.entries(issues)
    .map(([num, issue]) => ({ num: Number(num), issue }))
    .sort((a, b) => a.num - b.num);

  const active = rows.filter((r) => !isDone(r.issue));
  const done = rows.filter((r) => isDone(r.issue));
  const inFlight = active.filter((r) => r.issue.status === 'in-flight');
  const blocked = active.filter((r) => r.issue.status === 'blocked');
  const ready = active.filter((r) => r.issue.status === 'ready');

  return { active, done, inFlight, blocked, ready };
}

// Render the PLANNED conditional route chain for one issue, marking the current phase.
// Honest scope: this shows the planned path + where the issue currently is — NOT a
// reconstructed history of the actual path taken (route{} carries no transition log).
export function renderRouteChain(
  route: Route | undefined,
  phase: string | undefined,
): string {
  if (!route) return '(not yet routed)';

  const mark = (label: string, stepPhase?: string) =>
    stepPhase && stepPhase === phase ? `▸${label}◂` : label;

  const steps: string[] = [];
  if (route.needs_split) {
    // A true split voids every sibling flag — children re-enter with their own route.
    steps.push(mark('Handle', 'handle'), 'Split', '(children re-enter)');
  } else {
    steps.push(mark('Handle', 'handle'));
    if (route.needs_research) steps.push('research');
    if (route.needs_investigation) steps.push('investigate');
    if (route.needs_design) steps.push('design-gate');
    steps.push(mark(`Plan(${route.plan_mode ?? 'full'})`, 'plan'));
    steps.push(mark('Implement', 'implement'));
    steps.push(mark(route.security_review_required ? 'Review(security)' : 'Review', 'review'));
  }

  const chain = steps.join(' → ');

  const c = route.confidence;
  const conf = c
    ? [
        c.split != null ? `split:${c.split}` : null,
        c.design != null ? `design:${c.design}` : null,
        c.plan_mode != null ? `plan:${c.plan_mode}` : null,
        c.security != null ? `sec:${c.security}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return conf ? `${chain}  ·  conf ${conf}` : chain;
}

// Compute display execution waves via topological sort on `depends_on`, mirroring
// `queue-dag.md` § Step 4 semantics (Wave 0 = no unsatisfied deps; Wave N = deps placed
// in prior waves). Merged/closed issues are excluded and count as already-satisfied deps.
// Unresolvable issues (dependency cycles) are surfaced in `unresolved`, never dropped.
//
// Known limitation: a `depends_on` id that is absent from `issues` (e.g. a cross-scope
// dependency outside the campaign's milestone/label filter) is treated as satisfied — this
// is display-only and cannot see forge state for out-of-scope issues. Scheduling readiness
// (queue-dag.md § Step 2) still consults the forge; this function only groups in-scope work.
export function computeWaves(issues: Record<string, QueueIssue>): {
  waves: number[][];
  unresolved: number[];
} {
  const active = Object.entries(issues)
    .map(([num, issue]) => ({ num: Number(num), issue }))
    .filter((r) => !isDone(r.issue));
  const activeNums = new Set(active.map((r) => r.num));

  const placed = new Set<number>();
  const waves: number[][] = [];
  let remaining = active.map((r) => r.num);

  while (remaining.length > 0) {
    const wave = remaining.filter((num) => {
      const deps = issues[String(num)].depends_on ?? [];
      // A dep blocks only if it is another active issue not yet placed in a prior wave.
      return deps.every((d) => !activeNums.has(d) || placed.has(d));
    });
    if (wave.length === 0) break; // dependency cycle — remaining are unresolvable
    wave.sort((a, b) => a - b);
    waves.push(wave);
    wave.forEach((n) => placed.add(n));
    remaining = remaining.filter((n) => !placed.has(n));
  }

  return { waves, unresolved: remaining.sort((a, b) => a - b) };
}

export function discoveryFilings(findings: LedgerFinding[]) {
  return findings
    .filter((f) => f.status === 'deferred' && f.deferred_to_issue != null)
    .map((f) => ({
      issue: f.deferred_to_issue as number,
      summary: f.summary ?? '',
      vcode: f.vcode ?? '',
    }));
}

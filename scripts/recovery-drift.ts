export type IssuePhase = 'handle' | 'plan' | 'implement' | 'review' | 'done';
export type IssueStatus = 'blocked' | 'ready' | 'in-flight' | 'merged' | 'closed';

export type RouteObject = {
  body_hash: string;
  needs_clarification?: boolean;
  [key: string]: unknown;
};

export type QueueIssue = {
  phase: IssuePhase;
  status: IssueStatus;
  pr?: number | null;
  notes?: string | null;
  route?: RouteObject | null;
};

export type CheckpointWorker = {
  role: string;
  issue: number;
};

export type DriftContext = {
  planExists: boolean;
  routeStale: boolean;
  prOpen: boolean;
  checkpointWorkers: CheckpointWorker[];
  notes?: string | null;
};

export type DriftKind = 'router' | 'planner' | 'implementer';

export type HealAction = {
  nextPhase: IssuePhase;
  nextStatus: IssueStatus;
  clearNotes: boolean;
  removeWorkers: DriftKind[];
  skipSpawn: DriftKind[];
  logNote: string;
};

export type DriftResult = {
  drift: DriftKind | null;
  heal: HealAction | null;
};

const ROUTER_IN_FLIGHT_NOTES = /router|WAVE\s*0/i;

function hasRouterInFlightSignal(
  notes: string | null | undefined,
  checkpointWorkers: CheckpointWorker[],
): boolean {
  if (notes && ROUTER_IN_FLIGHT_NOTES.test(notes)) return true;
  return checkpointWorkers.some((worker) => worker.role === 'router');
}

/**
 * Detect artifact-vs-queue drift per recovery-protocol.md §9.2.
 * Pure helper — orchestrator applies heal mutations from the returned action.
 */
export function detectArtifactDrift(
  issueId: number,
  issue: QueueIssue,
  context: DriftContext,
): DriftResult {
  if (issue.status !== 'in-flight') {
    return { drift: null, heal: null };
  }

  const notes = context.notes ?? issue.notes ?? null;

  if (
    issue.phase === 'handle' &&
    issue.route?.body_hash &&
    !context.routeStale &&
    hasRouterInFlightSignal(notes, context.checkpointWorkers)
  ) {
    const nextStatus: IssueStatus = issue.route.needs_clarification ? 'blocked' : 'ready';
    return {
      drift: 'router',
      heal: {
        nextPhase: 'plan',
        nextStatus,
        clearNotes: true,
        removeWorkers: ['router'],
        skipSpawn: ['router'],
        logNote: `Recovery: artifact-drift #${issueId} router → plan`,
      },
    };
  }

  if (issue.phase === 'plan' && context.planExists && issue.pr == null) {
    return {
      drift: 'planner',
      heal: {
        nextPhase: 'implement',
        nextStatus: 'ready',
        clearNotes: true,
        removeWorkers: ['planner'],
        skipSpawn: ['planner'],
        logNote: `Recovery: artifact-drift #${issueId} planner → implement`,
      },
    };
  }

  if (issue.phase === 'implement' && issue.pr != null && context.prOpen) {
    const reviewerActive = context.checkpointWorkers.some((worker) => worker.role === 'reviewer');
    return {
      drift: 'implementer',
      heal: {
        nextPhase: 'review',
        nextStatus: reviewerActive ? 'in-flight' : 'ready',
        clearNotes: true,
        removeWorkers: ['implementer'],
        skipSpawn: ['implementer'],
        logNote: `Recovery: artifact-drift #${issueId} implementer → review`,
      },
    };
  }

  return { drift: null, heal: null };
}

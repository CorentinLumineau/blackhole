import type { Role } from './types.ts';

// Issue #492 — stop --now leg B: the third top-level worker-return value, structurally exclusive
// with `complete`/`blocked` (`worker-schemas.md` § Partial result Design Decision). Declared once
// and appended to every role's status array below rather than six independent string literals
// (`V-DRY-01`).
export const PARTIAL_STATUS = 'partial' as const;

export const PLANNER_STATUSES = ['ready', 'blocked', 'error', PARTIAL_STATUS] as const;
export const IMPLEMENTER_STATUSES = ['complete', 'blocked', 'error', PARTIAL_STATUS] as const;
export const REVIEWER_STATUSES = ['complete', 'error', PARTIAL_STATUS] as const;
export const TRACKS = ['quick', 'standard', 'skip', 'design', 'brainstorm'] as const;
export const SIZE_ESTIMATES = ['xs', 's', 'm', 'l', 'xl'] as const;
export const EXECUTION_MODES = ['standard', 'refactor-strict', 'docs-only'] as const;
export const SEVERITIES = ['BLOCK', 'WARN', 'INFO'] as const;
export const ROUTE_STATUSES = ['routed', 'error', PARTIAL_STATUS] as const;
export const TASK_TYPES = ['feature', 'bugfix', 'refactor', 'docs'] as const;
export const DECISION_RECORD_KINDS = ['root-cause', 'approach', 'refactor', 'improvement', 'reuse'] as const;
export const ESCALATION_TRIGGERS = ['failed_attempts', 'touch_paths_overrun', 'hypotheses_exhausted', 'merge_conflict_semantic'] as const;
export const SPRINT_CONTRACT_STATUSES = ['PASS', 'PARTIAL', 'N/A'] as const;
export const AC_VERDICTS = ['PASS', 'FAIL', 'N/A'] as const;
export const PLAN_MODES = ['skip', 'quick', 'full'] as const;
export const TRIGGERS = ['initial', 'clarify-resolved', 'research-landed', 'investigation-landed', 'analysis-landed'] as const;
export const INVESTIGATOR_STATUSES = ['complete', 'blocked', 'error', PARTIAL_STATUS] as const;
export const HUNTER_STATUSES = ['complete', 'error', PARTIAL_STATUS] as const;

// Issue #492 — `partial_result` field shapes (`worker-schemas.md` § Partial result). A local,
// deliberately separate list from `scripts/lib/build/facts.ts`'s `PHASE_NAMES` — that module is
// build-time doc-generation only and no `scripts/lib/worker-json/*` file imports from
// `scripts/lib/build/*` today; introducing that cross-import for one shared array is a worse
// coupling than the four-string duplication (`V-KISS-01`).
export const PARTIAL_PHASES = ['handle', 'plan', 'implement', 'review'] as const;
export const WORKTREE_DISPOSITIONS = ['pushed', 'clean', 'dirty-uncommitted'] as const;
export const HUNTER_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'BLOCK'] as const;
export const HUNTER_VERIFICATIONS = ['CONFIRMED', 'STALE'] as const;
export const SUB_MODES = ['research', 'investigate', 'analyze'] as const;
export const BRAINSTORM_CHILDREN_CAP = 5;
export const CAPTURE_STATUSES = ['captured', 'unavailable'] as const;
export const COMPANION_REPAIR_VCODES = ['V-ADA-01', 'V-ADA-05', 'V-ADA-09'] as const;
export const RULING_DISPOSITIONS = ['close', 'amend', 'proceed'] as const;

export const ROLE_FROM_TYPE: Record<string, Role> = {
  planner: 'planner',
  implementer: 'implementer',
  reviewer: 'reviewer',
  router: 'router',
  investigator: 'investigator',
  hunter: 'hunter',
  'blackhole:planner': 'planner',
  'blackhole:implementer': 'implementer',
  'blackhole:reviewer': 'reviewer',
  'blackhole:router': 'router',
  'blackhole:investigator': 'investigator',
  'blackhole:hunter': 'hunter',
};

export const ROLE_PATTERN =
  /\b(?:blackhole:)?(planner|implementer|reviewer|router|investigator|hunter)\b/i;

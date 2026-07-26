// Mirrors the `route` object SSOT — `queue-dag.md` § `route` object. Field names and enum
// values are frozen there; this type must not rename or add fields (V-INT-01 / V-DRY-01).
export type Route = {
  needs_split?: boolean;
  needs_clarification?: boolean;
  needs_research?: boolean;
  needs_investigation?: boolean;
  needs_design?: boolean;
  task_type?: 'feature' | 'bugfix' | 'refactor' | 'docs';
  plan_mode?: 'skip' | 'quick' | 'full';
  security_review_required?: boolean;
  confidence?: { split?: number; design?: number; plan_mode?: number; security?: number };
  body_hash?: string;
  computed_at_phase?: 'handle' | 'plan' | 'implement' | 'review';
  revision?: number;
};

export type QueueIssue = {
  title?: string;
  phase?: string;
  status?: string;
  pr?: number | null;
  notes?: string | null;
  depends_on?: number[];
  size?: string;
  review_iteration?: number;
  route?: Route;
};

export type QueueJson = {
  refreshed_at?: string;
  campaign_started_at?: string;
  issues?: Record<string, QueueIssue>;
};

export type LedgerFinding = {
  id?: string;
  vcode?: string;
  severity?: string;
  status?: string;
  summary?: string;
  deferred_to_issue?: number | null;
  issue_ref?: number | null;
};

export type LedgerJson = {
  refreshed_at?: string;
  findings?: LedgerFinding[];
};

export type CheckpointMeta = {
  orchestrator_turn_id?: number;
  last_completed_phase?: string;
  refreshed_at?: string;
};

export type ForgeCounts = {
  openIssues: number;
  openPrs: number;
  ok: boolean;
  error?: string;
};

// Narrow config subset this renderer reads — mirrors forge-scope.ts's per-consumer narrow type
// rather than introducing a shared monolithic CampaignConfig (V-KISS-01).
export type ConfigSummaryInput = {
  scope_milestone?: string;
  scope_labels?: string[];
  merge_mode?: string;
  parallel_max?: number;
  kaizen?: { enabled?: boolean };
  docs_governance?: { enabled?: boolean };
  incident_mode?: { enabled?: boolean };
  worker_model_policy?: string;
  auto_sync?: boolean;
  adaptive_routing?: boolean;
};

export type StatusMode = 'dashboard' | 'config-summary';

export type StatusArgs = {
  mode: StatusMode;
  campaignDir: string;
  skipGh: boolean;
};

export type IssueRow = { num: number; issue: QueueIssue };

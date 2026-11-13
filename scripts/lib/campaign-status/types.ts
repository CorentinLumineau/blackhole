// Mirrors the `route` object SSOT — `queue-dag.md` § `route` object. Field names and enum
// values are frozen there; this type must not rename or add fields (V-INT-01 / V-DRY-01).
// omits: needs_brainstorm, needs_analysis, docs_impact, ui, confidence.docs, confidence.brainstorm, confidence.analysis, confidence.ui — not read by campaign-status.ts's current consumers (V-SHAPE-01 declared narrowing).
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

// Narrow view of `queue.json`'s per-issue entry — field names and semantics are frozen in
// `queue-dag.md` § Field rules; this type reads a subset and never renames or redefines one.
export type QueueIssue = {
  title?: string;
  phase?: string;
  status?: string;
  pr?: number | null;
  notes?: string | null;
  /** Forge labels mirrored by the forge sync; `in-progress:*` / `agent:*` name the lane that owns the issue. */
  labels?: string[];
  depends_on?: number[];
  size?: string;
  review_iteration?: number;
  rounds_to_lgtm?: number;
  reviewed_head_shas?: string[];
  stacked_on?: number | null;
  parent_tip_sha?: string | null;
  stacked_on_pr?: number | null;
  parent_branch?: string | null;
  /** Forge milestone title, synced every turn; a workstream source (`status_page.streams.from: milestone`). */
  milestone?: string | null;
  /** Parent epic issue; a workstream source (`status_page.streams.from: epic`). */
  epic_parent?: number | null;
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
  // ADR-042 — hook-derived rows only: occurrence count and most-recent-arrival
  // timestamp, plus the pre-existing created_at as a sort fallback when last_seen_at is absent.
  occurrences?: number;
  last_seen_at?: string;
  created_at?: string;
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
  /** The open PRs behind `openPrs`, when they were fetched; absent offline (`--no-gh`) or on a failed list. */
  openPrList?: Array<{ number: number; title: string }>;
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
  docs_governance?: {
    enabled?: boolean;
    companion_files?: boolean;
    docs_impact_routing?: boolean;
    write_governance?: boolean;
  };
  incident_mode?: { enabled?: boolean; parallel_max_override?: number };
  worker_model_policy?: string;
  auto_sync?: boolean;
  adaptive_routing?: boolean;
  status_page?: {
    enabled?: boolean;
    streams?: StreamConfig;
    links?: Array<{ label?: string; url?: string }>;
  };
  /** The recorded campaign scope (`config-template.md` § `campaign_scope`), written by `scripts/campaign-record.ts`. */
  campaign_scope?: { entries?: ScopeEntry[] };
  autonomy?: { mode?: string; confidence_threshold?: number };
  display_targets?: number[];
  resource_policy?: { testlock_carveout?: { allowed?: boolean; scope?: string } };
};

/** The kinds a scope entry can have. `in` includes work; the others say why work is not being done. */
export const SCOPE_KINDS = ['in', 'parked', 'deferred', 'blocked_upstream', 'out'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** One line of the recorded campaign scope. `refs` names issues or PRs; `filter` marks the line the launch gate writes. */
export type ScopeEntry = {
  kind: ScopeKind;
  text: string;
  /** `YYYY-MM-DD` the owner set it. */
  set_at: string;
  reason?: string;
  refs?: number[];
  filter?: boolean;
};

/** One owner decision (`owner-decisions.json`), appended by `scripts/campaign-record.ts decision`. */
export type OwnerDecision = { date: string; text: string; refs?: number[] };

/** How issues map to workstreams. Absent ⇒ one stream holding everything. */
export type StreamConfig = {
  from?: 'label' | 'milestone' | 'epic';
  /** `from: label` only: the label prefix naming a stream (default `stream:`). */
  label_prefix?: string;
  /** Issue or PR number → stream name; wins over `from`. */
  overrides?: Record<string, string>;
  /** Stream for an item `from` cannot place (default `All work`). */
  default?: string;
};

/** Review verdict, CI and mergeability of one open PR, read from the forge. Absent offline. */
export type PrSignal = {
  /** The PR's `ai-review:*` label without the prefix, or null when it carries none. */
  review: string | null;
  ci: 'green' | 'failing' | 'running' | 'none';
  /** Names of the failing checks. */
  failing: string[];
  /** False when the forge reports a conflict; null when it has not computed it yet. */
  mergeable: boolean | null;
};

/** A pull request the forge reports as merged, with its merge time. */
export type MergedPr = { number: number; title: string; mergedAt: string };

/** A queue entry the forge contradicts: the queue says `queue`, the forge says its PR is merged. */
export type QueueDrift = { issue: number; pr: number; title: string; queue: string; forge: 'merged' };

export type StatusMode = 'dashboard' | 'config-summary' | 'json' | 'html' | 'data';

export type StatusArgs = {
  mode: StatusMode;
  campaignDir: string;
  skipGh: boolean;
  /** `--html` only: absolute output path; null ⇒ `<campaignDir>/.tmp/status.html`. */
  outPath: string | null;
  /** `--data` only: absolute directory the row files are written to; null otherwise. */
  dataDir: string | null;
};

/** Queue and ledger counts — the single computation both the text dashboard and the report read. */
export type StatusCounts = {
  queue: {
    active: number;
    done: number;
    in_flight: number;
    blocked: number;
    ready: number;
    /** Active entries whose `status` is missing or outside the documented set (listed in `unclassified`). */
    unclassified: number;
    /** Every `status` value present in queue.json, including ones outside the documented enum. */
    by_status: Record<string, number>;
  };
  ledger: { open: number; block: number; warn: number; note: number; deferred: number };
};

/** One queue issue as the status page shows it. Every string is untrusted state — escape before rendering. */
export type StatusItem = {
  issue: number;
  title: string;
  phase: string | null;
  status: string | null;
  pr: number | null;
  notes: string | null;
  /** Plain-language next step derived from phase/status/PR. */
  next_step: string;
  /** Forge link to the PR; set on `waiting_on_owner` items that have one and whose URL can be built. */
  pr_url?: string | null;
};

/** Blocked issues sharing one wait reason: an `awaiting-*` gate token, or `dependency` / `overlap` / `merge-conflict` / `other`. */
export type BlockedGroup = {
  waits_on: string;
  /** True when only the owner can clear it (an `awaiting-*` gate or a `blocked-escalated:` note). */
  owner: boolean;
  count: number;
  issues: StatusItem[];
};

/** Why a non-owner blocked issue waits, derived from its labels, note and `depends_on`; no new state. */
export type BlockedClassKind = 'tracking_issue' | 'dependency' | 'merge_conflict' | 'overlap' | 'sequenced_phase' | 'other' | 'another_lane';

/** The extra rows `elseClasses` adds after the blocked classes on the page: `unclassified` and `untracked_prs`. */
export type ElseClassKind = BlockedClassKind | 'unclassified' | 'untracked_pr';

/** Blocked non-owner issues sharing one reason class. Every such issue is in exactly one class. */
export type BlockedClass = {
  class: ElseClassKind;
  /** Plain-language name for the page. */
  label: string;
  count: number;
  /** True when an item's note addresses the owner (`owner:` / `needs-owner`) outside another lane; the page renders it open. */
  attention: boolean;
  issues: StatusItem[];
};

/**
 * `bun run status --json` output, and the input of `--html`. Same data the text dashboard shows,
 * computed from the same helpers. Documented in `src/references/coordinator-dashboard.md`
 * § Status page. Bump `schema_version` on any breaking field change.
 */
/**
 * A PR that reached LGTM and waits on the owner to merge: delivered under `leave-open`, or held by
 * the low-risk merge gate (`needs-chef`). `held_for` is set only for a held PR and carries the
 * categories its note names (`''` when the note names none).
 */
export type ReadyToMergeItem = StatusItem & { pr_url: string; held_for?: string };

/** A loud line `bun run status` prints when the campaign's state stopped moving or its page was never published. */
export type StatusAlert = { kind: 'stale_state' | 'page_never_published'; message: string };

/** What the campaign is doing right now. `stale` replaces any other kind when the state is old. */
export type StatusStateKind = 'running' | 'waiting_on_you' | 'idle' | 'done' | 'stale';

export type StatusState = {
  kind: StatusStateKind;
  /** The state the campaign would show if it were fresh; equals `kind` unless `kind` is `stale`. */
  underlying: Exclude<StatusStateKind, 'stale'>;
  /** Short reason, e.g. `2 workers active`. */
  reason: string;
  /** Newest of `checkpoint.refreshed_at` / `campaign.queue_refreshed_at`; null when neither parses. */
  last_activity_at: string | null;
  /** Age of `last_activity_at` at `generated_at`, in hours; null when unknown. */
  stale_hours: number | null;
  /** What the owner has to do, or the "running on its own" line. */
  next_action: string;
};

export type StatusReport = {
  schema_version: 1;
  generated_at: string;
  campaign: {
    repo: string | null;
    scope: { milestone: string | null; labels: string[] };
    started_at: string | null;
    queue_refreshed_at: string | null;
  };
  /** The banner: running / waiting on you / idle / done, or stale when the state is old. Additive. */
  state: StatusState;
  /** Stale-state and never-published lines, empty when all is well. Additive. */
  alerts: StatusAlert[];
  checkpoint: {
    turn: number | null;
    refreshed_at: string | null;
    last_completed_phase: string | null;
    /** Lines of the checkpoint's `## Notes` section. */
    notes: string[];
    /** Lines of the checkpoint's `## In-flight workers` section. */
    active_workers: string[];
  };
  forge: ForgeCounts;
  counts: StatusCounts;
  queue_health: 'healthy' | 'stalled' | 'degraded';
  /**
   * Open PRs delivered at LGTM (`leave-open` mode: queue `notes` starts with `delivered-at-LGTM`),
   * which passed review, CI and the conflict check — the owner reviews and merges them.
   */
  ready_to_merge: ReadyToMergeItem[];
  waiting_on_owner: StatusItem[];
  /** In-flight issues not yet in review. */
  in_flight: StatusItem[];
  /** In-flight issues in the review phase. */
  in_review: StatusItem[];
  blocked: BlockedGroup[];
  /** The non-owner part of `blocked`, regrouped by reason class. Additive: `blocked` is unchanged. */
  blocked_classes: BlockedClass[];
  ready: StatusItem[];
  /** Active entries whose `status` is missing or undocumented, so no section above lists them. Additive. */
  unclassified: StatusItem[];
  /**
   * Open forge PRs that no queue entry's `pr` names (work opened without an issue). `null` when the
   * open-PR list was not fetched (`--no-gh` or a forge failure), so "none" is never claimed unchecked. Additive.
   */
  untracked_prs: Array<{ pr: number; title: string }> | null;
  /** Newest merged/closed items, highest PR then issue number first (the queue carries no merge time), at most 5. */
  recently_done: StatusItem[];
  /** Open findings, BLOCK first then most recent — the dashboard's `Ledger open` order, uncapped. */
  ledger_open: Array<{
    id: string | null;
    vcode: string | null;
    severity: string | null;
    summary: string;
    issue_ref: number | null;
  }>;
  host: {
    /** The `bun run status` pace line, or null when `pace-log.jsonl` has no record. */
    pace: string | null;
    /** Plugin-drift and other environment lines the text dashboard prints after the counts. */
    notes: string[];
  };
  /** The recorded campaign scope; `recorded: false` when `config.json` has none ("Scope not recorded"). Additive. */
  scope_record: { recorded: boolean; entries: ScopeEntry[] };
  /** The owner's decisions, newest first. Additive. */
  decisions: OwnerDecision[];
  /** One sentence on where the run stands: the checkpoint's `## Headline`, else generated from the counts. Additive. */
  headline: { text: string; source: 'checkpoint' | 'generated' };
  /** What holds the run back: the checkpoint's `## Blocking the run` lines, else generated. Additive. */
  blockers: Array<{ text: string; tone: Tone; source: 'checkpoint' | 'generated' }>;
  /** Whether PR review verdicts, CI and conflicts were read from the forge this render. Additive. */
  forge_checked: boolean;
  /** Every queue entry and untracked PR as one card of the stage board. Additive. */
  board: BoardItem[];
  /** The board's counts; `on_you` is the length of `moves`. Additive. */
  stage_counts: StageCounts;
  /** What the owner can do now: PRs delivered at LGTM and owner gates first. Additive. */
  moves: Array<{ text: string; url: string | null; ref: number }>;
  /** Board items per workstream. Additive. */
  streams: Array<{ stream: string; done: number; in_review: number; left: number; next: string }>;
  /** Forge pages and configured links. Additive. */
  links: Array<{ label: string; url: string }>;
  /** The rules the run works under, read from `config.json`. Additive. */
  config_rows: Array<{ key: string; value: string }>;
  /** Queue entries the forge contradicts, rendered as the forge has them; the next sync brings the queue in line. Empty when the forge was not read. Additive. */
  drift: QueueDrift[];
};

/** A status colour name. Text always carries the meaning; the colour only repeats it. */
export type Tone = 'ok' | 'info' | 'warn' | 'bad' | '';

/**
 * Where a card sits. The page folds them into five columns: in review (`ready`, `review`, `active`),
 * blocked, not started (`you`, `todo`), parked, done.
 */
export type BoardStage = 'ready' | 'review' | 'active' | 'blocked' | 'you' | 'todo' | 'parked' | 'done';

export type BoardItem = {
  stage: BoardStage;
  /** The number the card links to: the PR when there is one, else the issue. */
  ref: number;
  kind: 'issue' | 'pr';
  issue: number | null;
  pr: number | null;
  title: string;
  /** One line saying where the item stands; empty for a plain not-started or done item. */
  status: string;
  tone: Tone;
  url: string | null;
  stream: string;
};

export type StageCounts = {
  done: number;
  in_review: number;
  on_you: number;
  blocked: number;
  parked: number;
  not_started: number;
  total: number;
};

export type IssueRow = { num: number; issue: QueueIssue };

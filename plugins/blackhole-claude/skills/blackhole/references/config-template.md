# Campaign Config Template

Committed template: `.blackhole/config.json`

```json
{
  "repo": "owner/repo-name",
  "target_branch": "main",
  "forge": "github",
  "parallel_max": 4,
  "scratchpad_dir": "/tmp/campaign",
  "size_label_prefix": "size:",
  "default_touch_paths": ["src/**", "lib/**", "app/**"],
  "issue_labels": {
    "campaign": "blackhole/backlog"
  },
  "scope_milestone": "v0.4.0",
  "scope_labels": ["blackhole/backlog", "size:m"],
  "auto_sync": true,
  "adaptive_routing": true,
  "router_confidence_thresholds": { "split": 70, "design": 70, "plan_mode": 70, "security": 70, "docs": 70, "brainstorm": 70, "analysis": 70, "ui": 70 },
  "docs_governance": { "enabled": true, "companion_files": true, "docs_impact_routing": true, "write_governance": true, "severity_overrides": {} },
  "kaizen": { "enabled": false, "kinds": ["quickwins", "best-practices", "coverage", "refactor", "bug", "retrospective", "parity", "ux-coherence", "docs", "backlog", "ci", "deps", "perf"], "trigger": "on-empty", "loop_interval": 5, "min_priority": 30, "max_issues_per_wave": 10, "max_waves": 6 },
  "incident_mode": { "enabled": false, "parallel_max_override": 1, "pause_discovery": true },
  "autonomy": { "confidence_threshold": 80, "design_dominance_delta": 30, "design_autonomy": true, "analyze_routing": true, "brainstorm_routing": false, "never_bypass": ["destructive", "credentials", "epic-go-no-go"] },
  "worker_model_policy": "cost-optimized",
  "worker_effort_policy": "cost-optimized",
  "entry_mode": "multitask",
  "display_targets": []
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `repo` | yes | `owner/name` for the configured forge backend |
| `target_branch` | yes | Merge target (usually `main`) |
| `forge` | yes | `github` \| `gitea` \| `gitlab` (v2 — see ADR-027). Default `github`. When unset at bootstrap, infer from `git remote get-url origin`; explicit value always wins. Mismatch between configured `forge` and detected origin host **must** fail bootstrap loudly (never silently fall back to `github` on a non-GitHub origin). Backend CLIs: `gh` (GitHub), `tea` (Gitea), `glab` (GitLab). Detection/validation implementation: #682 |
| `parallel_max` | no | Max parallel workers (default 4) |
| `pareto_max_age_days` | no | Days after which a stored Pareto score is stale and re-scored (default `7`; `forge-sync.md` § Score on ingest) |
| `scratchpad_dir` | no | Parent dir for git worktrees; the PreToolUse hooks read it from the main clone the harness project dir names (git metadata in cwd when none is usable) |
| `size_label_prefix` | no | Label prefix for size tags (default `size:`) |
| `default_touch_paths` | no | Glob patterns for default scope boundary |
| `issue_labels.campaign` | no | Label applied on runtime `gh issue create` (see `forge-sync.md`) |
| `scope_milestone` | no | Milestone **title** (not number). When set, only issues in this milestone are in campaign scope |
| `scope_labels` | no | When set, issue must have **all** listed labels (AND). Empty array treated as unset |
| `auto_sync` | no | When `true` (default), forge reconcile runs automatically |
| `adaptive_routing` | no | Emergency kill switch for ADR-004 router-agent routing (default `true`); when `false`, routing is inert regardless of `route` presence in `queue.json` |
| `router_confidence_thresholds` | no | Per-flag confidence thresholds keyed by `split`, `design`, `plan_mode`, `security`, `docs`, `brainstorm`, `analysis`, `ui` (matches `route.confidence` keys); each defaults to `70` when absent. The `brainstorm` threshold alone does not turn on `needs_brainstorm` dispatch — that is additionally gated by `autonomy.brainstorm_routing`; the `analysis` threshold alone does not turn on `needs_analysis` dispatch — that is additionally gated by `autonomy.analyze_routing` (see below); the `ui` threshold gates `route.ui`'s confidence-gate cautious default (ADR-017) (sub-keys: split, design, plan_mode, security, docs, brainstorm, analysis, ui) |
| `docs_governance` | no | Nested object of flags/thresholds for companion-file, docs-impact-routing, and write-governance features (`enabled`, `companion_files`, `docs_impact_routing`, `write_governance`, `severity_overrides`); absent block = current behavior preserved (all three sub-flags gate live features — see rows below) |
| `docs_governance.enabled` | no | Emergency kill switch for the whole `docs_governance` block. **SSOT for the absent-block default (issue #477)** — this flag must resolve to the literal `true` for any dependent feature to run: an absent `docs_governance` block, a present block with `enabled` unset, and an explicit `enabled: false` all resolve to the same inert state (current/pre-feature behavior preserved). The per-field defaults documented on `companion_files`, `docs_impact_routing`, and `write_governance` (each defaulting to `true`) apply **only when the `docs_governance` block is present** — an entirely absent block is never read as `enabled: true`. Every other surface that reads this flag resolves it the same way and references this row rather than restating its own copy of the default (V-DRY-01) — see the contract note below for the full no-op scope and consumer list |
| `docs_governance.companion_files` | no | Gates the V-ADA companion-file reviewer audit (default `true`); when `false`, that audit is inert regardless of `enabled` — live consumers: `src/agents/reviewer.md` § Companion-File Audit "Companion-File Audit (`V-ADA-01/02/03/05/06/07`)", config-gated at `reviewer.md` § Companion-File Audit, and `src/SKILL.md` Phase 0 step 2 "Companion-file scaffold", config-gated at `SKILL.md:56` |
| `docs_governance.docs_impact_routing` | no | Gates the router `docs_impact` flag (`src/agents/router.md`, `src/references/orchestrator-delegation.md` § Route-derived dispatch, #177); default `true`; when `false` (or `docs_governance.enabled: false`), `docs_impact` resolves to its cautious default (`true`) regardless of computed value or confidence |
| `docs_governance.write_governance` | no | Gates search-before-write/canonical-slug rules for consumer-repo writes (default `true`); when `false`, those rules are inert regardless of `enabled` — live consumers: `src/agents/implementer.md` (companion-doc update step, gated in `implementer.md` § Refactoring & Implementation Workflow, step 6) and `src/agents/planner.md` (Standard Track Documentation Impact bullet, gated at `planner.md:65`) |
| `docs_governance.severity_overrides` | no | Map of V-code → `BLOCK`\|`WARN`, keyed by docs-governance V-code; empty/absent = defaults apply. May only escalate a WARN-default docs-governance code to BLOCK — must never de-escalate the pre-existing `V-DOCSYNC-01` BLOCK severity |
| `roadmap.path` | no | Repo-relative `.md` path of the generated roadmap (e.g. `documentation/plans/roadmap.md`). **No default, and the framework never picks one**: absent = `scripts/roadmap.ts` is a no-op and writes nothing. A path that is absolute, leaves the repo, or is not `.md` throws with the key path. The file carries lifecycle frontmatter (`doc-governance.md`), so the script upserts its row into an existing blackhole-shaped `documentation/INDEX.md` (never creating the index, never touching a consumer-owned shape); it rewrites the roadmap only when the ranking body changed |
| `roadmap.enabled` | no | Switch for the roadmap. **Resolution**: an explicit boolean wins; unset ⇒ follows `docs_governance.enabled` resolving to the literal `true` (SSOT row above), so an absent block is off. A wrong type throws with the key path. Only read when `roadmap.path` is set |
| `kaizen` | no | Nested object gating the kaizen improvement-hunt loop (ADR-006): `enabled`, `kinds`, `trigger`, `loop_interval`, `min_priority`, `max_issues_per_wave`, `max_waves`; absent block = current behavior preserved (hunting is opt-in, see contract note below) |
| `kaizen.enabled` | no | Kill switch for the whole `kaizen` block (default `false` — hunting is opt-in, unlike `docs_governance` which defaults `true`); when `false`, hunt dispatch never fires regardless of sub-field values |
| `kaizen.kinds` | no | Array of hunt territory kinds to scan (default `["quickwins", "best-practices", "coverage", "refactor", "bug", "retrospective", "parity", "ux-coherence", "docs", "backlog", "ci", "deps", "perf"]`); `retrospective`, `parity`, `ux-coherence`, `docs`, `backlog`, `ci`, `deps`, and `perf` are all included by default whenever `kaizen.enabled: true` |
| `kaizen.trigger` | no | `on-empty` \| `every-n-loops` \| `manual` (default `on-empty`) — when the Phase-5 loop dispatches a hunt wave |
| `kaizen.loop_interval` | no | Number of Phase-5 loop iterations between hunt waves when `trigger: every-n-loops` (default `5`) |
| `kaizen.min_priority` | no | Minimum `Priority = Gain * (11 - Effort)` a finding must clear to be filed as an issue (default `30`, matching the `V-PARETO-02` Priority formula SSOT); may only be **raised** above `30`, never lowered below the `V-PARETO-02` threshold |
| `kaizen.max_issues_per_wave` | no | Cap on issues filed per hunt wave (default `10`) — exceeding it is `V-HUNT-02` (WARN) |
| `kaizen.max_waves` | no | Cap on total hunt waves per kind before it is marked exhausted (default `6`) |
| `incident_mode` | no | Nested object gating the campaign-wide incident posture (`orchestrator-runtime.md` § Incident Mode): `enabled`, `parallel_max_override`, `pause_discovery`; absent block = current behavior preserved (incident mode is a rare, deliberately-armed emergency posture, opt-in like `kaizen`, see contract note below) |
| `incident_mode.enabled` | no | Kill switch for the whole `incident_mode` block (default `false` — armed manually by a human/coordinator, unlike `docs_governance` which defaults `true`); when `false`, incident-mode dispatch behavior never fires regardless of sub-field values |
| `incident_mode.parallel_max_override` | no | `parallel_max` value enforced while incident mode is active (default `1`), regardless of `config.json.parallel_max` |
| `incident_mode.pause_discovery` | no | When `true` (default), `phase-loop.md` § Continuous Discovery of Improvements is paused entirely while incident mode is active |
| `autonomy` | no | Nested object configuring the always-active autonomous thinking-route features (ADR-010, ADR-014): `confidence_threshold`, `design_dominance_delta`, `design_autonomy`, `analyze_routing`, `brainstorm_routing`, `never_bypass`; absent block = sub-field defaults apply, see contract note below |
| `autonomy.confidence_threshold` | no | Composite confidence score (0–100) a route/design decision must clear to proceed autonomously (default `80`); see [confidence-gates.md](confidence-gates.md) for the 5-dimension kernel and two-band mapping |
| `autonomy.design_dominance_delta` | no | Minimum point spread between the top-scored design alternative and the runner-up required for autonomous design promotion (default `30`); see [confidence-gates.md](confidence-gates.md) |
| `autonomy.design_autonomy` | no | Gates the autonomous design tier — blind-critic scoring, `design-aggregate.ts` verdict, and in-PR ADR promotion (default `true`); when `false`, design decisions always route to human ADR review |
| `autonomy.analyze_routing` | no | Gates the router's `needs_analysis` autonomous dispatch to the investigator `analyze` sub-mode (default `true`); when `false`, analyze routing is inert |
| `autonomy.brainstorm_routing` | no | Gates the router's `needs_brainstorm` autonomous dispatch to the planner `track: brainstorm` (default `false` — terminal-closure pin, ADR-010 D3); when `false`, brainstorm routing is inert |
| `autonomy.never_bypass` | no | Array of categorical triggers that always force human escalation regardless of confidence score (default `["destructive", "credentials", "epic-go-no-go"]`); see [confidence-gates.md](confidence-gates.md) |
| `autonomy.mode` | no | Campaign-wide autonomy posture override (e.g. `full` — agent decides design approvals, split sign-offs, plan waivers, and BLOCK remedies without a human gate); absent = per-sub-field `autonomy.*` defaults apply |
| `autonomy.granted_at` | no | ISO date when `autonomy.mode` (or a broader autonomy grant) was recorded by the owner/coordinator |
| `autonomy.granted_by` | no | Freeform provenance for who granted the autonomy override (e.g. `owner (turn-4 chat)`) |
| `autonomy.scope` | no | Human-readable description of what the autonomy grant covers for this campaign |
| `autonomy.note` | no | Freeform note on how the autonomy grant interacts with other config (e.g. `merge_mode`) |
| `worker_model_policy` | no | `cost-optimized` (default) — per-spawn model from role/track/route tier matrix, cheapest capable slug on current harness (`model-routing.md`); `inherit` — parent session model, no `model` override (v0.6.1 behavior) |
| `worker_effort_policy` | no | `cost-optimized` (default when field present) — per-spawn reasoning effort folded into the resolved task tier (`model-routing.md` § Harness tier ladders); `inherit` — omit effort parameters, session inheritance (mirror `worker_model_policy: inherit`). When absent, tier-folded effort defaults apply under `cost-optimized` semantics |
| `decisions.mode` | no | Decision parking (`decision-parking.md`, ADR-059): `park` ⇒ every owner question the campaign raises is parked in `pending-decisions.json` and asked in one round when the owner runs `/blackhole decide`; `ask` ⇒ every gate asks as it comes. The interactive launch gate and the decide round ask directly either way. **Resolution**: absent, or any value other than `"ask"` (default) ⇒ `park`; a retired `sleep_mode` block is never read |
| `sleep_mode` | no | **Retired** (ADR-059 amendment): sleep mode is gone. Any `sleep_mode` block is ignored, never an error: `run-context.ts`, the launch summary's and the Run panel's Decisions rows, and the `decide` round name it with a warning to remove it. Parking is `decisions.mode`, the keep-awake hold follows the run (`keep-awake.md`), and an unattended start passes `--unattended`. A `sleep_mode.since`/`baseline` left by a campaign that was away at the upgrade seeds the first `decide` report once. **Resolution**: ignored |
| `entry_mode` | no | `multitask` (default) — coordinator + orchestrator; `direct` = legacy single session |
| `merge_mode` | **yes at bootstrap** | `"immediate"` \| `"gated-batch"` (ADR-005) \| `"leave-open"` (ADR-006) — **no default** (ruling R-002, `documentation/reference/product-principles.md`): an absent or invalid value is a bootstrap-blocking condition, not a silent fallback; see the contract note below. `immediate`: each **low-risk** green campaign PR squash-merges as soon as it reaches LGTM; any other PR stays open with `needs-chef` (`merge-risk.md`). `gated-batch` waits for all in-scope PRs (per `scope_milestone`/`scope_labels`) to reach LGTM, then merges one low-risk PR at a time in `merge_after` dependency order; high-risk siblings still get `needs-chef`. `leave-open`: blackhole never merges — every PR is driven to LGTM and left open for human review/merge; an LGTM'd open PR counts as *delivered* for campaign-complete purposes; `merged_by: blackhole` is never set for these issues; `fixed-in-pr` ledger rows stay `fixed-in-pr` until the human merge is later observed by a sync; high-risk green PRs still receive `needs-chef`; see `phase-loop.md` § Merge protocol and `merge-gate.md` |
| `display_targets` | no | Array of viewport widths in px (e.g. `[412, 700, 2560]`) to capture visual evidence at for UI-affecting PRs (ADR-018); absent or empty (default) ⇒ both the implementer's capture step and the reviewer's Visual Evidence Audit are no-ops |
| `merge_ready.required_checks` | no | Array of exact check names (a check-run `name` or commit-status `context`, e.g. `ci-main / ci-report (pull_request)`) that must have run and succeeded before CI counts green (`scripts/ci-verdict.ts` reads it via `--config`; `--required` overrides it). **Resolution**: absent or empty ⇒ fail closed: any SKIPPED gating check makes the verdict `pending`, naming this key; a wrong type is a usage error (exit 2) |
| `status_page` | no | Nested object for the campaign status page (`status-page.md`). **Resolution**: absent block or key ⇒ `enabled: true` |
| `status_page.streams` | no | How issues map to the page's workstreams. **Resolution**: absent ⇒ one stream, `All work`. `from`: `label` (a label `<label_prefix><name>`, prefix default `stream:`), `milestone` (the queue entry's milestone) or `epic` (the title of the entry's `epic_parent`); `overrides`: issue or PR number → stream name, wins over `from`; `default`: the stream of an item `from` cannot place |
| `status_page.links` | no | Extra quick links on the page, `[{label, url}]`; only http(s) URLs are shown. The forge's PR, issue and CI pages are added without configuration |
| `campaign_scope.entries` | no | The campaign scope in words, shown at the top of the status page. Written only by `bun "${BLACKHOLE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?blackhole plugin root unset, see blackhole#1269}}"/scripts/campaign-record.ts scope` (the launch configuration gate and every owner scope change, `status-page.md` § What the orchestrator records). Each entry: `kind` (`in` \| `parked` \| `deferred` \| `blocked_upstream` \| `out`), `text`, `set_at` (`YYYY-MM-DD`), optional `reason`, optional `refs` (issue or PR numbers: a non-`in` entry naming one moves its card to parked, or blocked for `blocked_upstream`), optional `filter` (the gate's description of the issue filter). Independent of `scope_milestone`/`scope_labels`, which still decide what is ingested. **Resolution**: absent ⇒ the page and `--data` show the issue filter (`all open issues` when none is set), nothing else changes |
| `status_page.enabled` | no | When `true` (default), the page is regenerated (`bun run "${BLACKHOLE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?blackhole plugin root unset, see blackhole#1269}}"/scripts/campaign-status.ts --data` on Claude Code, `--html` elsewhere) at campaign start, every checkpoint write and on `status`, then published to the harness's one view (Claude Code artifact, Cursor canvas `Blackhole status`, or the local file); when `false`, none of that runs and the text dashboard is unchanged |
| `wave_scheduling` | no | Nested object recording campaign-specific wave-scheduling policy and owner-granted exceptions. **Resolution**: absent block ⇒ default orchestrator scheduling (no hot-file cap, no batched-checks exception) |
| `wave_scheduling.shard_by_touch_path` | no | When `true`, shard parallel workers by declared touch-path overlap to reduce merge/rebase collisions on shared files |
| `wave_scheduling.hot_files_max_one_per_wave` | no | Array of repo-relative paths that may have at most one in-flight worker per wave (hot-file lock) |
| `wave_scheduling.rationale` | no | Human-readable rationale for the `wave_scheduling` settings (audit trail for owner decisions) |
| `wave_scheduling.batched_checks_pr` | no | Owner-granted exception allowing one PR to implement several `scripts/checks/*.check.ts` modules together |
| `wave_scheduling.batched_checks_pr.allowed` | no | When `true`, the batched-checks PR exception is active for this campaign |
| `wave_scheduling.batched_checks_pr.granted_at` | no | ISO date when the batched-checks exception was granted |
| `wave_scheduling.batched_checks_pr.granted_by` | no | Freeform provenance for who granted the batched-checks exception |
| `wave_scheduling.batched_checks_pr.rule` | no | Normative rule text describing what the batched-checks exception permits |
| `wave_scheduling.batched_checks_pr.rationale` | no | Human-readable rationale for granting the batched-checks exception |
| `wave_scheduling.batched_checks_pr.constraints` | no | Array of constraints the batched PR must satisfy (e.g. independent modules, shared theme, live verify for count bump) |
| `resource_policy` | no | Nested object recording campaign-specific resource/fan-out overrides and mitigations. **Resolution**: absent block ⇒ default resource posture |
| `resource_policy.fan_out_override` | no | Freeform note when `parallel_max` exceeds a documented workstation cap and the owner has accepted the risk |
| `resource_policy.mitigations` | no | Array of mitigations applied alongside a fan-out override (e.g. test-lock serialization, memory watchdog, scoped searches) |
| `resource_policy.testlock_carveout` | no | Owner-granted exception allowing this repo's `build`/`verify`/`test` to run without the global `with-test-lock` wrapper |
| `resource_policy.testlock_carveout.allowed` | no | When `true`, the test-lock carveout is active for this repo/campaign |
| `resource_policy.testlock_carveout.granted_at` | no | ISO date when the test-lock carveout was granted |
| `resource_policy.testlock_carveout.granted_by` | no | Freeform provenance for who granted the test-lock carveout |
| `resource_policy.testlock_carveout.scope` | no | Human-readable scope of the carveout (which repos/commands it covers) |
| `resource_policy.testlock_carveout.rationale` | no | Human-readable rationale for granting the test-lock carveout |
| `resource_policy.testlock_carveout.conditions` | no | Array of conditions workers must honor while the carveout is active (e.g. memory self-gate, serial heavy commands) |
| `resource_policy.gate` | no | Thresholds for `scripts/resource-gate.ts`, the host check run before each test/build-bearing batch. **Resolution**: absent block or key ⇒ the defaults below |
| `resource_policy.gate.defer_below_mem_mb` | no | MemAvailable (MB) below which the batch is deferred to a later turn (default `2500`) |
| `resource_policy.gate.full_above_mem_mb` | no | MemAvailable (MB) at or above which the full batch may spawn; between the two the batch is cut to one (default `3500`) |
| `resource_policy.gate.defer_above_load_ratio` | no | 1-minute load ÷ core count above which the batch is deferred (default `2.0`) |
| `resource_policy.gate.full_below_load_ratio` | no | Load ratio at or below which the full batch may spawn; above it the batch is cut to one (default `1.0`) |
| `resource_policy.gate.defer_above_dstate` | no | Count of uninterruptible-sleep (D-state) processes above which the batch is deferred, whatever the load (default `10`) |
| `resource_policy.pace` | no | Thresholds for `scripts/pace-gate.ts`, the usage-pace check run beside `resource_policy.gate` before each spawn round. **Resolution**: absent block or key ⇒ the defaults below; absent or stale cache ⇒ `unavailable` (gate not applied, reason logged) |
| `resource_policy.pace.cache_path` | no | File holding Claude Code's statusline stdin payload, whose `rate_limits` the gate reads (default `~/.claude/cache/rate-limits.json`). A statusline command fills it and still prints its own status text, e.g. `input=$(cat); mkdir -p ~/.claude/cache; printf '%s' "$input" > ~/.claude/cache/rate-limits.json.tmp && mv ~/.claude/cache/rate-limits.json.tmp ~/.claude/cache/rate-limits.json; echo "<your status line>"`; `rate_limits` is present only for Pro/Max subscribers, after the session's first response |
| `resource_policy.pace.baseline_path` | no | File where the gate records `seven_day` usage at the start of the current day and five-hour session (default `pace-baseline.json` beside `cache_path`). A day or session that has spent its share of the weekly allowance left when it began (remaining ÷ remaining days, remaining ÷ remaining sessions) forces `STOP-NEW` even when the weekly total looks fine. A missing or corrupt file is replaced and that run's reasons say `compartments unavailable` |
| `resource_policy.pace.max_age_seconds` | no | Cache older than this many seconds is treated as `unavailable` (default `600`) |
| `resource_policy.pace.stop_pct` | no | `used_percentage` at or above which either window forces `STOP-NEW` (default `95`) |
| `resource_policy.pace.throttle_pct` | no | Five-hour `used_percentage` at or above which the round is capped at one worker (default `80`) |
| `resource_policy.pace.throttle_ratio` | no | Seven-day pace (used share ÷ elapsed share) above which the round is capped at one worker (default `1.2`) |
| `resource_policy.pace.scale_up_ratio` | no | Seven-day pace below which one more worker is allowed, up to `parallel_max` (default `0.7`) |
| `usage_budget.enabled` | no | Master switch for `scripts/usage-budget.ts`, the usage-aware pacing gate (default `false`; `false` ⇒ verdict `unavailable`, `workers` = `parallel_max`, campaigns unchanged). **Resolution**: absent block or key ⇒ the defaults in this block; a wrong type throws with the key path |
| `usage_budget.windows` | no | Which rate-limit windows the gate reads (default `null` = auto-detect: the windows present in the usage reading, so a plan whose reading carries no `five_hour` window gates on the weekly window alone with no config; a non-empty list of `five_hour`, `seven_day` keeps only those). Read through `scripts/lib/usage-source.ts` and by `usage-budget.ts --usage`. **Resolution**: absent or `null` ⇒ auto-detect; any other value that is not a non-empty list of those names throws with the key path |
| `usage_budget.five_hour.no_spawn_at` | no | 5-hour `used_percentage` at or above which no new worker spawns, in-flight workers finish (default `85`; must be `>` 0 and `<` `stop_workers_at`) |
| `usage_budget.five_hour.stop_workers_at` | no | 5-hour `used_percentage` at or above which workers stop and the campaign waits for the window reset (default `90`; `<= 100`). Also the ceiling `workers` is sized against |
| `usage_budget.weekly.no_new_starts_at` | no | Weekly (`seven_day`) `used_percentage` at or above which no new chain starts, in-flight chains finish (default `78`, or `target_at_reset` when that is set; must be `>` 0 and `<` `stop_campaign_at`, or with a target `>=` `target_at_reset` and `<=` `stop_campaign_at`). With a target, crossing it is `PACE-WAIT` until the weekly reset instead of `NO-NEW-STARTS` |
| `usage_budget.weekly.stop_campaign_at` | no | Weekly `used_percentage` at or above which the campaign drains and stops (default `80`, or `target_at_reset` when that is set; `<= 100`; with a target an explicit value below it is rejected) |
| `usage_budget.weekly.target_at_reset` | no | Weekly `used_percentage` to land on exactly at the weekly reset (default `null` = no weekly pacing, an explicit `null` is the same as absent; number in (0, 100]). When set, workers = min(5-hour fit, weekly fit), weekly fit = `floor((headroom per hour to the target - orchestrator weekly rate) / worker weekly rate)` with the hours to the reset floored at 15 minutes; a weekly fit below 1 is `PACE-WAIT` with `wake_at` = when one worker fits again. Without a `five_hour` window the weekly fit alone sizes the round; with no target either, the weekly lines gate and `max_workers` caps the round |
| `usage_budget.rates.orchestrator_pct_per_hour` | no | Calibrated 5-hour percentage points per hour the orchestrator session itself burns (default `6`; `> 0`) |
| `usage_budget.rates.worker_pct_per_hour` | no | Calibrated 5-hour percentage points per hour one worker burns (default `7`; `> 0`) |
| `usage_budget.rates.orchestrator_weekly_pct_per_hour` | no | Weekly percentage points per hour the orchestrator burns, used by `target_at_reset` pacing; a valid measured rate wins over it (default `0.1`; `> 0`). The default is a starting point, to be replaced by probe calibration (#1201) |
| `usage_budget.rates.worker_weekly_pct_per_hour` | no | Weekly percentage points per hour one worker burns, used by `target_at_reset` pacing; a valid measured rate wins over it (default `0.15`; `> 0`). The default is a starting point, to be replaced by probe calibration (#1201) |
| `usage_budget.max_workers` | no | Ceiling on the worker count `GO` returns, together with `parallel_max` (the smaller wins; default `4`; integer `>= 1`) |
| `usage_budget.coordination.role` | no | `solo`, `manager` or `peer`: how this session shares one budget with others (default `solo`) |
| `usage_budget.coordination.manager_session` | no | Session that grants worker slots; required non-empty when `role` is `peer` (default `null`) |
| `usage_budget.coordination.peer_floor` | no | Worker slots a peer may always use without a grant (default `1`; integer `>= 0`) |
| `ci_capacity` | no | Optional lowering of the worker count from the consumer's own CI runner capacity, read by `scripts/ci-capacity-read.ts` and judged by `usage-budget.ts --ci-capacity`; off by default. **Resolution**: absent block or key ⇒ the defaults below; a wrong type throws with the key path (sub-keys: enabled, lanes, queue_allowance) |
| `ci_capacity.enabled` | no | Master switch for the forge reader (default `false`; `false` ⇒ it prints nothing and the worker count is the token budget's) |
| `ci_capacity.lanes` | no | Runner labels the consumer's PR gate needs (default `[]`; an empty list reads nothing). A runner or queued job counts when it carries any of them; no label is assumed by the plugin |
| `ci_capacity.queue_allowance` | no | Backlog beyond idle runners tolerated before workers are lowered, and the workers allowed once every runner in the lanes is busy (default `1`; integer `>= 0`) |
| `claim_labels` | no | Contract claim labels the campaign adds to an issue at implementer dispatch (`scripts/claim-labels.ts`) and releases on `stop` and on a drained queue, for issues with no open PR in flight (for example `["in-progress:claude"]`; default `[]` = off; read by `scripts/release-claims.ts`). **Resolution**: absent key ⇒ the default; a wrong type throws with the key path |
| `catchup` | no | Pacing preset of `/blackhole catchup` mode (ADR-054): the keys below. Never read by `run`. **Resolution**: absent block or key ⇒ the default; a wrong type throws with the key path |
| `catchup.weekly_target_pct` | no | Share of the weekly allowance the pace floor reaches at the reset; the floor grows linearly over all 168 h of the week (default `80`; number in (0, 100]). **Resolution**: absent block or key ⇒ the default; a wrong type or range throws with the key path |
| `catchup.five_hour.no_spawn_at` | no | 5-hour `used_percentage` at or above which a catchup spawns no new worker (default `75`; must be `<` `stop_workers_at`). **Resolution**: absent block or key ⇒ the default; a wrong type throws with the key path |
| `catchup.five_hour.stop_workers_at` | no | 5-hour `used_percentage` at or above which a catchup stops its workers (default `80`; number in (0, 100]). **Resolution**: absent block or key ⇒ the default; a wrong type throws with the key path |
| `catchup.lane` | no | Name of this account's lane, matching `[a-z0-9][a-z0-9._-]*` (default `null` = unset; read by `scripts/claim.ts`, `forge-sync` and the status surfaces). **Resolution**: absent block or key ⇒ the default; a wrong type throws with the key path |
| `catchup.claim_lease_hours` | no | Hours a lane claim stays valid (default `24`; number > 0; read by `scripts/claim.ts` and `forge-sync`). **Resolution**: absent block or key ⇒ the default; a wrong type throws with the key path |
| `resource_policy.carveout_recorded_at` | no | ISO8601 timestamp when the resource-policy carveout block was last recorded |
| `stop_budget_cleared_at` | no | ISO8601 timestamp when the campaign stop-budget gate was cleared by the owner/coordinator (audit trail) |
| `issue_484_disposition` | no | Campaign-specific disposition record for issue #484 (or analogous parked-issue pin). **Resolution**: absent block ⇒ no special disposition |
| `issue_484_disposition.status` | no | Disposition status (e.g. `parked` — never dispatch, campaign drains around it) |
| `issue_484_disposition.reaffirmed_at` | no | ISO date when the disposition was last reaffirmed |
| `issue_484_disposition.by` | no | Freeform provenance for who reaffirmed the disposition |
| `issue_484_disposition.note` | no | Human-readable note on how the disposition affects campaign scope (e.g. excluded from "until empty") |

**`docs_governance` contract note**: **Resolution**: absent block, absent field, or explicit
`false` ⇒ inert. When the block is absent, or
`docs_governance.enabled` resolves to anything other than the literal `true` (see the SSOT row
above), every dependent feature (reviewer
V-ADA companion-file audit, router `docs_impact` flag, write-governance remedies —
`docs_impact`'s dispatch consumer is `src/references/orchestrator-delegation.md` §
Route-derived dispatch (#177); the reviewer companion-file audit's consumer is
`reviewer.md` § Companion-File Audit (above); write-governance's consumers are
`implementer.md`/`planner.md` (above)) MUST be a no-op and current behavior is
preserved exactly. Any future issue that wires a dependent feature must check this flag
(and its relevant sub-flag) before acting — the same obligation
`adaptive_routing` already imposes on router-agent routing.
`docs_governance.severity_overrides` may only **escalate** a WARN-default
docs-governance V-code to `BLOCK` per repo; it must never de-escalate the
pre-existing `V-DOCSYNC-01` `BLOCK` severity.

**`kaizen` contract note**: **Resolution**: absent block, or `kaizen.enabled` explicitly `false`
⇒ inert. When the block is absent, or `kaizen.enabled` is
`false`, the kaizen improvement-hunt loop (ADR-006) MUST be a no-op and
current behavior is preserved exactly — no hunt wave dispatches, no hunter
agent spawns, `hunt_state` is never written. `kaizen.min_priority` may only be
**raised** above its default of `30`, never lowered below the `V-PARETO-02` threshold. This is the same obligation `docs_governance.enabled` and
`adaptive_routing` already impose on their respective features.

**`incident_mode` contract note**: **Resolution**: absent block, or `incident_mode.enabled`
explicitly `false` ⇒ inert. When the block is absent, or
`incident_mode.enabled` is `false`, the incident-mode posture (`orchestrator-runtime.md` §
Incident Mode) MUST be a no-op and current behavior is preserved exactly — no
`parallel_max` override, no strict `migration_slot` enforcement beyond the
existing baseline rule, no pausing of `phase-loop.md` § Continuous Discovery of
Improvements. This is the same obligation `docs_governance.enabled` and
`kaizen.enabled` already impose on their respective features.

**`autonomy` contract note**: **Resolution**: never inert as a whole (ADR-014) — absent block or
an unset sub-field falls back to that sub-field's own default; there is no master off switch.
Autonomy is unconditionally active — there is no master
switch and no "off" state for the block as a whole. The confidence-gate kernel
([confidence-gates.md](confidence-gates.md)) always runs its composite math. When the block is
absent, or an individual sub-field is unset, that sub-field's own default applies
(`confidence_threshold: 80`, `design_dominance_delta: 30`, `design_autonomy: true`,
`analyze_routing: true`, `brainstorm_routing: false`, `never_bypass:
["destructive", "credentials", "epic-go-no-go"]`) — each sub-flag independently gates only its
own feature's *dispatch* (design tier, analyze routing, brainstorm routing), never the kernel
itself.

**`merge_mode` contract note**: **Resolution**: no default (ruling R-002) — absent or invalid ⇒
bootstrap-blocking, never a silent fallback. This is the one field that deliberately breaks the
"absent block/field = current behavior preserved" pattern every contract note above follows —
`merge_mode` has **no default** (ruling R-002, `documentation/reference/product-principles.md`).
An absent or invalid value is a bootstrap-blocking condition: `coordinator.md` § Bootstrap
preflight's trigger-condition list treats it as a fourth condition forcing the full campaign
launch configuration gate, and `renderConfigSummary` (`scripts/lib/campaign-status/dashboard.ts`)
renders an explicit `unset (bootstrap-blocking)` sentinel rather than silently reporting
`"immediate"`. Once set, `immediate`/`gated-batch`/`leave-open` semantics are exactly as
described in the field table row above — this note governs only what happens when the field is
missing, not the three values' runtime behavior.

Stacking is the only behavior: no key controls it (`queue-dag.md` Step 3b). `merge_mode` picks
only when a parent PR merges and what its stacked children wait for (`merge-gate.md` § 7); under
`leave-open`, "delivered" is not "merged", so an LGTM'd open PR does not clear an overlap and the
overlapping issue stays stacked on it.

**`display_targets` contract note**: **Resolution**: absent or empty array ⇒ inert (visual
evidence gate is a no-op end to end). When the array is absent or empty, the visual evidence
gate (ADR-018) is a no-op end to end — the implementer's Visual Evidence Capture step never
runs and the reviewer's Visual Evidence Audit never fires, and current behavior is preserved
exactly. This is the same discipline `docs_governance`/`kaizen`/`incident_mode` already impose
on their own features above.

**Scope filter composition** (both fields optional — unset means no filter on that axis):

| `scope_milestone` | `scope_labels` | Effective filter |
|-------------------|----------------|------------------|
| unset | unset | All open issues (default) |
| set | unset | Milestone match only |
| unset | set | All labels present |
| set | set | Milestone match **AND** all labels present |

`issue_labels.campaign` is independent of `scope_labels` — scope labels are additive
filters for ingest/completion, not auto-merged into scope unless listed in `scope_labels`.

Runtime state files (gitignored in consumer repos):

| File | Purpose |
|------|---------|
| `queue.json` | Issue DAG and scheduling |
| `findings-ledger.json` | V-code findings SSOT |
| `plans/<issue>.md` | Implementation plans |
| `campaign-checkpoint.md` | Resume summary (see `checkpoint-protocol.md`) |
| `owner-decisions.json` | The owner's decisions, one dated line each (`status-page.md` § What the orchestrator records) |
| `pending-decisions.json` | Owner questions parked for the decide round, `/blackhole decide` (`decision-parking.md`) |

On first bootstrap, copy template to runtime if missing fields — do not
overwrite existing runtime config without user confirmation.

### Environment Variable Overrides

Every field above is a `.blackhole/config.json` key. The one tunable that deliberately is not:

| Variable | Default | Description |
|----------|---------|--------------|
| `BLACKHOLE_ARCHIVE_SNAPSHOT_RETENTION` | `2` | Number of pre-mutation `queue.json` / `findings-ledger.json` snapshots kept per file in `.blackhole/archive/`; older ones are deleted when a new snapshot is taken. Any non-positive-integer value (unset, non-numeric, `0`, negative, fractional) falls back to the default, so at least one snapshot always survives. |

## usage_budget

The `usage_budget` keys above are frozen: later work may add behavior that reads them but does not
rename, remove or retype one. The executive-summary launch gate's Budget row may read
`usage_budget.enabled`, `usage_budget.five_hour.*`, `usage_budget.weekly.*` and
`usage_budget.max_workers`; the `rates` and `coordination` keys are pacing internals.
`usage_budget.weekly.target_at_reset`, `usage_budget.rates.orchestrator_weekly_pct_per_hour` and
`usage_budget.rates.worker_weekly_pct_per_hour` (issue #1200) join the frozen set on the same terms;
the verdict `PACE-WAIT` (drain, wake at `wake_at`, resume) is part of the gate's output contract. The gate is
`scripts/usage-budget.ts`; it sits beside the pace gate (`resource_policy.pace`), which is unchanged.

`usage-budget.ts` also takes an optional CI-capacity reading, `--ci-capacity
'{"idle_runners":n,"queued_jobs":n[,"busy_runners":n][,"queue_allowance":n]}'` or `--ci-capacity-file <path>`.
`busy_runners` and `queue_allowance` are optional fields of the reading; `queue_allowance` (default 1, or the
config's) is the backlog tolerated beyond idle runners. Each queued job beyond idle runners plus the allowance
lowers `workers` by one; with `idle_runners` 0 and `busy_runners` above 0 (every runner busy) `workers` is also
capped at `idle_runners + queue_allowance` before anything queues. Both terms keep at least one worker and never
go above the token-budget count. It fails open: no reading, a flag without a value, both flags together, an
unreadable file or a malformed reading warns on stderr and leaves the count unchanged.

`scripts/ci-capacity-read.ts` produces that reading from the forge when `ci_capacity.enabled` is `true`:
`GET repos/{repo}/actions/runners` (online runners carrying a lane label, split by `busy`), `GET
repos/{repo}/actions/runs?status=queued` and `?status=in_progress` (a running run can still hold queued jobs), and
the jobs of the first ten runs, queued runs first (a queued run past ten counts as one queued job, an in-progress
run past ten counts none). GitHub only; any other forge, a missing `repo`, a forge error or an unexpected payload
prints nothing and a warning, exit 0. The caller supplies the lanes; the plugin assumes no runner layout.

The runner read is repo-level and needs a token with admin rights on the repository: runners registered at
organization level are not counted, and a `403` is no reading (a warning, the worker count unchanged). The reader makes
up to 13 sequential `gh api` calls, so the script bounds the whole read to 60 s itself (`--timeout-ms` overrides it; no
GNU `timeout` needed); a timeout is a warning and no reading, the worker count unchanged.

## catchup

The `catchup` block is read only by `catchup` mode, `scripts/usage-budget.ts --floor`,
`scripts/pace-floor.ts` and the launch gate's Pacing row; it never changes `run`. The invocation
overrides (`--floor`, `--no-spawn-at`, `--stop-workers-at`, `--lane`) never write it. `lane` is also read by
`scripts/claim.ts`, `forge-sync` and the status surfaces. `catchup.pct_per_weekday` and
`catchup.day_end_hour` were removed; a block that still carries either is rejected with an error naming the
replacement.

## Status page coverage

Every top-level block registered in the field table above names the status page dataset that
shows it (`STATUS_DATASET_IDS`, `scripts/lib/campaign-status/data.ts`), and for the `config`,
`run` and `budget` datasets the rows (comma-separated); or `none` with the reason the page leaves
it out. A sub-block another panel shows (`usage_budget.coordination`) adds a row of its own. A PR that adds a block
adds its row here, and a new panel bumps the template's `bh-template-version`
(`status-page.md` § Refresh procedure). `bun run verify` fails (`V-CONFIG-03`,
`scripts/checks/status-coverage.check.ts`) on a block with no row, a dataset the plugin does not
write or no template panel draws, a row the dataset does not emit, or `none` without a reason.

The `Launch summary` column holds the same promise for the launch gate (`launch-gate.md` § The
summary): each top-level block names every launch summary row whose `LAUNCH_ROW_CLAIMS`
(`scripts/lib/campaign-status/launch-config-rows.ts`) cover it, or `Other config` when no row does;
a sub-block may use `—`. `V-CONFIG-03` also fails on an empty cell, a label that is no launch
summary row, a row that does not claim the block, `Other config` on a claimed block, or a claim the
cell leaves out.

| Block | Status page | Row | Reason | Launch summary |
|-------|-------------|-----|--------|----------------|
| `repo` | `links` | — | The quick links (open PRs, issues, CI runs) are built from it | Scope |
| `target_branch` | none | — | The merge target; every PR card already links its PR on the forge | Other config |
| `forge` | `links` | — | Picks the forge the quick links point at | Other config |
| `parallel_max` | `config` | Concurrency | | Budget |
| `pareto_max_age_days` | none | — | Staleness threshold of the re-score; nothing the owner acts on | Other config |
| `claim_labels` | none | — | Contract labels claimed at implementer dispatch (`scripts/claim-labels.ts`) and released on stop; the stop report lists them, not the page | Other config |
| `scratchpad_dir` | none | — | Where worktrees live on this machine; nothing the owner acts on | Other config |
| `size_label_prefix` | none | — | Label spelling the sync reads; sizes appear on no panel | Other config |
| `default_touch_paths` | none | — | Per-issue plan scope; each plan carries its own | Other config |
| `issue_labels` | none | — | Label put on issues the run files; the filed issues show on the board | Other config |
| `scope_milestone` | `config` | Issue filter | | Scope |
| `scope_labels` | `config` | Issue filter | | Scope |
| `auto_sync` | none | — | Sync cadence; its result is the board itself and the `forge not checked` header | Other config |
| `adaptive_routing` | none | — | Per-issue routing internals; the text dashboard's Routing section shows each route | Other config |
| `router_confidence_thresholds` | none | — | Routing internals, as `adaptive_routing` | Other config |
| `docs_governance` | `config` | Docs governance | | Kaizen and staging |
| `docs_governance.write_governance` | `run` | Doc carry | Artifacts promised vs staged vs carried; `off` when governance is off | Kaizen and staging |
| `kaizen` | `config` | Kaizen | | Kaizen and staging |
| `incident_mode` | `config` | Concurrency | | Other config |
| `autonomy` | `config` | Autonomy | | Autonomy |
| `worker_model_policy` | `config` | Workers | | Other config |
| `worker_effort_policy` | `config` | Workers | | Other config |
| `decisions` | `run` | Decisions | | Decisions |
| `sleep_mode` | `run` | Decisions | Retired: the row names it as ignored | Decisions |
| `entry_mode` | none | — | Session layout fixed at bootstrap; the Run route row names the pattern that runs | Other config |
| `merge_mode` | `config` | Merge mode | | Merge |
| `display_targets` | `config` | Verification | | Other config |
| `merge_ready` | none | — | Read by the merge step's CI verdict only; the merge decision it feeds is already shown on the PR cards | Other config |
| `status_page` | `streams` | — | Configures the page itself: its streams and links; `enabled: false` publishes no page | Status page |
| `campaign_scope` | `scope` | — | | Other config |
| `wave_scheduling` | none | — | How a wave is sharded; the board shows what is in flight | Wave scheduling |
| `resource_policy` | `config` | Verification | The test-lock carve-out; the host pace line is on the `--html` Host section | Resource policy |
| `usage_budget` | `budget` | Workers allowed, Weekly, Weekly target, Pace | Verdict, weekly %, target, pace against the target and reset | Pacing, Peers |
| `usage_budget.coordination` | `run` | Coordination | | Peers |
| `ci_capacity` | none | — | A pacing input: the worker cap it causes shows in the usage verdict's reasons | CI capacity |
| `catchup` | none | — | The pacing preset is shown on the launch summary's Pacing row; the budget panel keeps the verdict | Pacing |
| `stop_budget_cleared_at` | none | — | Audit timestamp of a past owner action | Other config |
| `issue_484_disposition` | none | — | One campaign's historical pin; the parked issue shows on the board | Other config |
| `roadmap` | none | — | Writes its own document at `roadmap.path`; showing its top on the page and in `campaign-status.ts` is a later slice | Other config |
<!-- GENERATED by scripts/build.ts from src/references/config-template.md — do not hand-edit -->

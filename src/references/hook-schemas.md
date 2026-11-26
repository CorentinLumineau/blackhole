# Hook Schemas

Cursor SubagentStop hook install/behavior specs and the PreToolUse hook-events schema for campaign worker agents. Split out of [`worker-schemas.md`](worker-schemas.md) (issue #473) to restore `V-CONTENTGATE-01` headroom — these sections are optional/harness-level installs, not part of the worker JSON return contract that file documents.

## SubagentStop hook (Cursor)

**Install:** Merge the `hooks` block from [`templates/hooks/subagent-stop-validate.json`](../../templates/hooks/subagent-stop-validate.json) into your project's `.cursor/hooks.json`. Requires `bun` on `PATH`; hook `command` paths are relative to the repo root.

**Behavior:** On `subagentStop`, when the hook `matcher` hits `planner`, `implementer`, `reviewer`, `router`, `investigator`, or `hunter`, Cursor runs `bun run scripts/validate-worker-json.ts --hook` with the stop payload on **stdin**. Non-zero exit blocks handoff (`failClosed: true`). Subagent stops with `status` `error` or `aborted`, or non-campaign subagents, pass through (exit `0`).

**Extraction order:** Worker JSON is parsed from (1) a fenced ` ```json ` block in `summary`, (2) the latest-ending brace-balanced `{...}` object in `summary` that is not empty — a trailing `{}` in prose is skipped, while a non-empty trailing object wins even without `status` and then fails validation, or (3) the last 200 KB of `agent_transcript_path` when readable, read as JSONL: the last assistant turn's `SubagentHandback` input, then that turn's text, then an earlier turn's `SubagentHandback` input. The raw tail is scanned as plain text only when it holds no assistant envelope; otherwise, when none of those carries JSON, the hook fails rather than returning a transcript envelope. Tier 3 is best-effort only: an unverified Cursor community bug report records `agent_transcript_path` arriving null for background subagents, so this tier can silently yield nothing even when correctly named and read.

**Exit codes:** `0` = valid or pass-through; `1` = validation or JSON extraction failure; `2` = hook stdin JSON parse failure.

### Orchestrator / harness fallback (non-Cursor)

Harnesses without Cursor hooks can validate worker output before mutating `queue.json`:

```bash
# Full structural validation (preferred)
bun run scripts/validate-worker-json.ts --role planner --file handoff.json
bun run scripts/validate-worker-json.ts --role implementer --json '{"status":"complete",...}'

# Quick spot-check only (not a substitute for full validation)
jq -e '.status and .plan_path' handoff.json
```

Fixture pairs for each role live under [`fixtures/worker-json/`](../../fixtures/worker-json/). Validator implementation: [`scripts/validate-worker-json.ts`](../../scripts/validate-worker-json.ts).

## SubagentStop resume hook (Cursor, #154)

**Install:** Merge the `hooks` block from [`templates/hooks/subagent-stop-resume.json`](../../templates/hooks/subagent-stop-resume.json) **after** the validate hook entry in `.cursor/hooks.json`. Install guide: [`templates/hooks/README.md`](../../templates/hooks/README.md).

**Behavior (Option C — hybrid):** On `subagentStop`, when the hook `matcher` hits `orchestrator`, `router`, `planner`, `implementer`, `reviewer`, or `investigator`, Cursor runs `bun run scripts/campaign-resume-signal.ts --hook` with the stop payload on **stdin**. The hook always evaluates resume gates first, then atomically upserts `.blackhole/resume-request.json`. Exit is always `0` (`failClosed: false`).

| Stopping agent | `followup_message` | File write |
|----------------|-------------------|------------|
| `orchestrator` | **Yes** — coordinator doorbell only | `resume-request.json` when gates pass |
| `router` / `planner` / `implementer` / `reviewer` / `investigator` | **No** | `resume-request.json` only when **stale barrier** detected |
| Non-campaign subagents | No | No |
| `status: error` / `aborted` | No | No |

**Ordering rule:** validate hook entry **must** appear first in the `subagentStop` array.

### Resume gates (all must pass)

1. `.blackhole/queue.json` exists and parses as JSON.
2. **Work remains:** at least one issue with `status: ready` or `status: in-flight`, or checkpoint `## Ready set` non-empty, or checkpoint `## In-flight workers` non-empty.
3. **No user gate:** no issue `notes` matching `awaiting-user`, `awaiting-plan`, or `awaiting-design` while `status` is `blocked` or `in-flight`.
4. **Orchestrator doorbell:** stdout `followup_message` emitted only when `subagent_type` resolves to `orchestrator` and file write succeeds.
5. **Stale barrier (workers only):** checkpoint `## In-flight workers` has active entries **and** stopping worker JSON validates — writes file with `reason: stale_barrier`, no `followup_message`.

Hook **must not** mutate `queue.json`, `findings-ledger.json`, or plan files.

### `.blackhole/resume-request.json` schema

```json
{
  "version": 1,
  "requested_at": "2026-07-09T12:00:00.000Z",
  "reason": "orchestrator_turn_complete",
  "target": "coordinator",
  "dedupe_key": "turn-12",
  "coalesce_until": "2026-07-09T12:00:05.000Z",
  "stopping_agent": "orchestrator",
  "queue_refreshed_at": "2026-07-09T11:59:00.000Z",
  "orchestrator_turn_id": 12
}
```

| Field | Values | Required |
|-------|--------|----------|
| `version` | `1` | yes |
| `requested_at` | ISO-8601 | yes |
| `reason` | `orchestrator_turn_complete` \| `stale_barrier` | yes |
| `target` | `coordinator` | yes |
| `dedupe_key` | string | yes — `turn-{id}` or `stale-wave-{turn}-{issue-set-hash}` |
| `coalesce_until` | ISO-8601 | yes — now + 5s; concurrent stops merge into one record |
| `stopping_agent` | agent role string | yes |
| `queue_refreshed_at` | string | yes |
| `orchestrator_turn_id` | number \| null | when checkpoint present |

**Write protocol:** read-modify-write via `.blackhole/resume-request.json.tmp` + `mv`. If existing record has `coalesce_until` in the future and same `dedupe_key`, refresh timestamp only (dedup). Coordinator **acks** by deleting the file or writing `{ "acked_at": ... }` after successful resume.

**Doorbell message (orchestrator stop only):**

```json
{
  "followup_message": "Blackhole: pending resume-request.json. Run coordinator turn flow — bun run \"<plugin root>/scripts/campaign-status.ts\" (full dashboard), then resume orchestrator with interrupt:false if work remains and queue is not user-blocked. Ack resume-request.json after resume."
}
```

### Manual test runbook (WAVE spawn)

| Step | Actor | Action | Expected |
|------|-------|--------|----------|
| 1 | maintainer | Merge validate + resume hook fragments into `.cursor/hooks.json` | Hooks tab shows both entries |
| 2 | coordinator | Phase 0 + spawn orchestrator `run_in_background: true` | orchestrator live |
| 3 | orchestrator | WAVE 0: spawn 2–4 `router` workers, barrier-wait, triage, turn-end | checkpoint workers empty |
| 4 | orchestrator | END TURN with ready work remaining | `subagentStop` fires |
| 5 | resume hook | writes `resume-request.json`, emits coordinator `followup_message` | file present; coordinator wakes |
| 6 | coordinator | `bun run scripts/campaign-status.ts` → full dashboard → resume orchestrator | next turn without user chat |
| 7 | coordinator | delete/ack `resume-request.json` | file absent |
| 8 | negative | set `notes: awaiting-plan-approval` on in-flight issue, repeat step 4 | hook exits 0, **no** file, **no** followup |

```bash
bun test scripts/campaign-resume-signal.test.ts
# Manual: after orchestrator turn-end with work remaining:
test -f .blackhole/resume-request.json && jq -e '.target == "coordinator"' .blackhole/resume-request.json
```

Fixtures: [`fixtures/resume-signal/`](../../fixtures/resume-signal/). Implementation: [`scripts/campaign-resume-signal.ts`](../../scripts/campaign-resume-signal.ts).

## PreToolUse hook events (removed, ADR-065)

No hook that can deny a tool call ships in any harness build ([ADR-065](../../documentation/decisions/ADR-065-no-blocking-pretooluse-guards.md), which supersedes ADR-061 and ADR-064). Claude Code auto mode is the gate; the risks the guards covered map to non-hook gates listed in that ADR (`scripts/lib/state-write-guard.ts` validation with the archive snapshot, worktree-per-worker, the reviewer's `V-SCOPE-02`/`V-SEC-03`/`V-SEC-11`/`V-SEC-14` audits, CI `verify`).

**What ships:** the Claude marketplace bundle's `hooks/hooks.json` registers one hook, the `SessionStart` export of `BLACKHOLE_PLUGIN_ROOT` (`scripts/lib/build/claude-plugin-runtime.ts`). The plugin bundles' `hooks/patterns/file-patterns.json` is data for the pre-`git add` staging gate (`V-SEC-11`), not a hook: nothing registers or runs it. `scripts/checks/hooks.check.ts` fails the build if any built `hooks.json` registers a `PreToolUse` event or any built tree ships one of the retired validators (`V-NOGUARD-01`), and validates the pattern data (`V-HOOKPAT-01`). `bun run build` also removes the guard entries earlier builds merged into this repo's `.claude/settings.json`, leaving every other key untouched.

**Installed copies:** a plugin cache is version-keyed, so an installation keeps the old guards until the plugin is updated or reinstalled.

**`.blackhole/hook-events/`:** nothing writes this directory any more. The Triage reader (`scripts/lib/hook-event-triage.ts`), the `V-HOOK-01..03` codes and the plugin-drift hook-source scan stay in place, inert, until the follow-up slice of issue #1644 retires them.

## PermissionDenied hook (Claude Code, not installed)

A real, currently-shipped Claude Code hook event — confirmed via `anthropics/claude-code#41261`, which quotes the shipped changelog verbatim. Blackhole does not register or consume it: no `hooks.json` entry, no ledger wiring. Documented here only because its firing condition is easy to over-infer as a cross-hook denial signal, and it is not one: it fires **only** after Claude Code's own auto-mode permission classifier denies a call. It **never** fires after a PreToolUse hook's own deny decision — not blackhole's own validators (the retired validators, § PreToolUse hook events above), and not a foreign, co-installed plugin's. It was evaluated as the one plausible indirect channel for cross-hook denial visibility and ruled out on exactly this ground (`documentation/investigations/research-cross-plugin-hook-denial-visibility.md`) — it fires from a different decision path than the PreToolUse contract these hooks share, not as an escalation from it.

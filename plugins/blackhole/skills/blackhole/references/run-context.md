# Run Context

Blackhole runs on hosts and surfaces that offer different tools: a local Claude Code CLI, a
Claude Code cloud session, a Claude Project thread, a headless `claude -p` job, the Cursor
desktop agent and Cursor Cloud. Run-context resolution
(`documentation/decisions/ADR-046-run-context-resolution.md`) records what this run can do and
routes the campaign from that record, once, at bootstrap. No agent prompt should assume a host
capability; it reads `.blackhole/run-context.json` instead.

## Resolve it

Before the configuration gate on every bootstrap and every resume, run:

```bash
bun run scripts/run-context.ts --tools <comma list>
```

`--tools` lists what is in **your own tool list**, which no script can see:

| Tool | Report it when your tool list has |
|------|-----------------------------------|
| `workflow` | The `Workflow` tool |
| `agent` | `Agent` / `Task` subagent spawning |
| `background-agents` | Notifications when a background subagent finishes |
| `ask-user-question` | `AskUserQuestion` (Claude Code) |
| `ask-question` | `AskQuestion` / `cursor/ask_question` (Cursor) |
| `ask-decision` | A Project decision card (`ask_decision`) |
| `github-mcp` | GitHub MCP tools (`mcp__github__*`) |
| `pr-subscriptions` | PR activity events delivered into the session |
| `routines` | Scheduled triggers the session can create |
| `usage-probe` | A harness usage tool (e.g. `get_usage`) that reports the 5-hour and weekly rate-limit usage |

The script reads the rest from the environment (host, surface, whether the disk survives the
run) and from `gh auth status`. Pass `--host`, `--surface` or `--persistent-disk yes|no` only
when detection is wrong or impossible (Cursor Cloud, for example, exposes no reliable marker).
Each field in the written record carries its source: `env`, `probe`, `agent` or `derived`.

## Refuse when a capability is missing

Exit `1` means a capability the campaign cannot start without is absent; every `missing:` line
names it. Stop and tell the user exactly those lines. Do not start a campaign around a gap. Exit
`2` is a malformed call. Each `warn:` line names a degradation the run accepts; restate it once
in the launch summary.

## Routing table

| Run context | Pattern | Questions | CI wait | State |
|-------------|---------|-----------|---------|-------|
| Claude Project thread with fan-out and a question channel | P (`project-thread-mode.md`) | ask-decision | PR events when offered, else poll | `branch` |
| Fan-out + completion events + a question channel, Claude Code | C (`claude-code-native.md`) | First of ask-decision, AskUserQuestion, chat | PR events when offered, else poll | `local` when the disk persists, else `branch` |
| Same, Cursor | C-lite (`multitask-mode.md` § Cursor Pattern C-lite) | First of AskQuestion, chat | As above | As above |
| Anything less | B (`multitask-mode.md`) | As above; `none` when headless | As above | As above |

Usage probe: when `usage_budget.enabled` is `true` in `.blackhole/config.json` and `usage-probe` is not reported, the route carries one warning (usage-aware pacing falls back to `parallel_max`); it is never a `missing` entry and never blocks a start.

Usage sources, in probe order. Both end in the one rate-limit cache (`resource_policy.pace.cache_path`, default `~/.claude/cache/rate-limits.json`) that `pace-gate.ts` and `usage-budget.ts` read when no `--usage` is passed:

1. **Statusline cache** (local Claude Code): the statusline command writes its stdin payload's `rate_limits` there (`config-template.md` § `resource_policy.pace.cache_path`). Use it when it is present and fresh.
2. **Remote session events** (Claude cloud and Remote sessions, where no statusline runs): before each spawn round, read the newest `rate_limit_event` with the `claude-code-remote` MCP `list_events` tool (`kinds: ["rate_limit_event"]`) and pipe its JSON to `bun run scripts/usage-probe.ts --from-events -`. The script takes one event or the tool's `{"ccr":{"data":[...]}}` wrapper (newest event wins), turns `unifiedWindows.<window>.utilization` (0-1) into `used_percentage` and `resetsAt` into `resets_at`, drops a window past its reset, and writes the cache dated to the event, so the readers' max-age check measures the reading's age. It prints the written windows and `age_seconds`. Exit `1` means the event had no current window (nothing written); exit `2` is malformed input. A plan with no 5-hour window reports only `seven_day`. `get_session` gives no percentage, so it is not a source.

Schedule: `routine` when the session can create routines (kaizen waves and CI check-ins become
routines, `project-thread-mode.md` § Scheduling), else `turn`.

State store: `branch` means the disk is reclaimed after the session, so campaign state lives on
the `blackhole/state` branch: pull it right after this resolution and before reading any state,
push it at every turn end (`state-branch.md`). It also turns off the steps that only make sense
on a machine that keeps its plugin cache (`orchestrator-runtime.md` § Session resume & recovery,
step 5).

Forge channel: `gh` when authenticated, else a token in `GH_TOKEN`/`GITHUB_TOKEN` (`rest`), else
GitHub MCP tools (`mcp`). With none of them the campaign cannot sync and bootstrap refuses. On
`rest` or `mcp`, every `gh` porcelain command in the playbooks runs through its row in
`forge-channels.md` instead.

`fixtures/run-context/` holds one resolved example per run type; `scripts/lib/run-context.ts`
is the table's only implementation.
<!-- GENERATED by scripts/build.ts from src/references/run-context.md — do not hand-edit -->

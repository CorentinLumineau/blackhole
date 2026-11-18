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
bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/run-context.ts --tools <comma list>
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

Usage source per host (`scripts/lib/usage-source.ts`, `usageSourceFor`): **Claude** reads the rate-limit cache below; an **unknown** host reads the same cache, since an unsure detection is not evidence the host is not Claude (with no cache its reason starts `host unknown:`); **Cursor** has no readable usage or quota source today, so it gives no reading and a stated reason, which `usage-budget.ts` turns into verdict `unavailable` (`workers` = `parallel_max`), never a silent `GO`. The windows are detected from the reading itself: the ones present in it (the probe writes only the `unifiedWindows` entries the event carries), so a plan with no 5-hour window gates on the weekly window alone, with no config; `usage_budget.windows` can still narrow them (`config-template.md`). `run-context.ts` records the result as `usage: {source, windows, reason}` in `run-context.json` (`source` is `rate-limit-cache` or `none`; `windows` lists `five_hour`/`seven_day`, empty when nothing was read) and prints it as a `usage …` line, so the launch summary can restate it; `status` reads the host recorded there (else the environment's) and shows the windows as its **Usage windows** row.

Claude usage sources, in probe order. All end in the one rate-limit cache (`resource_policy.pace.cache_path`, default `~/.claude/cache/rate-limits.json`) that `pace-gate.ts` and `usage-budget.ts` read when no `--usage` is passed:

1. **Statusline cache** (local Claude Code): the statusline command writes its stdin payload's `rate_limits` there (`config-template.md` § `resource_policy.pace.cache_path`). Use it when it is present and fresh.
2. **Remote session events** (Claude cloud and Remote sessions, where no statusline runs): at every orchestrator turn and every heartbeat, and before each spawn round, pick the most recently updated active session with the `claude-code-remote` MCP `list_sessions` tool (a project coordinator session emits one `rate_limit_event` per turn; a session that has gone quiet gives an old reading), read its newest `rate_limit_event` with `list_events` (`kinds: ["rate_limit_event"]`) and pipe the JSON to `bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/usage-probe.ts --from-events -`. The script takes one event or the tool's `{"ccr":{"data":[...]}}` wrapper (newest event wins), turns `unifiedWindows.<window>.utilization` (0-1) into `used_percentage` and `resetsAt` into `resets_at`, drops a window past its reset, and writes the cache dated to the event's `created_at` (clamped to now when it is in the future), so the readers' max-age check measures the reading's age. It prints the written windows and `age_seconds`. Exit `0` means the cache was written; `1` means the event had no current window (nothing written); `2` is malformed input, including a missing or unparseable `created_at` (nothing written); `3` means the cache or the usage history could not be written (one-line reason on stderr). Each weekly reading is also appended to `usage-history.jsonl` beside the config (`.blackhole/` by default; one line per `observed_at`, newest 200 kept, local only), which the status page's **Pace** row reads. A plan with no 5-hour window reports only `seven_day`. `get_session` gives no percentage, so it is not a source.
3. **Desktop app plan limits** (the Claude desktop app, where no statusline runs and no `rate_limit_event` exists): before each spawn round call the `mcp__ccd_session_mgmt__get_usage` tool (the `usage-probe` tool row above) and pipe its JSON to `bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/usage-probe.ts --from-ccd-usage -`. The script maps the `plan.windows[]` row labelled `5-hour limit` to `five_hour` and `Weekly · all models` to `seven_day`; per-model rows (`Weekly · Opus`) are ignored. `percentUsed` (0-100, anything else exits `2`) becomes `used_percentage`, `resetsAt` (ISO-8601 or epoch seconds) becomes `resets_at`, and a window past its reset is dropped. The payload carries no event time, so the cache is dated now and the call must be repeated each round. The cache `source` is `ccd_get_usage`. Exit codes are as for `--from-events`; exactly one of the two source flags is required. A plan with no 5-hour row reports only `seven_day`.

Any host reads one normalized usage line with `bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/usage.ts [--usage <file>]`. Providers in order: the `--usage` file (a **file path** here, unlike `usage-budget.ts --usage`, which takes inline JSON; it holds the host's usage tool output in the normalized `windows` shape or the desktop shape), the statusline rate-limit cache, then the cache the probe wrote; the first usable reading wins. It prints one JSON line with `plan` (`pro`, `max`, `none` or `unknown`), `windows` (`five_hour`, `seven_day`, per-model weekly such as `seven_day_opus`, each with `used_pct` and `resets_at`), `extra_usage`, `source` (`usage-file`, `rate-limit-cache` or `none`), `provider` (`usage-file`, `statusline`, `probe` or `none`), `read_at` and `reason`. Exit `0` on every reading, including `source: none` (the reason also goes to stderr); `2` on bad usage, an unreadable or malformed `--usage` file, or an invalid config. A file older than `resource_policy.pace.max_age_seconds` is stale and the chain moves on.

Sleep mode: the record also carries `sleep_mode: {enabled, since}` read from `config.json`, and the
run prints `sleep mode on: …` while it is on (`sleep-mode.md` § Launch gate and run context).

Plugin version: when the running plugin is older than the newest `installed_plugins.json` row or
marketplace cache version, the run prints a `warn:` line (advisory, exit code unchanged) and the
record carries `plugin: {running, newest, behind}`.

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

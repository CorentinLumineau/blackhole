---
type: adr
summary: "Every bootstrap and resume resolves a recorded run context (host, surface, persistent disk, forge channels, question channel, fan-out, completion events, PR events, scheduler), each fact tagged with its source, and one routing table in scripts/lib/run-context.ts turns it into pattern, forge channel, question channel, CI wait and state store; bootstrap refuses when a required capability is missing"
status: accepted
review_trigger: "on a new host or surface, or a change to a host's tool list"
created: 2026-10-10
last_updated: 2026-10-10
related:
  - documentation/decisions/ADR-009-claude-marketplace-bundle-isolation.md
---

# ADR-046: Run-context resolution

## Status

Accepted — 2026-10-10 (owner approved the six-phase run-accuracy plan; this is phase 2).

## Context

Blackhole now runs on six materially different surfaces: a local Claude Code CLI, a Claude Code
cloud session, a Claude Project thread, a headless `claude -p` job, the Cursor desktop agent and
Cursor Cloud. They differ in exactly the things the protocol depends on: whether `gh` is
authenticated, whether anyone can answer a question, whether the disk survives the session,
whether background workers report completion, and whether PR events arrive without polling.

Until now each prompt carried its own assumption about the host. `SKILL.md` asked the agent to
judge whether "the harness has a deterministic fan-out primitive", `claude-code-native.md` and
`multitask-mode.md` each kept a per-host capability list, and nothing recorded which one a run
actually used. Two failure modes follow directly: a cloud session, where `gh` is not logged in,
is still told to sync through `gh`, and a run on an ephemeral container keeps campaign state only
on a disk that is reclaimed when the session ends.

## Decision

1. `scripts/run-context.ts` resolves the run context at every bootstrap and resume and writes
   `.blackhole/run-context.json`. The script detects what the environment shows (`CLAUDECODE`,
   `CLAUDE_CODE_REMOTE`, `CLAUDE_CODE_PROJECTS_SESSION`, `CLAUDE_CODE_ENTRYPOINT`, Cursor markers,
   `CI`, token variables, `gh auth status`). The agent passes what only it can see, its own tool
   list, as `--tools`. Each fact carries its source (`env`, `probe`, `agent`, `derived`).
2. `routeRunContext` in `scripts/lib/run-context.ts` is the only routing table. It maps the
   context to a pattern (C, C-lite or B), a forge channel (gh, then token, then MCP), a question
   channel, a CI wait (PR events or poll) and a state store (local or branch).
3. A missing host, fan-out tool or forge channel exits `1` with each gap named, and bootstrap
   refuses to start. Accepted degradations are printed as warnings, never silently absorbed.
4. Prompts cite `run-context.md` for the pattern choice instead of restating host assumptions.

## Alternatives Considered

- **Keep per-prompt judgment.** Zero code, but it leaves both failure modes open: the judgment
  is made from assumptions about a host, never from the run itself, and nothing records it.
- **Detect everything from the environment.** Not possible: a session's tool list (GitHub MCP,
  `AskUserQuestion`, `ask_decision`, `Workflow`, PR subscriptions) is invisible to any process
  the agent starts. The agent reporting it, with the source recorded, is the only honest channel.
- **A config key the owner sets once.** The same repo is campaigned from several surfaces, so a
  static key is wrong on every surface but the one it was written on.

## Consequences

- The resolved route is reproducible and auditable from one file; fixtures under
  `fixtures/run-context/` pin one example per run type.
- The `branch` state store and the non-`gh` forge channels are named by the table before every
  script supports them; until then the route prints a warning for each instead of pretending.
- Cursor Cloud has no reliable environment marker, so its agent passes `--host` and `--surface`.
  A wrong report there yields a wrong route; the source tag makes that visible after the fact.
- A new host or surface is one row in `routeRunContext`, one fixture and one detection rule.

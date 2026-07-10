# Blackhole — Agent Roster & Quick Start

Quick reference for invoking the backlog campaign across agent platforms.

Campaign protocol state (queue, ledger, plans) lives only under `.blackhole/` — see [blackhole-state.md](.cursor/skills/blackhole/references/blackhole-state.md).

## Triggers

| Command | Action |
|---------|--------|
| `/blackhole run` | Start or resume the campaign loop |
| `@blackhole status` | Sync forge and show queue dashboard |
| `@coordinator run the campaign` | Multitask Mode entry (Cursor, Gemini) |
| `/goal run blackhole until empty` | Native background loop (Claude Code, Codex CLI) |

## Skill namespace

**`blackhole`** — modes: `run`, `status`, `handle`, `plan`, `implement`, `review`, `campaign-audit`

Skill entry: [`SKILL.md`](SKILL.md) (skills.sh), [`.cursor/skills/blackhole/SKILL.md`](.cursor/skills/blackhole/SKILL.md) (Cursor), or [`codex-skills/blackhole/SKILL.md`](codex-skills/blackhole/SKILL.md) (Codex).

## Agent roster

| Agent | Role | Trigger |
|-------|------|---------|
| `coordinator` | User intake, blocker routing, Multitask Mode entry | Multitask Mode entry point (Pattern B); manages the background orchestrator and triages chat feedback |
| `orchestrator` | Five-phase loop, worker scheduling, forge sync | Spawned by `coordinator` (or the native `/goal` loop) to run Handle → Plan → Implement → Review → Loop |
| `router` | Issue classification into the `route{}` object (ADR-004) | Spawned by Handle immediately after Dedup (initial pass); re-invoked at re-route checkpoints `clarify-resolved`, `research-landed`, `investigation-landed` |
| `planner` | Touch-paths, plan artifacts | Spawned by the orchestrator's Plan phase for a routed, unblocked issue |
| `implementer` | TDD implementation in isolated worktrees | Spawned by the orchestrator's Implement phase against an approved plan |
| `reviewer` | PR quality and plan-conformance audit | Spawned by the orchestrator's Review phase against an open PR |
| `investigator` | Evidence-gathering for router re-route checkpoints | Handle spawns `investigator` for `research` when `route.needs_research`, or `investigate` when `route.needs_investigation` |
| `hunter` | Read-only kaizen improvement scanner (ADR-006) | Spawned for one hunt wave of one kind (`quickwins`, `best-practices`, `coverage`, `refactor`, `bug`) per spawn during a kaizen campaign |

## Installation

See [README.md](README.md#-installation-paths) for Cursor submodule, Claude marketplace, Codex CLI, and skills.sh setup.

## Maintainer — releases & milestones

Each semver milestone (`v0.4.1`, `v0.4.2`, …) is closed **only** by publishing its matching release via [`.github/skills/create-release/SKILL.md`](.github/skills/create-release/SKILL.md). The CLI backing that skill is [`scripts/release.ts`](scripts/release.ts) — run `bun run release prepare|validate|tag|push vX.Y.Z`. Project rule: [`.cursor/rules/release-milestone-governance.mdc`](.cursor/rules/release-milestone-governance.mdc).

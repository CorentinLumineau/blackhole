# bc-campaign — Agent Roster & Quick Start

Quick reference for invoking the backlog campaign across agent platforms.

## Triggers

| Command | Action |
|---------|--------|
| `/bc-campaign run` | Start or resume the campaign loop |
| `@bc-campaign status` | Sync forge and show queue dashboard |
| `@bc-coordinator run the campaign` | Multitask Mode entry (Cursor) |

## Skill namespace

**`bc-campaign`** — modes: `run`, `status`, `handle`, `plan`, `implement`, `review`, `campaign-audit`

Skill entry: [`SKILL.md`](SKILL.md) (skills.sh) or [`.cursor/skills/bc-campaign/SKILL.md`](.cursor/skills/bc-campaign/SKILL.md) (Cursor).

## Agent roster

| Agent | Role |
|-------|------|
| `bc-coordinator` | User intake, blocker routing, Multitask Mode entry |
| `bc-orchestrator` | Five-phase loop, worker scheduling, forge sync |
| `bc-planner` | Touch-paths, plan artifacts |
| `bc-implementer` | TDD implementation in isolated worktrees |
| `bc-reviewer` | PR quality and plan-conformance audit |
| `bc-synthesizer` | Deduplicate and rank review findings |

## Installation

See [README.md](README.md#-installation-paths) for Cursor submodule, Claude marketplace, and skills.sh setup.

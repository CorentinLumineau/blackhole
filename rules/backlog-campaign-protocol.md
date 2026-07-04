---
description: Backlog campaign protocol — Multitask Mode, five phases, clarify all sizes, never-drop findings
globs:
alwaysApply: true
---

# Backlog Campaign Protocol

When this repo has `.backlog-campaign/config.json` or the user asks to
finish/run the backlog campaign, follow this protocol.

## Entry (Cursor)

- **No `/goal`** — use Multitask Mode: `backlog-coordinator` → spawns
  `backlog-orchestrator` in background
- Skill: `{{AGENT_DIR}}/skills/backlog-campaign/SKILL.md`
- Flow: `{{AGENT_DIR}}/skills/backlog-campaign/references/multitask-mode.md`

Coordinator routes only; orchestrator runs five phases; workers implement.

## Five phases (binding)

Handle → Plan → Implement → Review → Loop.

Playbooks: `{{AGENT_DIR}}/skills/backlog-campaign/references/phase-*.md`

## Clarify — all issue sizes

- `AskQuestion` on product, UX, data, destructive ops, **any ambiguity**
- Size label does **not** skip clarification — see `clarify-gates.md`
- `status: blocked` while waiting on user; no implement workers until unblocked
- Auto-proceed only when AC complete and scope is one reviewable PR

## Split — not only epics

- Split when not one comfortable reviewable PR — see `issue-splitting.md`
- Applies to `size:xs` through `size:xl`
- User sign-off on split plan when non-obvious

## Never drop findings

- Every V-code → `findings-ledger.json`
- Deferral: `gh issue create` first, then `deferred_to_issue`

## Native forge sync

- Automatic at bootstrap and every orchestrator turn — never ask to sync
- New GitHub issues ingested into `queue.json` silently

## Orchestrator discipline

- One PR per issue; coordinator never implements or merges
- File new issues for discoveries (bugs, refactors, quick wins)

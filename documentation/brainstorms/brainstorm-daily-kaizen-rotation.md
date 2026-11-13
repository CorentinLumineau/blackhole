---
type: brainstorm
skill: x-brainstorm
created: 2026-11-13
target: "Daily weekday kaizen rotation across 4 repos"
status: draft
---

# Brainstorm: Daily Weekday Kaizen Rotation

## Problem Statement

Codebase improvement happens only when a campaign is started by hand. Blackhole has 13 hunt
kinds and a full hunt → implement → review loop, and mercure has `/x-improve-hunt`, but neither
has a time trigger. The goal is a continuous-improvement cadence: every workday, one themed
analysis runs across ssl-management, ai/mercure, ai/workflows and perso/blackhole, and turns
verified findings into review-ready PRs that the owner merges.

## Decisions taken in the interview

| Dimension | Decision |
|-----------|----------|
| Output | Full autonomous fix: hunt → issue → implement → review → PR (never merge) |
| Repos | All 4, rolled out in stages (one repo added per week, ssl-management first) |
| Runner | Local Claude desktop scheduled task on the workstation |
| Engine | blackhole (hunter / orchestrator / implementer / reviewer agents, shared ledger) |
| Rotation | Risk-first, fixed per weekday (below) |
| WIP cap | ≤3 open kaizen PRs per repo; at cap, that repo hunts and files issues only |

### Rotation

| Day | Blackhole hunt kinds | Focus |
|-----|----------------------|-------|
| Mon | `bug` | correctness, error handling |
| Tue | `coverage` | test gaps on hot code |
| Wed | `refactor` | duplication, dead code, structure |
| Thu | `perf` + `deps` | hotspots, outdated dependencies |
| Fri | `docs` + `quickwins` | stale docs, cheap wins |

## Requirements

### Must Have
- [ ] F1 Weekday trigger (Mon–Fri, ~07:00 local) runs the day's themed blackhole campaign
- [ ] F3 Full loop per repo: hunt → verify → file issue → implement → reviewer → open PR; never merge
- [ ] F4 WIP cap: ≥3 open kaizen PRs in a repo switches that repo to hunt + file only
- [ ] F5 Dedup every finding against the blackhole ledger and open forge issues before filing
- [ ] N1 Resource safety: repos serialized, `with-test-lock` for every build/test, CI is the verdict;
      a failed memory/load pre-flight gate skips the day and records "skipped (resources)"
- [ ] N2 Bounded run: time budget per repo (~45 min) and agent cap per run
- [ ] N3 Every PR follows its repo's rules: docs in the same PR or `Docs: N/A — reason`,
      conventional commit, no AI attribution, enters the ai-review gate
- [ ] N4 Agent worktrees torn down after each repo; branches never deleted

### Should Have
- [ ] F2 Staged rollout to all 4 repos: week 1 ssl-management, then +1 repo per week
- [ ] F6 Daily digest (findings, issues, PRs, skipped repos and why) published to the
      Blackhole status dashboard

### Could Have
- [ ] F7 `deps` hunt reuses ssl-management `ci-sca` (osv / pnpm-audit) output instead of rescanning
- [ ] Weekly `retrospective` hunt on Friday after the docs/quickwins run

### Won't Have (this iteration)
- Auto-merge — owner merges every PR
- Weekend runs
- Pareto-adaptive rotation — revisit once the ledger holds a few weeks of history
- Gitea CI cron runner — no blackhole agents or local auth on runners; daytime slots saturated

## Constraints
- Runs only while the workstation is on (local scheduled task)
- ZFS-root workstation has OOM'd and hit load 594 under fan-out: no parallel repo runs, no
  full local suites
- Daytime CI slots are saturated: start early so PR CI lands before working hours
- Existing nightly CI (ci-main nightly, ci-sca, appliance scan, Saturday triage) must not be duplicated

## Success Metrics
- Digest produced on ≥4 of 5 workdays
- ≥70% of opened PRs reach `ai-review:LGTM` without manual fixing
- Zero workstation OOM / load-gate trips caused by the run
- Open kaizen PRs stay ≤3 per repo

## Open Questions
1. Trigger shape: one scheduled task that dispatches the day's kind, or five fixed tasks?
2. How does a scheduled task invoke blackhole headlessly (campaign launch form, config block,
   project-thread routines in `project-thread-mode.md`)?
3. What marks a PR as "kaizen" for the WIP count (label, branch prefix, ledger entry)?

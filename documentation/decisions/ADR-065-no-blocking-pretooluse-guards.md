---
type: adr
summary: "No blocking PreToolUse guard ships in any harness build; Claude Code auto mode is the gate, and each risk the guards covered maps to a non-hook gate (state-write-guard.ts with the single writer and archive snapshot, worktree-per-worker with reviewer V-SCOPE-02 and CI verify, reviewer V-SEC-03/11/14 audits, merge-risk needs-chef); supersedes ADR-061 and ADR-064"
status: accepted
supersedes: documentation/decisions/ADR-061-lean-pretooluse-hooks-on-auto-mode.md
review_trigger: "on adding any hook that can deny a tool call, on a harness gaining or losing a native auto mode, or on a campaign incident that a removed guard would have stopped"
created: 2026-11-26
last_updated: 2026-11-26
related:
  - documentation/decisions/ADR-061-lean-pretooluse-hooks-on-auto-mode.md
  - documentation/decisions/ADR-064-orchestrator-scoped-campaign-state-write-trust.md
  - documentation/decisions/ADR-047-hook-containment-scoped-to-campaign-workers.md
  - src/references/blackhole-state.md
  - src/references/hook-schemas.md
---

# ADR-065: No blocking PreToolUse guards; auto mode is the gate

## Status

Accepted - 2026-11-26, owner decision on issue #1644 (with the owner addendum mapping each risk to a non-hook gate). Supersedes ADR-061 and ADR-064 in full.

## Context

ADR-061 kept six PreToolUse guards where auto mode could not cover them. On 2026-11-26 one catchup showed their cost: the campaign state-dir guard denied orchestrator writes (#1370), which needed a `cd`-first workaround and then a security fix round on PR #1641; a shell command quoted inside a `gh api` comment body was read as a write target; ADR-064 added a trust grant whose safety rests on an unverified assumption about how Claude Code reports `agent_type` (#1642). Each fix adds parser code and review rounds to roughly 5.9k lines of guard code and 10.9k lines of guard tests. Claude Code auto mode already prompts before destructive operations.

## Decision

1. No PreToolUse hook that can return a deny decision is registered in any built tree, for Claude Code, Cursor, Codex or Antigravity. Guard code, deny patterns, event logging and the settings merge that installed them are deleted, through the build, not by hand.
2. On Claude Code, auto mode is the gate. Harnesses without auto mode get no blocking guard either; their gate is the prose rule plus the review-time audits below.
3. Non-guard pieces stay: the SessionStart `BLACKHOLE_PLUGIN_ROOT` export (it carries no safety decision) and `file-patterns.json` trimmed to its `sensitiveFiles[]`, the data the staging gate and the reviewer's V-SEC-11 audit read; nothing registers or runs it.
4. ADR-061 (keep rows) and ADR-064 (state write trust grant) are marked superseded. ADR-047's worktree containment and ADR-029/043 guard behaviour are no longer shipped.
5. Replacement gates are not hooks. Each row names the gate, where it runs, and the input that makes it fail (V-UNFALSIFIABLE-01):

| Risk the guard covered | Gate that replaces it | Where it runs | Evidence it can fail |
|---|---|---|---|
| Wipe or corruption of `queue.json` and `findings-ledger.json` | Single-writer invariant; `scripts/lib/state-write-guard.ts` validation before every install; archive snapshot before every mutation | Orchestrator write protocol, `blackhole-state.md` § Write protocol | `scripts/lib/state-write-guard.test.ts`: a 0-byte, shrunken or key-less `.tmp` exits 1 and is not installed |
| Destructive shell and git (`rm -rf`, `git reset --hard`, `git clean`, force push, worktree removal) | Claude Code auto mode prompts. Without auto mode: a prose rule, then reviewer V-SEC-14 and V-BRANCH-01/02 after the fact | Platform prompt; reviewer `04-security-checks.md` | Platform behaviour, not testable here. Reviewer audit catches a force push or destructive workflow in the diff |
| Worker writing outside its worktree or touch-paths | One worktree per worker; reviewer diffs against plan touch-paths (V-SCOPE-02); CI `bun run verify` before merge | Phase 3 spawn, reviewer, `verify.yml` | A fixture diff touching a path outside Touch-Paths yields a V-SCOPE-02 finding |
| Sensitive files and secrets committed | Reviewer V-SEC-03 and V-SEC-11 (BLOCK) audits, sensitive-filename staging gate; the consumer repo's own CI secret scan where it has one | Reviewer, `gates/07-sensitive-filename-staging-gate.md`, consumer CI | A staged `.env` yields a V-SEC-11 BLOCK row |
| Release-tag and `package.json` version changes | `merge-risk.ts` `needs-chef` hold (unchanged) | `phase-loop.md` merge step 4 | `classifyMergeRisk` returns `needs-chef` for a `package.json` version bump |

### Residual risk accepted

- On a harness without auto mode a worker can now run a destructive command, or write outside its worktree to a path no reviewer sees; the review-time audit detects after the fact, it does not prevent.
- **Tampering with campaign state is Accepted (detect + recover), not Mitigated.** A worker (prompt-injected or buggy) can overwrite or truncate `queue.json` or `findings-ledger.json` and no hook denies it: the single-writer rule and `state-write-guard.ts` validate only the orchestrator's own writes. Detection is the guard's shrink, zero-byte and shape refusal on the orchestrator's next install; recovery is the archive snapshot taken before each mutation; prevention relies on worker prompts and auto mode.
- Blackhole's own CI has no secret scanner today. The secrets row relies on the reviewer audits here; a CI scan is a separate follow-up, not part of this decision.
- Installed plugin copies keep the old hooks until the plugin is updated or reinstalled (`blackhole-protocol.md` § Installed plugin cache refresh); the release note says so.

## Alternatives Considered

| Option | Why not |
|---|---|
| Keep ADR-061 keep rows, trim the Bash write-target guard (its follow-ups A/B) | Still a shell parser to maintain; each incident above was a parser or trust-grant defect, and trimming does not remove the class |
| Keep only the campaign state guard and drop the rest | The state guard produced the worst incident (#1370, PR #1641 security round); the state-write-guard protocol already covers its risk without a hook |
| Replace the guards with a harness-neutral denylist in a settings file | Still a blocking control with the same false-positive surface, and not portable across harnesses |

## Consequences

- About 5.9k lines of guard code and about 10.9k lines of guard tests go away; no `.blackhole/hook-events/` record is produced after this lands. Retiring the ingestion code, the `V-HOOK-01..03` rows and the worker workaround prose (`cd`-first state writes, `BLACKHOLE_ASSIGNED_WORKTREE`) follows in a second change.
- A future guard needs a new ADR.
- Safety on non-auto-mode harnesses becomes detective, not preventive.

---
type: review
status: current
review_trigger: "on release"
created: 2026-07-16
last_updated: 2026-07-16
related: [documentation/decisions/ADR-010-autonomous-thinking-routes.md]
---

# Deep Review: v0.13.1 → HEAD (main)

Audit-mode review (code quality + security) of the 11-commit span since the last pushed tag
`v0.13.1` (HEAD = `90bbbfa`). Scope: the ADR-010 autonomous-thinking-routes release span —
confidence kernel (M1), design autonomy (M2), analyze sub-mode (M3), brainstorm route (M4),
retrospective hunt kind (M5) — plus the CI migration to a self-hosted runner (`2c00702`).

## Verdict: BLOCKED

1 CRITICAL + 1 HIGH finding. Both verified first-party (not just reviewer claims).
Since this span is already merged on `main`, "blocked" here means: **remediate before the
next tag/release, and mitigate the CI finding immediately** (it is live and exploitable now).

## Gate Execution Evidence (first-party, this session)

| Gate | Result |
|------|--------|
| `bun test` | 488 pass / 0 fail (898 assertions, 25 files) |
| `bun run verify` | 28/28 checks pass |
| Build-mirror drift (`bun run build` → `git status`) | Clean — mirrors in sync with `src/` |

## Findings

| # | V-code | Severity | Location | Finding |
|---|--------|----------|----------|---------|
| F-1 | V-SEC-05 | **CRITICAL** | `.github/workflows/verify.yml:13,44`, `release.yml:11` | CI runs on `[self-hosted, mba]` (owner's physical MacBook Air) while the repo is public (`private: false`, `allow_forking: true`) and `verify.yml` triggers on `pull_request`. Any fork PR executes attacker-controlled code (`bun install` / `bun run verify` / `bun run build` all run PR-branch code) on the physical machine. Attack path: fork → add malicious `postinstall` or edit any `scripts/*.ts` → open PR → job schedules on the runner. GitHub's default "approve first-time contributor runs" gate is thin: runs are automatic after a contributor's first merged PR. Introduced in `2c00702`. |
| F-2 | V-TEST-01 | **HIGH** | `scripts/design-aggregate.ts:111-151` (`validateInput`), `:153-159` (`weightedTotal`) | `validateInput` never checks that each scorer's per-option scores cover every column in `weights`; `weightedTotal` silently defaults a missing column to 0 (`scores[column] ?? 0`). **Reproduced live**: omitting `Maintainability` for one option flips the verdict from `blocked` (5.3% margin) to `ready` (50% margin) with the wrong winner — violating the script's own "any aggregation-input anomaly → blocked" fail-safe contract (ADR-010 D4). |
| F-3 | V-DOC-GOV-02 | MEDIUM | `src/references/worker-schemas.md:138` | Planner `track` enum in the base contract table omits `brainstorm`, though the same diff adds the Brainstorm-track section below and `validate-worker-json.ts`'s `TRACKS` enum includes it. |
| F-4 | V-DOC-GOV | MEDIUM | `src/references/config-template.md:107-111` | `autonomy` contract note still says `design-aggregate.ts` "does not exist until Milestone 2" — M2 landed in this same span; stale forward-reference. |
| F-5 | V-INT-01 | LOW | `src/references/queue-dag.md:81` vs `:83` | `needs_analysis` default stated conditionally on line 81 but unconditionally in the line-83 summary parenthetical. |

## Remediation Order

1. **F-1 (immediate)**: Move the `pull_request` jobs in `verify.yml` back to `ubuntu-latest`;
   keep `[self-hosted, mba]` only for `push` to main/tags (the shape `release.yml` already has).
   Alternatively require explicit approval for ALL outside-collaborator runs in repo settings
   as a stopgap — but the runner-label change is the real fix.
2. **F-2**: In `validateInput`, verify every scorer (primary + both critics), every option, has
   a score for every `Object.keys(weights)` column; return `'malformed-input'` otherwise. Add a
   regression test for the omitted-column case.
3. **F-3/F-4**: One-line doc fixes in `src/references/`, then `bun run build` to refresh mirrors.
4. **F-5**: Optional polish.

## Consistency Checks (clean)

- Mirror sync spot-check (`planner.md`, `design-rubric.md`, `worker-schemas.md`): only expected
  template substitutions — in sync.
- V-code table / check-count threading (`blackhole-vcodes.md` +V-AUTO-01/02, `build.ts` row
  count 44→46, `EXPECTED_CHECK_COUNT` 27→28, new `V-DESIGN-02` check): all consistent with the
  live 28/28 verify output.
- `design-rubric.md` weight tables all sum to exactly 100, matching `WEIGHT_SUM_TOLERANCE`.
- New-field threading (`needs_brainstorm`, `needs_analysis`, `confidence.*`, `analysis-landed`,
  `analyze` sub-mode) consistent across router/queue-dag/phase-handle/investigator docs, the
  validator, and fixtures.
- Security sweep of new TS code: no prototype pollution, no path traversal, no command
  injection, no hardcoded secrets; `autonomy` config defaults `enabled: false` (fail-safe).

## Follow-ups (pre-existing, out of diff scope)

- **CI never runs `bun test`** — `verify.yml` only runs the 28 structural checks and build-sync
  diff; the 488 unit tests (including all new design-aggregate/validator tests) never execute in
  CI. Predates this span; worth an issue.
- Third-party actions pinned by tag, not SHA (pre-existing convention).
- `findBalancedObjectStrings` (`validate-worker-json.ts:480`) is O(n²) over an unbounded
  `summary` field — local-only trust boundary, self-DoS at worst.

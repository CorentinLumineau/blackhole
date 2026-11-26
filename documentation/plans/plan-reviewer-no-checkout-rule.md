---
type: plan
summary: "Reviewer no-checkout rule in reviewer.md and phase-review.md, guarded by a V-GITSAFE-01 marker check"
status: current
review_trigger: "on issue-close #1654"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan - Issue #1654

## Objective

Bind the read-only reviewer to a no-checkout rule so it can never discard another session's
uncommitted work (the incident behind the reviewer-no-checkout memory: a read-only worker ran
`git checkout`/`restore` in a shared checkout). The rule appears in `reviewer.md` (worker side)
and in the review dispatch prose (orchestrator side), and a gate-marker check fails when either
copy is removed.

## Touch-Paths

- `src/agents/reviewer.md` (new `### No-Checkout Rule` section, core, not an audit module)
- `src/references/phase-review.md` (one bullet under `## Reviewer prompt must include`)
- `scripts/checks/worker-git-safety.check.ts` (two new marker arrays, wired into `V-GITSAFE-01`)
- `scripts/verify.worker-git-safety.test.ts` (fixed/stale fixtures for both arrays)
- plus all generated dist trees per `scripts/lib/build/targets.ts` (one `bun run build`, once, through `with-test-lock`)

## Documentation Impact

None - agent-prompt and check change only; `V-GITSAFE-01` row in `blackhole-vcodes.md` is generic and is not edited.

## Design Decision

Home for the check is `worker-git-safety.check.ts` (`V-GITSAFE-01`, already the "worker git
operations" gate with the same fixed/stale fixture test shape), not `agents.check.ts`: no new
V-code, no new file (`V-INT-02`, `V-KISS-01`). Markers are single-line literals because
`findMissingGateMarkers` is a substring match on the composed doc.

Token budget: `REVIEWER_TOKEN_CEILING` is 14,000 (`scripts/worker-context-size.test.ts:19`);
`agents/reviewer.md` is 54,333 bytes = 13,583 tokens, headroom ~417 tokens (~1,660 bytes). The new
section must stay at or under ~700 bytes (~175 tokens) in total. The ceiling must not be raised.
Put the rule in the core shell, not an inlined audit module (inlined modules count toward the
compiled definition either way, so no saving, and a core rule cannot be skipped by a trigger).

## Task Steps (TDD order)

1. **RED**: in `scripts/checks/worker-git-safety.check.ts` add
   `REVIEWER_REQUIRED_MARKERS = ['No-Checkout Rule', 'git worktree add --detach', 'Never `git checkout`']` and
   `PHASE_REVIEW_REQUIRED_MARKERS = ['No-Checkout Rule', 'git worktree add --detach']`; read
   `readComposedAgentDoc('src/agents/reviewer.md')` and `read('src/references/phase-review.md')` in
   `checkWorkerGitSafety`, append `reviewer.md missing "..."` / `phase-review.md missing "..."` errors.
   In `scripts/verify.worker-git-safety.test.ts` add fixed/stale fixture tests for both arrays
   (same `expectMarkersPresent`/`expectMarkersMissing` shape). Run
   `with-test-lock bun test scripts/verify.worker-git-safety.test.ts` and record the failure:
   "passes against the current tree" fails with `reviewer.md missing "No-Checkout Rule"`.
2. **GREEN**: add to `src/agents/reviewer.md`, immediately before `## Audit Checklist`:
   `### No-Checkout Rule` - "Read a PR head with `gh pr diff`, `gh api` contents, `git show <sha>:<path>`, or a throwaway `git worktree add --detach` you create and remove yourself. Never `git checkout` or `git switch` in an existing checkout, and never `git checkout --`, `restore`, `reset`, `clean` or `stash` anywhere: they discard uncommitted work another session holds." Keep marker literals on single lines (no wrap inside a marker).
3. Add to `src/references/phase-review.md` `## Reviewer prompt must include`: one bullet
   "No-Checkout Rule: tell the reviewer to read the PR head via `gh pr diff` / `gh api` / `git show <sha>:<path>` / a throwaway `git worktree add --detach`, never `git checkout`/`git switch`/`restore`/`reset`/`clean`/`stash` (`reviewer.md` § No-Checkout Rule)". Cite, do not restate (`V-DOC-05`).
4. Re-run the single test file: green. Run `bun run scripts/worker-context-size.ts` (cheap) and confirm reviewer tokens <= 14,000; run `with-test-lock bun test scripts/worker-context-size.test.ts` (reads built `agents/`).
5. One `bun run build` through `with-test-lock` (after MemAvailable >= 2500 MB) to regenerate mirrors; rebuild `agents/reviewer.md` must then stay <= 14,000 tokens. If over, trim the section wording, never raise the ceiling (if overrun is unavoidable: stop and park).
6. Push; CI verifies the rest (`bun run verify` is CI-only).

## Acceptance Criteria

- **AC1**: `bun test scripts/verify.worker-git-safety.test.ts` failed before step 2 on `reviewer.md missing "No-Checkout Rule"` (red recorded in PR body) and passes after.
- **AC2**: `grep -c "No-Checkout Rule" src/agents/reviewer.md src/references/phase-review.md` returns >= 1 for each file; removing either makes `V-GITSAFE-01` fail (stale-fixture tests).
- **AC3**: `scripts/worker-context-size.ts` reports reviewer tokens <= 14,000 and `scripts/worker-context-size.test.ts` passes; `REVIEWER_TOKEN_CEILING` unchanged.
- **AC4**: generated mirrors contain the rule (`grep -l "No-Checkout Rule" agents/reviewer.md .claude/agents/reviewer.md plugins/blackhole-claude/agents/reviewer.md`), no hand edits to dist trees.

## Scout / risks

- Reviewer budget is the only real risk (417 tokens headroom); measured before build in step 4 via source bytes/4 of the compiled doc.
- Orchestrator-side `src/references/orchestrator-dispatch.md` needs no edit: reviewer spawn prose lives in `phase-review.md` (checked).
- Pareto: Gain 7 x (11 - Effort 2) = 63 (>= 30).

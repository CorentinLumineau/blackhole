---
type: plan
summary: "Claim the issue on the forge with the consumer claim_labels at implementer dispatch"
status: current
review_trigger: "on file change"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan - Issue #1632

## Objective
At implementer dispatch, the orchestrator adds each configured `claim_labels` entry to the issue on the forge, so `scripts/merge-pr.sh`'s contributor contract (needs `in-progress:claude` or a blackhole label) passes without a manual label step. Claim at dispatch, release on stop as today (`scripts/release-claims.ts`). Fail open: a forge error warns and dispatch continues. With no `claim_labels` configured nothing is written.

## Touch-Paths
- `scripts/lib/claim-release.ts` (add `applyClaimLabels`, the mirror of `releaseClaimLabels`)
- `scripts/claim-labels.ts` (new CLI: `--issue <N> [--campaign-dir <dir>]`)
- `scripts/claim-labels.test.ts` (new)
- `scripts/lane-claim-docs.test.ts` (extend the wiring test)
- `src/references/orchestrator-dispatch.md` (§ Contract claim labels: claim at dispatch)
- `src/references/config-template.md` (`claim_labels` row: claimed at dispatch, released on stop)
- `src/references/phase-implement.md` (dispatch step names the call, only if it lists dispatch steps; else orchestrator-dispatch.md alone)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact
`src/references/orchestrator-dispatch.md` and `src/references/config-template.md` (above). No ADR: it extends #1605's `claim_labels` mechanism without changing its contract.

## Task Steps
1. RED: `scripts/claim-labels.test.ts` with a fake adapter (same shape as `release-claims.test.ts`): (a) `claim_labels: ["in-progress:claude"]` and `--issue 10` makes one `labelAdd({type:"issue",number:10}, ["in-progress:claude"])` and prints `{claimed:[{issue:10,label}],failed:[]}`; (b) no `claim_labels` makes no adapter call, prints empty sets; (c) `labelAdd` throws: exit 0, error lands in `failed`, warning on stderr (fail open); (d) a bad `--issue` or unknown flag is a `UsageError` (exit 2); (e) a malformed `claim_labels` throws via `readClaimLabels` (same validation as release).
2. GREEN: add `applyClaimLabels(adapter: Pick<ForgeAdapter,"labelAdd">, issue, labels)` to `claim-release.ts` returning `{claimed, failed}`; add `scripts/claim-labels.ts` modelled on `release-claims.ts` (parseFlags/unknownFlagKeys, `readClaimLabels`, `adapterForCampaign`). Reuse `readClaimLabels`; no second parser (`V-INT-02`). `labelAdd` goes through the forge adapter's REST path; no new transport.
3. Docs: in § Contract claim labels add "Claim at dispatch": before spawning an implementer (also a fix-round respawn; `labelAdd` is idempotent), run `bun run scripts/claim-labels.ts --issue <N> --campaign-dir .blackhole`; a non-zero exit 1 or non-empty `failed` is logged as a warning in the turn notes and never blocks dispatch. It runs after the lane claim step and is independent of it (lane `SKIP` still gets contract labels). Update the section's opening and the config-template row to say claimed at dispatch, released on stop.
4. Extend `lane-claim-docs.test.ts` contract-claim test to require `scripts/claim-labels.ts` in the section.
5. One `bun run build` through `with-test-lock` to regenerate mirrors; run only the two changed test files.

## Acceptance Criteria
- **AC**: `bun test scripts/claim-labels.test.ts` passes cases (a) to (e) above (a dispatch writes the label; no `claim_labels` changes nothing).
- **AC**: `bun test scripts/lane-claim-docs.test.ts` passes and asserts `scripts/claim-labels.ts` appears in `## Contract claim labels`.
- **AC**: `grep -c "claim-labels.ts" src/references/orchestrator-dispatch.md` is at least 1 (scope: that file; no exemptions).
- **AC**: `scripts/claim.ts` is unchanged (`git diff --stat` shows it absent); `scripts/release-claims.ts` only moves onto the shared `scripts/lib/claim-cli.ts` preamble with identical behaviour (`scripts/release-claims.test.ts` still passes).

## Risks
- Label absent on the consumer repo: GitHub and GitLab create a missing label through the forge API, and Gitea creates it first via `ensureLabel`. The real failure modes are auth or permission errors, which fail open with a warning; merge then still needs a manual label.
- Re-claim after release on a fix-round respawn: intended; release only fires on stop or merge.

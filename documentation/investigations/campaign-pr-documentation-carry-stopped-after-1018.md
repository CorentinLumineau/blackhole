---
type: analysis
summary: "Why campaign PRs stopped carrying documentation/ artifacts: no manifest since 2026-10-14 because the dispatch path skipped the plan step, and V-AUTO-02 passes vacuously on an absent manifest"
status: current
review_trigger: "on rule update"
created: 2026-11-18
last_updated: 2026-11-18
related: [documentation/decisions/ADR-021-durable-artifact-staging.md, documentation/plans/plan-route-artifact-carry-gate.md]
---

# Campaign PRs ship almost no documentation (issue 1278)

## Symptom

Owner feedback of 2026-11-18: campaign PRs do not publish ADR, plan, analysis or investigation
artifacts the way the mercure workflow does. Measured on the repo: 3 of the last 40 merged PRs
touch `documentation/`. `.blackhole/staged/` holds 79 issue folders and the newest manifest
belongs to issue 1018 (declared 2026-10-14).

## Which link broke

| Link | State | Evidence |
|---|---|---|
| Router sets route flags | Working | ledger `routing_decisions` carries `docs_impact`, `needs_investigation`, `plan_mode` for new issues (R-00101 for this issue). It stopped writing decisions after R-00100 for the issues dispatched without a plan step, but the flags themselves are not the failure |
| `planner` / `investigator` stage and write `manifest.json` | Not invoked | The Pattern C (`claude-code-native.md`) dispatch path sent implementers straight to work with no handle or plan step, so no producer ran and no `manifest.json` was written after 1018 |
| Implementer carry-step | Dormant, not broken | `scripts/carry-staged-artifacts.ts` has nothing to carry when no manifest exists |
| Reviewer `V-AUTO-02` | Passes vacuously | `src/references/audits/25-staged-artifact-carry-audit.md` says an absent or empty manifest emits no findings, so a route that promised an artifact and staged none is indistinguishable from a route that promised nothing |

The decisive defect is the last row: the audit that should catch a missing artifact treats the
missing manifest as a clean pass, so the failure was silent for five weeks.

## Did the 2026-10-29 owner reversal switch the carry-step off?

No. Decision: the carry-step stays on and no dedicated docs PR is needed.

Evidence:
- `.blackhole/owner-decisions.json` and `documentation/reference/decision-log.md` hold no
  entry stating "docs NOT in feature PRs, dedicated docs PRs".
- `.blackhole/config.json` still has `docs_governance.enabled` and `write_governance` both `true`.
- The newest manifest declares 2026-10-14, before the reversal date, and the issue reports no
  manifest since 2026-11-11 either way; the stop is explained by the missing producer step, and
  nothing in the repo ties it to a rule change on 2026-10-29.
- `implementer.md` § Carry Staged Artifacts and `phase-implement.md` step 5 still make the carry
  unconditional when the gate is on.

If the owner did rule that docs belong in dedicated PRs, no mechanism for opening such a PR
exists in the repo either, so the single-PR carry is the only wired path and the one this fix
completes end to end.

## Fix shape

Close the vacuous pass and gate dispatch (see the plan for tasks): a route-promise checker
compares the artifacts the latest route promises with the manifest, once before the implementer
is spawned and once at review time. With governance on, an absent route or an absent manifest is
a gap, never a skip.

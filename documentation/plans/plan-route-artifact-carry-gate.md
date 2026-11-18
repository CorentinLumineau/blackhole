---
type: plan
summary: "Plan for issue 1278: route-artifact checker library and CLI, V-AUTO-03 dispatch and PR gate, closing the vacuous V-AUTO-02 pass so campaign PRs carry their documentation"
status: current
review_trigger: "on ADR acceptance"
created: 2026-11-18
last_updated: 2026-11-18
related: [documentation/decisions/ADR-021-durable-artifact-staging.md, documentation/investigations/campaign-pr-documentation-carry-stopped-after-1018.md]
---

# Plan: route-artifact carry gate (issue 1278)

Objective: make every campaign PR whose route promised a documentation artifact carry it, and make
a silent stop of that pipeline visible.

Tasks (full acceptance criteria in the working plan for the issue):

1. `scripts/lib/route-artifacts.ts` with tests first: `latestRoute`, `promisedRoutes`,
   `checkRouteArtifacts`, `dispatchGaps`, `collectDocCarry`, reusing `loadManifest` and
   `validateEntries` from `scripts/lib/carry-staged-artifacts.ts`.
2. CLI `scripts/route-artifacts.ts` (`--phase dispatch|pr`); exit 1 on a gap, 0 skipped when
   docs governance is off, 2 on usage error; an absent route or manifest with governance on is
   a gap.
3. Dispatch gate in `phase-implement.md` and `claude-code-native.md`, V-AUTO-03 BLOCK row, and
   the PR-phase section added to the existing staged-artifact carry audit module.
4. `doc_carry` status line: split into its own follow-up issue if the diff passes about 600 lines.

Test strategy: red-first test that an absent manifest with governance on exits 1 (the vacuous
pass being fixed); behaviour tests through the CLI; CI runs the suites.

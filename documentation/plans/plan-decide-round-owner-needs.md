---
type: plan
summary: "Plan for listing owner-gated PRs and owner-addressed blocked items in the decide round"
status: current
review_trigger: "on file change"
created: 2026-11-27
last_updated: 2026-11-27
---

# Plan - Issue #1631

## Objective
`bun scripts/campaign-record.ts decide` reports, besides parked `pending-decisions.json` entries, (a) open PRs labelled `needs-owner` or `owner-gated` and (b) blocked queue items whose `notes` address the owner. Anything already cited by a parked decision is not listed twice. Forge reads are injectable; tests never call a forge.

Assumption (no owner question needed): the extra items are shown as a report section and a JSON `owner_needs` field, not as AskUserQuestion cards. A PR waiting for an `owner-approved` label has no answer the owner gives in a card; the owner acts on the forge. Parked decisions keep their cards unchanged.

## Touch-Paths
- `scripts/lib/campaign-status/owner-needs.ts` (new: pure `collectOwnerNeeds`, `OWNER_PR_LABELS`, `renderOwnerNeeds`)
- `scripts/lib/campaign-status/owner-needs.test.ts` (new)
- `scripts/lib/campaign-status/decide-round.ts` (`buildDecideReport` takes optional `ownerNeeds`; adds one report section)
- `scripts/lib/campaign-status/decide-round.test.ts` (report and `runRecord decide` cases)
- `scripts/campaign-record.ts` (`runRecord` gains an optional 4th arg `{ ownerPrs }`; `decide` passes it through; the `main` block reads open PRs via `adapterForCampaign` inside try/catch and passes `null` when the forge is unreadable)
- `src/references/decision-parking.md` (§ Decide round: one step describing the owner-needs section and dedupe rule), plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact
`src/references/decision-parking.md` § Decide round (and its generated mirrors). No ADR, no ARCHITECTURE.md change: no new cross-cutting constraint.

## Task Steps
1. Test first (`owner-needs.test.ts`): given `ForgePr[]` fixtures with labels, `collectOwnerNeeds` returns only PRs labelled `needs-owner` or `owner-gated` (case-insensitive) and state OPEN. **AC**: test fails before the lib exists, passes after.
2. Blocked items: from `QueueIssue` map, take `status: blocked` rows whose `notes` match `ADDRESSES_OWNER` (`report.ts:81`, reuse, do not redefine; V-INT-02) or `waitReason(...).owner` (`blocked-classes.ts:14`), skipping notes starting `awaiting-owner-on-return` because those are the parked-decision gate. Carry `{ number, title, note }`. **AC**: a blocked item with `needs-owner` notes is listed; one with `awaiting-owner-on-return` or a plain dependency note is not.
3. Dedupe against parked decisions: drop a PR when a parked decision `blocks` contains its number or its queue issue number (`issue.pr === prNumber`), or its question/evidence text cites `#<n>`; drop a blocked item when `blocks` contains its number or its PR number. **AC**: tests for each of the four citation paths; an uncited PR stays.
4. `renderOwnerNeeds` returns the report lines, ranked PRs first then blocked items, ascending number; when the forge was not read (`ownerPrs === null`) it prints `open PRs needing you: not read (forge unavailable)` and never `none`. **AC**: test for `null` vs `[]`.
5. `buildDecideReport` appends `- Also needing you (not parked): ...` after the Decisions line; omitted input keeps the current output byte-identical so existing `decide-round.test.ts` cases stay green. **AC**: existing report tests unchanged and green.
6. `campaign-record.ts`: `decide` computes `owner_needs` and adds it to the JSON next to `report`, `cards`. In `main`, the forge call is `adapterForCampaign(...).prList({ state: "open", limit: 200 })` (same call shape as `claim-release.ts:45`), wrapped so a failure yields `null`. Tests inject `ownerPrs` directly; the `forge-fake.ts` helper is used only if an adapter-level test is added. **AC**: `runRecord(["decide", ...], now, hold, { ownerPrs: [...] })` JSON contains `owner_needs`; with the arg omitted the output equals today.
7. Docs: add one numbered sentence to `src/references/decision-parking.md` § Decide round (show `owner_needs` after the report, not as cards; dedupe rule; `null` means not read). Keep the file inside its V-CONTENTGATE budget; run `bun run build` once (through with-test-lock) only to regenerate mirrors.

## Verification (CI-first)
Locally: `with-test-lock bun test scripts/lib/campaign-status/owner-needs.test.ts scripts/lib/campaign-status/decide-round.test.ts` after MemAvailable >= 2500 MB, one build for mirrors. Full suite on CI.

## Constraints
No change to `src/agents/implementer.md` or `reviewer.md` (token ceilings 11,300 / 14,000 untouched). No queue/ledger writes by the feature: `decide` still writes only `decide-baseline.json`. Forge label text and PR titles are untrusted data: rendered as text, never executed.


---
type: plan
summary: "Release-side tie-break for a mutual peer hold in syncQueue (higher session id keeps the hold while the peer is live), plus heartbeat fs-error message and two doc corrections (#1335)"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
related: [documentation/decisions/ADR-057-peer-campaign-detection-registry.md]
---

# Plan: peer-hold tie-break and doc fixes (#1335)

## Context
Follow-up to #1267 (PR #1329 review, four deferred WARNs, F-00659..F-00662 range). Two live campaign sessions that both hold the same ready-with-PR issue release it in the same turn, and three doc/error-message statements are inaccurate.

## Tasks
1. **Tie-break (red first).** `SyncInput` gains optional `selfSession?: string` and `livePeerSessions?: string[]`. In `syncQueue` (`scripts/lib/forge-sync.ts` ~197), an entry held for peer P (`isPeerHold`) that P no longer claims is released, unless `selfSession > P` and P is in `livePeerSessions`; then the hold is kept (the lower id reclaims alone, the higher yields while P is live). Unchanged when `peersUnreadable` (fail closed); the `isPeerHold` exclusion in `claimsOf` stays. Wire the only construction site, `scripts/forge-sync.ts` ~85-87 (`selfSession`, `detected.peers.map(p => p.session)`).
   - AC: a lockstep two-session simulation over 4 turns shows exactly one claimant from turn 2 on with no flipping; the hold is released once the peer leaves `livePeerSessions`; the hold is kept under `peersUnreadable`.
2. **Wording.** Fix `src/references/forge-sync.md:63` and the test title at `scripts/lib/peer-campaigns.test.ts:147`.
   - AC: `rg "never hold each other" src scripts` returns nothing.
3. **Heartbeat fs error (red first).** In `scripts/peer-campaigns.ts` `run()`, an errno-coded heartbeat error (EACCES, ENOSPC) returns exit 1 with one line `peer-campaigns: heartbeat could not be written (<code>): <path>`; non-fs errors still rethrow. Extend only the exit-1 sentence in `src/references/launch-gate.md` (~28-30); #1277 edits other parts of the file.
   - AC: a test with an unwritable registry asserts exit 1 and the single line, with no stack trace.
4. **lstat-failed entries: document, no code.** Add a clause at `src/references/orchestrator-runtime.md` ~272: an lstat-failed (EACCES) entry has no mtime and persists as `unknown` until permissions are fixed or the file is removed. Rationale: dating it by the registry directory mtime would let unrelated writes refresh or age out an unreadable entry, which weakens fail-closed.
   - AC: the clause is present, and the "lapses one lease after its mtime" sentence is scoped to readable-but-corrupt files.

## Touch-paths
scripts/lib/forge-sync.ts, scripts/lib/forge-sync.test.ts, scripts/forge-sync.ts, scripts/forge-sync.test.ts (fixtures only if needed), scripts/lib/peer-campaigns.test.ts (L147 title), scripts/peer-campaigns.ts, scripts/peer-campaigns.test.ts, src/references/forge-sync.md, src/references/launch-gate.md (heartbeat exit sentence only), src/references/orchestrator-runtime.md, plus generated dist trees.

## Test strategy
Red first for tasks 1 and 3, then the touched specs plus one `bun run verify`. No version bump (V-PLUGIN-01 waived).

Pareto: Gain 6 x (11 - 3) = 48.

---
type: plan
summary: "Bound archive snapshots to newest N (default 2) and document durable vs scratch .blackhole paths"
status: current
review_trigger: "on file change"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan: issue #1633 - archive snapshot bloat

## Objective
`installStateFile` copies `queue.json` / `findings-ledger.json` into `archive/` before every mutation and never prunes, so a consumer that tracks `.blackhole/` commits every snapshot (8 x 28k lines). Keep the recovery guarantee (a snapshot exists before each mutation) while bounding the count. Pareto: gain 7, effort 3, priority 56 (>= 30).

## Root cause
`scripts/lib/state-write-guard.ts` `installStateFile` has no retention step; `blackhole-state.md` marks `archive/` gitignored for blackhole's own repo, but nothing tells or enforces that for consumers that commit `.blackhole/`.

## Design decision (no owner decision needed)
- Retention in the one writer (`installStateFile`, SSOT for all four script callers: forge-sync, queue-migrate, migrate-ledger-schema, triage-deferred-findings): after writing the new snapshot, delete older snapshots of the same base (`<base>-<ISO>.json`) beyond the newest N. Timestamp names sort lexicographically.
- N from env `BLACKHOLE_ARCHIVE_SNAPSHOT_RETENTION`, default 2, positive integer only; any other value (including 0, so "none" is not offered) falls back to 2. This keeps at least the pre-mutation snapshot, preserving the recovery guarantee. Env var mirrors the existing `BLACKHOLE_HOOK_EVENT_RETENTION_DAYS` precedent (no new config key).
- Only files matching the exact snapshot name pattern are pruned; `hook-events-*` dirs and other archive content are untouched.
- Consumer policy is documentation, not code: recommend `.blackhole/archive/` in the consumer `.gitignore`, and list durable vs scratch paths. No change to the consumer's tracked-state contract.
- Out of scope: the `gitleaks:allow` title leak is a consequence of committing snapshots; ignoring/pruning removes the vector. No title redaction (YAGNI).

## Touch-Paths
- `scripts/lib/state-write-guard.ts`
- `scripts/lib/state-write-guard.test.ts`
- `src/references/blackhole-state.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`)
- `src/references/config-template.md` (env-var table row; plus all generated dist trees per `scripts/lib/build/targets.ts`)

## Task Steps
1. Test first (`state-write-guard.test.ts`): AC: with retention default, after 4 successive `installStateFile` calls over one live file, `archiveDir` holds exactly 2 `queue-*.json` snapshots and they are the newest two.
2. Test: AC: `BLACKHOLE_ARCHIVE_SNAPSHOT_RETENTION=3` keeps 3; values `0`, `-1`, `abc`, `1.5` fall back to 2.
3. Test: AC: a `findings-ledger-*` snapshot and a `hook-events-x/` dir in `archiveDir` are not removed when pruning `queue-*`; a refused (invalid) install still leaves at least the pre-mutation snapshot.
4. Implement `pruneArchiveSnapshots(archiveDir, base, keep)` plus `resolveRetention(env)` in `state-write-guard.ts`, called right after the snapshot copy (before validation, so a refused write cannot lose the newest snapshot). AC: tests 1-3 pass.
5. Docs: in `blackhole-state.md` Write protocol step 1 state the retention (default 2, env override) and add a "Durable vs scratch" subsection: durable = `config.json`, `status-artifact.json`, `plans/`, `staged/`; scratch (never commit) = `archive/`, `hook-events/`, `.tmp/`, `*.tmp`, per-machine signals; consumers that commit `.blackhole/` add `.blackhole/archive/` to `.gitignore`. Add env row to `config-template.md`. AC: `grep -n BLACKHOLE_ARCHIVE_SNAPSHOT_RETENTION` hits both src files.
6. Rebuild once (`bun run build`, via `with-test-lock`) so generated mirrors match; CI runs `bun run verify`.

## Documentation Impact
`src/references/blackhole-state.md`, `src/references/config-template.md` (generated mirrors regenerate). No ADR needed; no public API change.

## Verification (local, minimal)
`with-test-lock bun test scripts/lib/state-write-guard.test.ts` after MemAvailable >= 2500 MB; CI verifies the rest.

## Risks
- Pruning deletes older recovery points: accepted, the guarantee is "snapshot before each mutation", not history. Stop condition: if any caller relies on more than the latest snapshot (grep shows none), abort and raise default.

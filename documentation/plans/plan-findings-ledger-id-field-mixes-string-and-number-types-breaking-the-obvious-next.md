---
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---

# Plan - Issue #796

## Objective
Close the three documentation gaps reported by a consumer repo running blackhole as a vendored
plugin (v0.20.0): (1) no shape-tolerant next-id expression is documented for
`findings-ledger.json`'s `id` field, so a consumer ledger carrying legacy bare-number ids
alongside `F-NNNNN` strings breaks the naive `(.findings | map(.id) | max) + 1` idiom; (2) the
`queue.json` `.issues` (keyed object) vs. `findings-ledger.json` `.findings` (array) shape
asymmetry for `state-write-guard.ts --entity-key` is undocumented; (3) `blackhole-state.md`
cites `scripts/lib/state-write-guard.ts` as a bare repo-root-relative path, which does not
resolve from a consumer repo's root (the script lives in the vendored plugin).

**Verified against this repo's own live state first**:
`jq '[.findings[].id] | map(type) | unique' .blackhole/findings-ledger.json` → `["string"]`
across all 408 rows (all `F-NNNNN`, sequential to `F-00408`). This repo's ledger is **not**
mixed — consistent with the issue's own `queue.json` note. Decision: **document the
shape-tolerant expression, do not migrate** — there is nothing to migrate in this repo, and
rewriting 400+ live rows in a consumer repo mid-campaign is strictly riskier than publishing the
correct expression next to the schema.

`state-write-guard.ts`'s `countEntities()` already branches on `Array.isArray(value)` vs.
`Object.keys(value).length` — the guard's `--entity-key` flag already handles both shapes
generically with zero code change required. This is a documentation-only fix.

The consumer-relative-path gap has an existing precedent to reuse: `implementer.md` §
Promote Review Artifact already documents the identical problem for
`scripts/promote-review-artifact.ts` and resolves it via `scripts/consumer-promote-review.sh`,
which resolves the plugin root as `BLACKHOLE_PLUGIN_ROOT` env var → `vendor/blackhole` →
`node_modules/blackhole`. This plan documents the same resolution order for
`state-write-guard.ts` rather than adding a second wrapper script.

## Touch-Paths
- `src/references/findings-ledger.md`
- `src/references/queue-dag.md`
- `src/references/blackhole-state.md`
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Task Steps
- Document the shape-tolerant next-id expression in `src/references/findings-ledger.md`.
- Document the `--entity-key` array-vs-object shape asymmetry in `src/references/queue-dag.md`.
- Document the consumer-relative-path resolution for `state-write-guard.ts` in
  `src/references/blackhole-state.md` § Write protocol, reusing the existing
  `BLACKHOLE_PLUGIN_ROOT`/`vendor/blackhole`/`node_modules/blackhole` convention.
- Rebuild dist trees (`bun run build`).

See `.blackhole/plans/issue-796.md` (campaign working copy) for full task-level acceptance
criteria and verification detail.

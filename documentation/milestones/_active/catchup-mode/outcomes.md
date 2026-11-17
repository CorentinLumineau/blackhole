---
type: reference
summary: "Per-milestone outcomes log for the catchup-mode initiative: what shipped, plan divergences, constraints hit"
status: current
review_trigger: "on milestone completion"
created: 2026-11-17
last_updated: 2026-11-17
---

# catchup-mode outcomes

## M1 — Bootstrap version check and launch-gate doc completeness (2026-11-17T14:10:00Z)
**Shipped**: A warning when the running plugin is older than an installed version (shared `readPluginVersionCheck` and `readInstalledPluginRows` in `scripts/lib/plugin-drift.ts`, surfaced in `status --summary` and run-context), plus the Sleep row in `launch-gate.md`.
**Diverged from plan**: `hook-sources.test.ts` was left unchanged (extraction covered by the existing suite and new `plugin-drift.test.ts` cases); `readPluginVersion` moved from `campaign-status.ts` into `plugin-drift.ts`.
**Constraint hit**: `readPluginVersionCheck` does not guard against null or non-object rows in `installed_plugins.json` (review LOW 1, deferred); the full suite was left to CI per the CI-first rule.

## M2 — Usage reading everywhere (2026-11-17T14:16:04Z)
**Shipped**: The rate-limit cache reader moved out of pace-gate into `rate-limit-cache.ts` (#1272 cycle broken), `usage-source` gained an ordered provider chain (`--usage` file, statusline cache, probe cache) with `report()`, `usage-normalize` adapts normalized and desktop payloads, `bun run usage` prints one normalized JSON reading on any host, and the pure `scripts/lib/pace-floor.ts` computes the credit schedule, floor and shortfall.
**Diverged from plan**: `normalizeUsagePayload` takes no `now` argument (it was unused); a failed `read()` chain keeps `source` as the first provider name so existing tests pass verbatim, while `report()` on failure gives source `none`; provider 4 (live account usage endpoint) deferred (D1).
**Constraint hit**: The desktop `get_usage` payload shape is still unverified (D2); review LOW notes left open (`mapPlan` substring matching, millisecond `resets_at` never expires, `source: usage-file` when both file and cache fail); full suite left to CI.

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

## M3 — catchup mode with the full-config launch gate (2026-11-17T15:30:00Z)
**Shipped**: `catchup.ts` with the `catchup` config block, `usage-budget --floor` (SKIP when unreadable), the `pace-floor` CLI, a catchup launch summary with a Pacing row and `status --summary --mode catchup`, the `phase-catchup.md` playbook, and run/catchup wording across the launch gate, coordinator, phase-stop, native and dashboard, with config-gate and stop-mode checks.
**Diverged from plan**: `status` CLI parse errors now exit 2 instead of throwing; the playbook cites `scripts/pace-floor.ts` by path so the build keeps it in the shipped-script closure; `stop-mode.check.ts` wiring is asserted inline because the file sits at its LOC budget; T1-T4 were written alongside their tests with no separately observed RED run.
**Constraint hit**: review left two MEDIUM open (floor 0 makes `usage-budget --floor 0` exit 2 instead of STOP-CAMPAIGN; the `--usage <file>` hand-off does not reach the gate so app-only hosts SKIP every round), plus pre-existing V-CONFIG-02 (`merge_mode_note` in the local config); full suite left to CI.

## M4 — Lane claim (2026-11-17T14:46:05Z)
**Shipped**: `ForgeAdapter` claim, release and viewerLogin on GitHub, Gitea and GitLab over one shared flow, `scripts/lib/lane.ts` (lane vocabulary and lease rule, replacing the hardcoded `OWN_LANES`), lane-aware forge-sync (`--lane`, `catchup.lane`), the `bun run claim` CLI, and the claim/release dispatch wiring in the orchestrator docs.
**Diverged from plan**: Implementation landed as two commits (T1-T5 as 25ce1ae8, then the rest) because squashing needed a reset; tests were written alongside the code rather than strictly red-first; the argv-flags-adoption allowlist grew from 18 to 19.
**Constraint hit**: Review left one MEDIUM open (`openPrIndex` classes a PR as foreign from unfiltered lane labels, so a stale foreign claim with an inactive PR still blocks the issue) and two LOW (CLOSED verdict note cites a nonexistent held_by; race rollback removes a pre-existing own label), plus pre-existing V-CONFIG-02 (`merge_mode_note`); full suite left to CI.

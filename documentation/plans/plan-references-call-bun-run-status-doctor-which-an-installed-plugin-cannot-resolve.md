---
type: plan
summary: "Plan for issue 1268: playbooks call campaign-status.ts and doctor.ts by source path instead of the unresolvable package.json aliases, doctor works from a consumer repo, and verify check V-INVOKE-01 blocks aliases from returning"
status: current
review_trigger: "on ADR acceptance"
created: 2026-11-18
last_updated: 2026-11-18
related: [documentation/decisions/ADR-056-playbook-script-invocation-by-path.md]
---

# Plan: playbook script invocation by path (issue 1268)

Objective: no playbook runs a command only a checkout resolves. The 54 `bun run status` / `bun run doctor` sites in `src/agents` and `src/references` become `bun run scripts/campaign-status.ts` / `bun run scripts/doctor.ts`, which the Claude bundle build already rewrites to the plugin root and ships.

Tasks (full acceptance criteria in the working plan for the issue):

1. Red-first tests: the new check flags every alias form and passes path forms; `doctor` from a non-checkout directory skips `verify` and reports the missing config; the doorbell names the script path.
2. `doctor.ts` takes the repo root from the working directory and runs `verify` only in a blackhole checkout; `DOORBELL_MESSAGE` uses the script's absolute path.
3. Prose sweep of the 54 sites; `scripts/checks/playbook-invocation.check.ts`, a `V-INVOKE-01` BLOCK row, `VCODE_TABLE_ROW_COUNT` set from the live count.
4. Build, then a smoke test of the compiled commands from a directory that is neither the plugin nor a checkout.

Design: ADR-056 (path invocation over a bundled package.json, plugin launchers, or a prose table). Order: land #1269 first or in the same wave so the plugin-root variable is set; this plan does not depend on it to merge.

Test strategy: red-before-green for the check and for doctor; CI runs the suites; the bundle smoke test is run once, scoped.

---
type: adr
summary: "Playbook prose invokes bundled scripts only by source path (bun run scripts/<file>.ts, rewritten to the plugin root by the Claude bundle build), never by a package.json alias; doctor and status resolve the campaign from the working directory; verify check V-INVOKE-01 blocks aliases"
status: accepted
review_trigger: "on a change to the plugin bundle layout, the build rewrite, or the plugin-root environment variable"
created: 2026-11-18
last_updated: 2026-11-18
related:
  - src/references/blackhole-vcodes.md
  - scripts/lib/build/claude-plugin-runtime.ts
---

# ADR-056: Playbooks invoke scripts by path, not by package.json alias

## Status

accepted — 2026-11-18 (design approved by the orchestrator under autonomy full; the design-aggregate verdict was blocked on dominance and a breaking consumer, so this is an owner-side approval, not a computed one).

## Context

Playbooks in `src/agents` and `src/references` told agents to run `bun run status` and `bun run doctor`, 54 occurrences in 15 files. Those are `package.json` aliases. An installed plugin ships no `package.json`, and the agent's working directory is the consumer repo, so neither name resolves. The Claude bundle build already rewrites `bun run scripts/<file>.ts` to `bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/<file>.ts` and ships each referenced script with its import closure (66 uses). `scripts/doctor.ts` also took the plugin root as the repo root. Related: #1269 (the plugin-root variable is unset in desktop sessions).

## Decision

1. Playbook prose names a bundled script only by its source path, `bun run scripts/<file>.ts`. The build rewrites it per target; prose never hand-writes the plugin root and never pins `--cwd` for scripts that act on the working directory (`campaign-status.ts`, `doctor.ts`).
2. `campaign-status.ts` and `doctor.ts` resolve the campaign from the working directory; `doctor.ts` runs its checkout-build checks (`D-VERIFY-01` verify, `D-AGENTS-01` `.cursor/agents` build output) only in a blackhole checkout.
3. `V-INVOKE-01` (BLOCK, `scripts/checks/playbook-invocation.check.ts`) fails on a `package.json` script name used as a command in playbook prose. The flagged names are derived from `package.json`; maintainer commands are a declared exemption set.

## Alternatives Considered

| Option | Why not |
|---|---|
| Ship a `package.json` in the bundle, call `bun run --cwd <plugin root> status` | second alias registry that drifts; `--cwd` moves `process.cwd()` off the campaign repo; an empty `--cwd` can fall through to the consumer's own script |
| Plugin `bin/` launchers | depends on the harness adding `bin/` to PATH, unverified, Claude-only, a third invocation idiom |
| Keep aliases, add a resolution table to the skill entry | leaves the failure, no mechanical guard |

## Consequences

- Positive: no new mechanism, 54 sites fixed, regression blocked by a check, `doctor` usable from a consumer repo.
- Negative: path prose resolves in Cursor, Codex and Antigravity trees only from a checkout (as the existing 66 uses do); runtime value in Claude sessions needs #1269 so the plugin-root variable is set; one more BLOCK check and V-code row to maintain.

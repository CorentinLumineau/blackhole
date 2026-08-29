---
type: adr
status: accepted
created: 2026-08-29
last_updated: 2026-08-29
---

# ADR-027: Cursor Pattern C-lite and Cloud goal mapping

## Context

Issue #691 / child #694: Cursor now exposes `Task` fan-out, `AskQuestion` (model-gated),
`/goal`, and Cloud `CreateGoal`, but blackhole's frozen Cursor appendix claimed those
primitives were absent, forcing Pattern B only.

## Decision

1. **Detect-don't-assume** per harness session schema — never bake-time "Cursor cannot" claims.
2. **Pattern C-lite** — when C2+C3 are both present, main chat may orchestrate with `Task`
   barriers (same as Pattern B fan-out) and native or inline C3 gates.
3. **Cloud mapping** — `CreateGoal` when attached; Subscriptions/Automations/`/babysit` documented;
   Pattern B when not.
4. **Claude Pattern C unchanged** — Workflow + `AskUserQuestion` + `/goal` remain SSOT on Claude.

## Consequences

- `multitask-mode.md` documents Pattern C-lite opt-in.
- `claude-code-native.md` Cursor appendix maps C1–C4 to Cursor primitives.
- Coordinator remains valid intake when user prefers it or primitives are absent.

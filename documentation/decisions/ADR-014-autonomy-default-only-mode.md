---
status: Accepted
scope: orchestration
supersedes: partial (removes ADR-010's opt-in invariant; completes ADR-012's "autonomy default flip sequenced last")
related:
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
  - documentation/audits/analysis-blackhole-mercure-synergy.md
---

# ADR-014 — Autonomy as the default and only mode

## Status

Accepted — 2026-07-22

## Context

ADR-010 shipped blackhole's autonomous thinking routes behind an **opt-in master switch**:
`.blackhole/config.json` `autonomy.enabled`, defaulting to `false` when the block is absent
("opt-in like `kaizen`"). Every autonomous route gates on `autonomy.enabled && autonomy.{sub_flag}`;
the confidence-gate kernel is inert unless `enabled: true`, falling back to the categorical
`clarify-gates.md` mechanism.

The synergy assessment (`documentation/audits/analysis-blackhole-mercure-synergy.md`) found:

- **F2** — the machinery is off by default and absent from live campaign configs, so real
  campaigns still run the older ask-on-everything categorical gates rather than the
  confidence-gated autonomy the tool was built for.
- **F1** — the autonomous path has never been observed end-to-end on a real campaign
  (M5's green-campaign gate was waived; T3 verification is outstanding).

The maintainer directive is unambiguous: **autonomy should be the default and only mode** —
remove the need to set `enabled: true`, and remove the alternative (non-autonomous) mode.

## Decision

1. **Remove the `autonomy.enabled` master switch entirely.** Autonomy is unconditionally on.
   The confidence-gate kernel (`confidence-gates.md`) becomes the always-active escalation
   mechanism; its "kill switch" paragraph is deleted.
2. **Collapse every `autonomy.enabled && autonomy.{sub_flag}` gate to `autonomy.{sub_flag}`**
   (~17 sites across 11 source files: `router.md`, `orchestrator.md`, `planner.md`,
   `phase-handle.md`, `phase-plan.md`, `queue-dag.md`, `worker-schemas.md`, `design-rubric.md`,
   `confidence-gates.md`, `clarify-gates.md`, `config-template.md`).
3. **Preserve the sub-flags as tuning knobs** at their current defaults — this is the one
   place "only mode" is ambiguous, resolved deliberately:
   - `design_autonomy: true`, `analyze_routing: true` — remain on (already their defaults).
   - `brainstorm_routing: false` — **stays off by default.** Brainstorm routing has
     terminal-closure semantics (ADR-010 D3) and was deliberately pinned false at M5. "Autonomy
     as the default mode" is about removing the *master opt-in*, not silently enabling brainstorm
     dispatch. A maintainer may still opt into it explicitly.
   - `confidence_threshold: 80`, `design_dominance_delta: 30`, `never_bypass:
     ["destructive","credentials","epic-go-no-go"]` — unchanged. The never-bypass list is the
     permanent human-gate floor and is **not** removed.
4. **`clarify-gates.md` categorical triggers remain** as dimension inputs to the (now always-on)
   confidence kernel, exactly as ADR-010 D6 specified — they are not deleted, only their role as
   a standalone fallback mechanism disappears (there is no longer an "autonomy off" path to fall
   back to).
5. **`config-template.md`**: delete the `enabled` field and rewrite every "when `enabled: false`,
   X is inert" clause to state that autonomy is always active and X is gated only by its sub-flag.

## Risk accepted

This is a **BREAKING** change that the maintainer has explicitly accepted with eyes open:

| Risk | Severity | Residual mitigation |
|------|----------|---------------------|
| T3 (live-campaign verification) is still outstanding — the autonomous path becomes the only mode before it has ever run end-to-end | HIGH | Sub-flags survive: `design_autonomy: false`, `analyze_routing: false` each disable a route granularly; `adaptive_routing: false` disables the router entirely. Full rollback remains a `git revert` of the implementing PR. |
| The single `enabled: false` emergency kill switch is removed | MEDIUM | The never-bypass list (`destructive`/`credentials`/`epic-go-no-go`) is preserved as a permanent human-gate floor; sub-flags provide granular disable; the change is one revert away. |
| Existing campaigns with no `autonomy` block silently switch from ask-on-everything to autonomous | MEDIUM | Behavior change is the explicit intent (F2). Documented in `config-template.md` and release notes. |

## Alternatives rejected

- **A — Default-on but keep the kill switch** (flip the absent-block default to enabled, retain
  `enabled: false` for rollback). Rejected by maintainer directive: the ask is for the *only*
  mode, not merely the default; retaining a disable path contradicts "only mode."
- **B — Verify T3 on a real campaign first, then remove the switch.** Rejected by maintainer
  directive to proceed now; the residual mitigations above (sub-flags, revert) are accepted as
  sufficient in lieu of prior verification.

## Consequences

- Simpler mental model and config: no master switch, autonomy is the tool's identity.
- `confidence-gates.md` loses its kill-switch paragraph and becomes unconditionally load-bearing.
- The T3 verification obligation does not disappear — it becomes an **observe-on-first-real-run**
  item rather than a gate. Any latent routing defect surfaces on the next campaign; the revert
  path is the safety net.
- Supersedes ADR-010's opt-in invariant ("absent block or `enabled: false` preserves current
  behavior exactly") and completes ADR-012's deferred "autonomy default flip."

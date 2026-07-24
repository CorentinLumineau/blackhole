---
type: adr
status: accepted
created: 2026-07-13
last_updated: 2026-07-20
review_trigger: "on ADR acceptance"
related:
  - documentation/audits/analysis-blackhole-routing-reuse-visibility.md
supersedes:
---

# ADR-008 — Routing visibility, wave monitoring & proactive reuse enforcement

## Status

Accepted

## Context

ADR-004 gave blackhole an adaptive router that computes a per-issue `route{}` object
(needs_research / needs_investigation / needs_design, task_type, plan_mode,
security_review_required, plus per-flag confidence) and persists it to `.blackhole/queue.json`.
This layered route-driven conditional steps onto the five binding phases
(`Handle → Plan → Implement → Review → Loop`): research and investigate (Handle spawns
`investigator`), design (Plan's `planner` design track + human gate), plan-tier selection
(skip/quick/full), and security-mode review.

Two structural gaps block the value of that machinery (full evidence:
`documentation/audits/analysis-blackhole-routing-reuse-visibility.md`):

1. **The route intelligence is invisible.** `scripts/campaign-status.ts` omits `route` from its
   `QueueIssue` type and `formatDashboard()` never reads it, so the user cannot see which issues
   need research / design / plan, nor which wave an issue is in (wave grouping is logged to the
   orchestrator turn log only). The user's literal request — *"know which one needs more research,
   design, plan"* and *"monitor during wave implementation that we are properly passing on all
   steps for all issues"* — is unsupported.

2. **Reuse (V-INT) is enforced only reactively.** The `implementer` is never told to search for
   existing utilities before writing. The `Codebase Conventions` reuse baseline is produced only by
   the Standard track, so Quick-track plans inject `(none declared)` and the `reviewer`'s
   V-INT-01/03/04 audit silently no-ops. V-INT-02 is caught only *after* the duplicate code exists,
   wasting a full implement→review worker cycle.

A third, related condition: routing is currently **latent** — every live-queue issue still falls
through the "void route" fallback because none has re-entered Handle since the router landed
(queue-dag.md:86-94).

### Constraints

- `.claude/**` are build outputs of `src/**` (`bun run build`). All edits land in `src/`.
- Reuse detection must not fork into a third independent implementation (V-INT-03).
- Router/reviewer must stay "router-tier cheap" — no expensive per-issue agent spawns.
- `queue.json` is written by up to `parallel_max` (default 4) concurrent workers via an atomic
  `.tmp`+`mv` protocol with no lock strategy — new persisted fields carry write-contention risk.

## Decision

Adopt **Option 2 — Observe + shift-left into the implementer**. Two decoupled workstreams:

**A. Visibility (read-model, additive).** Extend `scripts/campaign-status.ts`:
- Add `route?: Route` to the `QueueIssue` type (typed from the queue-dag `route` SSOT).
- Add a pure `renderRouteChain(route, phase)` that renders the **planned** conditional chain
  `Handle → [research?] → [investigate?] → [design-gate?] → Plan(tier) → Implement → Review([security?])`
  with the current phase marked, plus per-flag confidence.
- Add `computeWaves(issues)` — a client-side topological sort that is **behaviorally identical** to
  `queue-dag.md` § Step 4 — feeding a new `### Waves` dashboard section.
- Add `### Routing` and `### Waves` sections to `formatDashboard()`; document both as the print SSOT
  in `coordinator-dashboard.md`.

**B. Proactive reuse (contract change).** Shift reuse detection left into the implementer using the
codebase's proven PR-artifact gate pattern (Bugfix-Gate Decision Record / docs-only Drift-Check
Table):

> **Aperture superseded by ADR-011 D1**: the single `touch_paths` grep described below was later
> found to conflate two distinct questions (does the concern exist *anywhere*, vs. what is the
> *local* idiom) — ADR-011 D1 splits it into a repo-wide existence search and an unchanged
> neighbourhood convention search, plus a rule-of-three duplication threshold. This section's
> original text is left intact below for the historical record; `implementer.md` § Reuse Check
> Gate is the current authoritative behavior.

- `implementer.md` gains a **Reuse Check** step: before writing, grep the issue's `touch_paths` for
  existing utilities/conventions and record a one-line **Reuse Check** entry in the PR body.
- `reviewer.md` § 5 gains two obligations: **verify** the Reuse Check artifact is present, and run
  a **live-grep fallback** over `touch_paths` when injected `Codebase Conventions = (none declared)`
  so V-INT-01/03/04 always execute.
- **Planner and `queue.json` schema are untouched** — this deliberately avoids the Quick-track
  determinism loss, the Accretion-Guard / Extension-Tax governance gates, and the concurrent-write
  risk that sank the alternatives.

**C. Router rollout.** Force the router to re-triage void-route issues on the standing queue so
`route{}` populates and the Routing section shows real classifications. No schema change
(`config.adaptive_routing` is already `true`).

Detection lives in exactly one locus: the implementer **produces** the reuse artifact, the reviewer
**verifies** it (with a fallback only when no plan conventions exist). No third variant.

### Scope boundary

There is a pre-existing documentation inconsistency about whether the investigator *spawn* is
wired: queue-dag.md:89 claims `needs_research`/`needs_investigation` are "now read by Handle's
investigator spawn (#125)", while phase-handle.md:53-54 and router.md:50 say the investigator
"has not landed". (The `investigator` agent file itself **is** implemented — ~106 lines — so the
earlier "0-byte stub" characterization was incorrect; the open question is dispatch wiring, not the
agent's existence.) Resolving that inconsistency is **out of scope** for this ADR and belongs in a
separate issue. The dashboard renders research/investigate as conditional route-driven steps
regardless.

### Architecture

```mermaid
flowchart TD
  subgraph VIS["A. Visibility (campaign-status.ts)"]
    QI["QueueIssue + route?: Route"] --> RC["renderRouteChain(route, phase)"]
    QI --> CW["computeWaves(issues)\n(mirrors queue-dag Step 4)"]
    RC --> FD["formatDashboard()\n+ Routing + Waves sections"]
    CW --> FD
    FD --> CD["coordinator-dashboard.md\n(print SSOT)"]
  end
  subgraph REUSE["B. Proactive reuse"]
    IMPL["implementer.md\nReuse Check: pre-write grep\n→ 1-line PR-body artifact"] -->|PR body| REV["reviewer.md §5\nverify artifact +\nlive-grep fallback when\nconventions=(none declared)"]
  end
  subgraph ROLL["C. Rollout"]
    RT["router re-triage\nvoid-route issues"]
  end
  RT -->|populates route{}| QI
```

### Components

| Component | Responsibility | Change type |
|-----------|----------------|-------------|
| `QueueIssue` (campaign-status.ts) | Carry optional `route` for display | Add optional field |
| `renderRouteChain()` | `route`+`phase` → planned-chain string, current marked | New pure fn |
| `computeWaves()` | Client-side topo-sort for display, identical to queue-dag §4 | New pure fn |
| `formatDashboard()` | Assemble `### Routing` + `### Waves` sections | Additive |
| `coordinator-dashboard.md` | Document the two new sections | Doc update |
| `implementer.md` Reuse Check | Produce reuse-detection artifact once, pre-write | New gate step |
| `reviewer.md` § 5 | Verify artifact + live-grep fallback | Additive checks |
| Router re-triage | Populate `route{}` on standing queue | Rollout action |
| `campaign-status.test.ts` | Cover `renderRouteChain` + `computeWaves` | Test (TDD) |

## Alternatives considered

| Approach | Trade-off score | One-line |
|----------|-----------------|----------|
| **Opt 1 — Observe + harden review** | 3.4 / 5 | Cheapest; reuse stays reactive, traversal planned-only |
| **Opt 2 — Shift-left into implementer** ✅ | **4.1 / 5** | Proactive reuse via proven artifact gate; no planner/schema change |
| **Opt 3 — Full audit trail** | 3.2 / 5 | Real actual-path history; concurrent-write/schema-rollout risk |
| *(rejected pre-Gate-2)* Planner-side reuse gate | 2.1 / 5 | Destroys Quick determinism; trips Accretion-Guard + Extension-Tax |

Scored on: fitness-to-requirement, blast radius, governance safety, cost, honesty-of-signal.

**Adversarial findings** (three parallel x-architect critics, one per approach):

- *Domain-inherent (all approaches):* `route.revision`/`computed_at_phase` are overwritten scalars
  — an "actual path history" is **not reconstructable** without a persisted append-only log; showing
  them as a traversal misrepresents a snapshot as history. → Opt 2 renders **planned chain + current
  phase** honestly; only Opt 3 claims actual history (and pays for it). A "Waves" section requires
  re-implementing the topo-sort client-side regardless.
- *Killed the planner-side gate:* forcing conventions onto Quick track has no defined LOC valve
  (determinism loss) and trips the Accretion-Guard + Extension-Tax governance gates.
- *Killed the shared `reuse-scan.md` file:* only two consumers → premature abstraction (V-YAGNI-02);
  the codebase's established pattern is inline-per-agent grep. Opt 2 keeps detection in one locus
  (implementer produces / reviewer verifies) without a new shared file.
- *Corrected Opt 1's framing:* the reviewer live-grep is the **unconditional** path for 100% of
  Quick-track PRs, not a rare fallback — so Opt 1 alone leaves reuse reactive and pays the grep cost
  anyway. Opt 2 keeps that fallback but adds pre-write prevention.
- *Corrected a theatre risk:* a prose "nudge" with no artifact is enforcement theatre. Opt 2 uses the
  proven PR-body artifact gate (the only implementer pattern shown to actually change behavior).

## Design principles validation

| Principle | Verdict | Note |
|-----------|---------|------|
| SRP | ✓ | Each new fn/gate has one responsibility; produce vs. verify split cleanly |
| OCP | ✓ | `route?` optional + additive sections extend without modifying existing paths |
| LSP | N/A | No inheritance hierarchy |
| ISP | ✓ | `renderRouteChain`/`computeWaves` are narrow pure fns |
| DIP | N/A | Script-level, no injected abstractions warranted (KISS) |
| DRY | ✓ | `computeWaves` mirrors queue-dag §4 — risk noted (see Risks); reuse detection single-locus |
| KISS | ✓ | No new shared file, no new persisted field, no planner change |
| YAGNI | ✓ | Rejected the shared `reuse-scan.md` (2 consumers) and the traversal-log (Opt 3) as premature |
| SoC | ✓ | Visibility (read-model) fully decoupled from reuse (contract) |
| Composition > inheritance | ✓ | Pure-function composition in the formatter |
| Law of Demeter | ✓ | Renderers take plain `route`/`issue` values, no reach-through |
| Fail Fast | ✓ | Missing Reuse Check artifact → reviewer BLOCK at the gate, not silently |
| GoF patterns | N/A | No creational/structural/behavioral pattern warranted — forcing one is V-KISS-01 |

## Refactoring impact

| Consumer | Affected surface | Classification | Migration |
|----------|------------------|----------------|-----------|
| `campaign-resume-signal.ts` | `groupIssuesByPhase` (unchanged) | TRANSPARENT | none — signature untouched |
| `recovery-drift.ts` | Its own separate `QueueIssue` type | TRANSPARENT | none — distinct definition |
| `campaign-status.test.ts` | `formatDashboard` output + new fns | DEPRECATION | add test cases (TDD, required) |
| `coordinator`/`orchestrator` (`bun run status`) | dashboard output string | TRANSPARENT | none — they print more output |
| PRs from `implementer` | PR body must include Reuse Check | BREAKING (intentional) | new gate: reviewer BLOCKs if absent |

Total: 5 consumers, 3 TRANSPARENT / 1 test-update / 1 intentional new gate. Under the >5 / cross-cutting
threshold — no phased migration needed.

## Key assumptions

| Assumption | Marker | Note |
|------------|--------|------|
| `computeWaves` can be kept behaviorally identical to queue-dag §4 | ~ Contestable | Two implementations of one algorithm; mitigate with a shared fixture test |
| The proven PR-artifact gate pattern actually changes implementer behavior | ✓ Validated | Bugfix-Gate / docs-only Drift-Check are existing, enforced precedents |
| Planned-chain + current-phase is sufficient for "best-path assurance" | ~ Contestable | If the user later needs *actual* history, revisit Opt 3's traversal log |
| Router re-triage of the standing queue is safe to force | ◐ Blind spot | Confirm re-route idempotency on already-acted-on flags before rollout |
| `route{}` is always well-formed when present | ✓ Validated | Router writes the complete object atomically (router.md § Write protocol) |

The ◐ blind spot (router re-triage safety) should be verified during x-plan before rollout is scheduled.

## Risks

- **Wave-algorithm drift** (MEDIUM): `computeWaves` and orchestrator scheduling could diverge.
  Mitigate with a shared test fixture asserting identical wave output for representative queues.
- **Reuse Check artifact quality** (MEDIUM): a low-effort grep could produce a hollow artifact.
  Mitigate via reviewer spot-check (mirror the docs-only Drift-Check accuracy spot-check).
- **Rollout surprise** (LOW): re-triaging the standing queue may reclassify issues mid-campaign;
  gate the rollout behind the ◐ idempotency check above.

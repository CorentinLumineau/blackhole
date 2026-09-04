---
type: research
status: current
created: 2026-09-04
last_updated: 2026-09-04
review_trigger: "on file change"
issue: 452
confidence: 90
computed_at_revision: 1
---

## Executive Summary

Issue #452 is **confirmed**: blackhole has **no hunt kind** that performs backlog-hygiene triage (open-issue duplicate detection, stale-referent validation, or low-information enrichment). The default `kaizen.kinds` roster has grown to **nine** kinds (`config-template.md`); all scan **code**, **documentation**, **merged campaign output**, or **campaign metadata for systemic patterns** — none walks **open forge issues** as primary territory.

The closest existing mechanisms — forge-sync ingest dedup (`forge-sync.md` §4), Handle's procedural dedup checklist (`phase-handle.md`), `retrospective` hunt's ledger/PR cross-correlation (`hunt/retrospective.md`), and F-PARITY-01 forge/queue parity (`SKILL.md`) — do **not** compare two open issues for overlap, verify that named paths/symbols still exist, or enrich sparse bodies before routing. Mercure's `git-issue/references/mode-triage.md` Phases 2–4 (cited in `mercure-parity-surface.md` §5b, matrix row PM-089) remain the documented parity target.

A new hunt kind (e.g. `backlog` or `backlog-hygiene`) would be a **pure additive extension** under ADR-006 — same `hunter` agent, `V-HUNT-01` CONFIRMED verification, `V-PARETO-02` scoring, per-wave cap, and `phase-loop.md` § Kaizen hunt dispatch — with territory = open scoped issues from `gh issue list` + `queue.json`, and dispatch timed like the every-n-loops interleave (step 0, before ready-set build) to satisfy the AC "runs before wave scheduling."

## Findings

### 1. Default hunt kinds and what each scans

**Source:** `src/references/config-template.md:55`, `src/agents/hunter.md:16-17`, `src/references/hunt/*.md`.

| Kind | Primary territory | Scans open issues / backlog? |
|------|-------------------|------------------------------|
| `quickwins` | Source files (dead code, size, nesting, tests, YAGNI) | No — `hunt/quickwins.md` |
| `best-practices` | Source files (SOLID/DRY/KISS/YAGNI triggers) | No — `hunt/best-practices.md` |
| `coverage` | Test runner coverage bands over source | No — `hunt/coverage.md` |
| `refactor` | Cross-module code structure | No — `hunt/refactor.md` |
| `bug` | Reproducible code defects (`file:line`) | No — `hunt/bug.md` |
| `retrospective` | `findings-ledger.json`, archived ledger snapshots, merged PR history; **explicitly avoids** using `queue.json.review_iteration` post-merge | **Partial** — reads campaign metadata for V-code clusters, touch-path hotspots, review-round outliers; does **not** compare open issues, check stale referents, or enrich bodies — `hunt/retrospective.md:6-11`, `:50-54` |
| `parity` | Campaign merged PRs + `documentation/` artifacts | No — `hunt/parity.md:6-9` |
| `ux-coherence` | Product surfaces, `DESIGN.md`, `journeys.md` | No — `hunt/ux-coherence.md:9-12` |
| `docs` | Consumer `documentation/` tree (INDEX rows, `supersedes:` chains) | No — `hunt/docs.md:32-37` |

**Count drift:** Issue #452 body says "eight" kinds including "the security surface." The shipped default is **nine** kinds (`config-template.md:55`); there is **no** `security` hunt kind under `src/references/hunt/`. Security review is route-driven reviewer enrichment (`orchestrator-delegation.md` § Per-flag confidence gate), not kaizen territory.

**Campaign config:** Live `.blackhole/config.json` has **no `kaizen` block** (kaizen opt-in per `config-template.md` contract note) — hunting is inert for this campaign regardless; the gap is structural in the protocol, not campaign-specific.

### 2. Existing dedup / backlog touchpoints — and what they omit

| Mechanism | What it deduplicates | Gap vs #452 AC |
|-----------|---------------------|----------------|
| **Forge sync ingest** (`forge-sync.md` §4) | New forge issue **number** not already in `queue.json.issues` | One-way ingest only; no similarity between two open issues |
| **Handle dedup checklist** (`phase-handle.md:11`) | Lists "open issues, PRs, queue.json, findings-ledger.json" as orchestrator checklist item | **No documented algorithm** for cross-issue similarity, stale paths, or enrichment — procedural intake step only |
| **Hunt wave dedup** (`phase-loop.md` § Kaizen step 2) | Ledger `(vcode, file, line, issue_ref)` + open `[Kaizen]` issues by title/`file:line` | Applies only to **code findings** filed from hunt waves, not open backlog issues |
| **F-PARITY-01** (`SKILL.md` F-HUNT table adjacent F-PARITY-01) | Forge vs `queue.json` membership and terminal status drift | Structural parity, not semantic duplicate or stale-referent detection |
| **`route.body_hash`** (`queue-dag.md`, `router.md`) | Staleness of **same** issue body across re-routes | Per-issue revision tracking, not cross-issue dedup |

**Conclusion:** `mercure-parity-matrix.md` PM-089 and `mercure-parity-surface.md` §5b row ("Blackhole dedups issues against its own queue, never two open issues against each other") are **accurate** against current `src/` references.

### 3. Gap mapped to issue #452 acceptance criteria

| AC | Current state | Evidence |
|----|---------------|----------|
| Hunt kind scans **open issues** not code | **Absent** — no `hunt/backlog*.md`, no kind in `kaizen.kinds` default or `src/references/hunt/` | Table §1 above |
| Duplicate detection between open issues (similarity rule, propose consolidation) | **Absent** — no similarity rule in forge-sync, router, or hunt refs | `forge-sync.md` §4; PM-089 |
| Stale-referent check (Glob/Grep paths/symbols from issue) | **Absent** at intake/hunt layer; touch_paths come from `default_touch_paths` or body hints at ingest (`forge-sync.md` §4) with no existence verification | `forge-sync.md:97` |
| Low-information enrichment before Handle / confidence gate | **Absent** — sparse bodies hit `clarify-gates.md` / router confidence gates at Handle (`phase-handle.md` § Clarify; `orchestrator-delegation.md` § Per-flag confidence gate) with no pre-scan enrichment pass | Issue body "north star" rationale |
| Runs before wave scheduling | **Pattern exists** for kaizen interleave: `phase-loop.md` § Next batch step 0 dispatches hunt **before** step 2 ready-set build when `trigger: every-n-loops` | New kind should hook same step-0 slot |
| Honors `V-HUNT-01` + per-wave cap | **Mechanism exists** for all hunt kinds; a backlog kind would reuse `phase-loop.md` § Kaizen 5-step protocol unchanged | `hunter.md` § Verification pass; `blackhole-protocol.md` § Kaizen Hunt |

### 4. Hunt dispatch architecture (implementation anchor)

- **Single protocol:** `orchestrator-dispatch.md` § Kaizen hunt dispatch → `phase-loop.md` § Kaizen hunt dispatch (5 steps: spawn, dedup, gate+file, cap, watermark).
- **Triggers:** manual `hunt [kind]` (`SKILL.md`), on-empty (`phase-loop.md` § Campaign complete), every-n-loops interleave (`phase-loop.md` § Next batch step 0).
- **Hunter contract:** one kind per spawn, read-only, returns `findings[]` with `file`/`line`/`verification: CONFIRMED|STALE` (`worker-schemas.md` § Hunter).
- **Filing:** `[Kaizen]` issues via `hunt/filing.md`; bug severity floor + `V-PARETO-02` (`phase-loop.md` step 3).

A backlog-hygiene kind would need a **Finding file/line convention** (precedent: `retrospective.md` § Finding file/line convention uses sentinels like `pr:<n>` and `line: 0` for non-file-shaped findings) — e.g. `issue:<number>` for duplicate pairs or stale-referent flags.

### 5. `retrospective` nuance — does not close the gap

`retrospective` is the only kind whose territory includes `queue.json` (`hunt/retrospective.md:6-8`), but its heuristics are limited to:
1. Recurring V-code clusters in the ledger
2. Touch-path hotspots across **merged** PRs
3. Review-iteration outliers from **merged** PR review activity (not `queue.json.review_iteration`)
4. Architectural framing for design-track routing

It explicitly **must not** use live queue fields that are zeroed on merge (`hunt/retrospective.md:50-54`). It does not implement mercure triage Phases 2–4 (duplicate / stale-referent / low-info).

### 6. Mercure parity reference (external, cited in-repo)

`documentation/audits/mercure-parity-surface.md` §5b (Priority 48) and `mercure-parity-matrix.md` PM-089 attribute the missing capability to mercure `git-issue/references/mode-triage.md` **Phases 2–4**: duplicate open-issue triage, stale-referent checks, and low-information enrichment. Mercure source is not vendored in this repo; the parity audit is the authoritative cross-reference.

### 7. Risks / design constraints for implementers

1. **Finding shape:** Hunter findings require `file` + `line` (`worker-schemas.md`); backlog findings need a documented sentinel convention (see `retrospective.md` precedent).
2. **Verification (`V-HUNT-01`):** Duplicate proposals require re-read of both issue bodies; stale-referent requires Glob/Grep confirmation that paths/symbols are absent — both are CONFIRMED-verifiable.
3. **Consolidation vs auto-close:** Issue AC requires **propose consolidation**, not auto-close — filing should use `[Kaizen]` template with human-action wording (`hunt/filing.md`).
4. **Enrichment vs forge mutation:** Low-info enrichment ahead of Handle may require `gh issue edit` or queue notes — outside current hunter write policy (orchestrator files issues; hunter is read-only). Likely orchestrator post-wave action, not hunter Bash write.
5. **Scope:** Open issues filtered by `forge-scope.ts` / `issueMatchesScope` (`forge-sync.md` §1.5–2) — backlog scan should use the same scope, not the full forge.
6. **Issue body "security surface":** Treat as outdated wording; no security hunt kind exists — security remains reviewer route-gated.

## Sources

| Source | Relevance |
|--------|-----------|
| GitHub issue #452 (title, body, labels) | Problem statement, AC, north-star rationale |
| `.blackhole/queue.json` issue `452.route.revision` | `computed_at_revision: 1` |
| `src/references/config-template.md` | Default `kaizen.kinds` (9 kinds), kaizen opt-in contract |
| `src/agents/hunter.md` | Hunter role, kind list, verification pass, wave note path |
| `src/references/hunt/{quickwins,best-practices,coverage,refactor,bug,retrospective,parity,ux-coherence,docs}.md` | Per-kind territory and heuristics |
| `src/references/phase-loop.md` | Kaizen dispatch (5-step), every-n-loops step-0 timing, hunt dedup |
| `src/references/orchestrator-dispatch.md` § Kaizen hunt dispatch | Hunter spawn contract |
| `src/references/forge-sync.md` | Ingest dedup (issue number only), touch_paths at ingest |
| `src/references/phase-handle.md` | Handle dedup checklist (no cross-issue algorithm) |
| `documentation/audits/mercure-parity-surface.md` §5b | Gap filed as #452, mercure triage Phases 2–4 citation |
| `documentation/audits/mercure-parity-matrix.md` PM-089 | Backlog-hygiene gap row |
| `.blackhole/config.json` | No `kaizen` block in live campaign (hunting inert) |

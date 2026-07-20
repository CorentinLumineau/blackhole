---
name: prj-mercure-sync
description: >-
  Compare blackhole against the latest mercure plugin releases and file gated
  adoption issues. Use when asked to sync with mercure, review mercure's
  changelog, check for upstream patterns to adopt, or run a mercure sync.
disable-model-invocation: true
---

# Mercure Sync

Maintainer workflow for reviewing what shipped in recent **mercure** plugin releases — and, more
broadly, the mercure enforcement surface tracked in `documentation/audits/mercure-parity-matrix.md`
— and deciding what, if anything, blackhole should adopt — filtered through blackhole's own
philosophy (Adoption Lens v2), never copied wholesale. This is a self-development tool for the
blackhole *project*, not a campaign capability: it does not compile through `src/` and never
ships to consumer repos running a blackhole campaign (they have no reason to diff themselves
against mercure). Precedent: [`prj-create-release`](../prj-create-release/SKILL.md).

## Prerequisites

- `gh auth status` succeeds, with read access to `CorentinLumineau/mercure` and write access
  to this repo's issues
- `documentation/audits/mercure-sync.md` exists (created by the first run)
- `documentation/audits/mercure-parity-matrix.md` exists (created by M2's seed run). Release
  mode and backlog mode below both require it — until M2 ships, this skill's dual-mode workflow
  text is written but not yet runnable end-to-end. `scripts/checks/parity-matrix.check.ts`
  (`V-PMATRIX-01`) tolerates this by design: it returns `ok: true` unread while the matrix file
  is absent, and becomes load-bearing the moment M2 creates it — no further code change needed.

## Contract

| Artifact | Path |
|----------|------|
| Living audit doc | `documentation/audits/mercure-sync.md` |
| Last-reviewed watermark | `last_reviewed_mercure_version` frontmatter field on that doc |
| Parity matrix | `documentation/audits/mercure-parity-matrix.md` |
| Filed issues | `[Upstream] <summary>` via `gh issue create`, `deferred_to_issue` linkage in `findings-ledger.json` |
| Filing cap/kill-switch | optional `.blackhole/config.json` `mercure_sync` block: `{ "enabled": true, "max_issues_per_run": 5, "min_priority": 30 }` — absent block = these defaults |

## Adoption Lens v2

Every mercure mechanism gets classified against blackhole's own design identity before it is
ever considered for adoption — this lens *is* the point of the skill. Lens v2 (ADR-013 D2)
replaces the old REJECT-biased posture: the evidence showed the actual bottleneck is **sweep
throughput** (~65 mercure domains never swept in 3 runs), not over-adoption — every domain
swept so far shipped adoptions. Classification is now by **mechanism kind**, with a per-kind
default posture and a stated burden of proof required to overturn that default:

| Tier | Default | Burden of proof |
|---|---|---|
| Enforcement/quality mechanisms (V-codes, checklists, gates, verification protocols) | **ADOPT** | Rejecting requires showing it structurally cannot work autonomously |
| Workflow/interaction mechanisms (approval gates, chaining, interview) | **ADAPT** — translate to async seams (`status: blocked`, confidence gates, deterministic verdicts) | Adopting verbatim requires showing no sync-HITL dependency |
| Domain/runtime-ops mechanisms (SRE, incident response, deployment) | **N/A** | Adopting requires showing backlog-orchestration relevance |

Only two **hard rejections** survive from the old lens — everything else below is a rebuttable
tier default, not an absolute:

1. **Synchronous, mid-loop human gating as a primitive.** Blackhole's answer to "ask the human"
   is already async — `AskQuestion` + `status: blocked`, resolved whenever a human next engages,
   never a live turn-blocking wait (see `README.md` § Human-in-the-loop). mercure's
   `AskUserQuestion` pattern is a strictly worse fit for a background orchestrator — never import
   it as a new primitive, even if a specific mercure skill leans on it heavily.
2. **Non-agent-agnostic campaign-runtime mechanisms.** State must live in `.blackhole/` +
   `documentation/` markdown/JSON that any harness can read — never a Claude-Code-only mechanism
   (hooks, MCP-only tools, statusline) inside the campaign runtime. `mercure-sync` itself remains
   a rare, deliberate exception (a maintainer-only project skill under `.claude/skills/`, not
   part of the campaign runtime) — the campaign machinery itself never gets this exception.

The old lens's "almost never a new skill" and "not this domain" filters are **retained as the
tier-2/tier-3 defaults above**, not as REJECT clauses: a workflow/interaction mechanism defaults
to ADAPT (translate to an async seam), not "reject, it grows the skill surface"; a domain/
runtime-ops mechanism defaults to N/A (out of scope by default), not "reject, wrong domain".
Both defaults are rebuttable by the stated burden of proof — they are not automatic REJECTs.

Existing extension-seam-reuse discipline is retained unchanged (`V-INT-02`): check first whether
a hunt kind (`src/references/hunt/*.md`), a `route{}` flag (mirroring
`security_review_required`/`docs_impact`), an existing V-code family, or a `verify.ts` check
already covers the ground. An adoption lands as a mode, route flag, V-code row, hunt kind,
reference file, or verify check whenever one fits; a new agent or campaign subsystem requires
the matrix to show no existing seam can host the mechanism.

`V-PARETO-02` remains the **sole** prioritizer and filing gate — `Priority = Gain × (11 −
Effort)`, both on a 1–10 scale, same formula blackhole already uses for kaizen hunt findings, no
second formula. Pareto orders which ADOPT/ADAPT items get filed, and in what order; **it never
overrides a tier classification** — a mechanism tiered ADOPT stays ADOPT regardless of its
Priority score (a low score just means it waits its turn or sits below the filing floor,
recorded but unfiled); a mechanism tiered N/A never becomes filable no matter how high its
hypothetical Priority would compute.

## Workflow

Two named, numbered entry modes replace the old single changelog-skimming workflow. Both read
and write the same artifacts (`## Contract`) and both restate, **unchanged** from the v1 skill,
four disciplines:

- `V-HUNT-01` verify-before-file — never file an unverified finding.
- Filing cap `mercure_sync.max_issues_per_run` (default 5) and the `min_priority` floor
  (default 30).
- Dedup against open issues **and** matrix `in-flight` refs before filing — the matrix
  `in-flight` check is new in v2 (v1 only dedupped against open issues and its own Outcome
  table).
- This skill never writes `queue.json` or `findings-ledger.json` directly — those files have a
  single-writer invariant (orchestrator-only, `blackhole-state.md`) and `mercure-sync` runs
  outside the orchestrator's own turn. A filed issue surfaces into `queue.json` through the
  ordinary "Native forge sync" ingestion on the campaign's next turn, exactly like any
  human-authored issue.

### Release mode

Trigger: a new mercure release lands above the watermark.

1. **Read the watermark.** Read `last_reviewed_mercure_version` from
   `documentation/audits/mercure-sync.md`'s frontmatter. If the doc does not exist yet, treat
   the watermark as unset and baseline against the current latest release.
2. **List releases since the watermark** (`gh release list --repo CorentinLumineau/mercure`).
3. **Read release notes** for each new version (`gh release view vX.Y.Z --repo
   CorentinLumineau/mercure`), plus the mercure plugin cache directly for mechanism-level detail
   beyond what release notes carry, when the version is present locally
   (`~/.claude/plugins/cache/mercure/mercure/<version>/`).
4. **Map each change to touched matrix rows**, citing rows by id (D1's single-writer/
   row-id-citation contract — `documentation/audits/mercure-parity-matrix.md`), never by table
   position.
5. **Re-verify only the touched rows** against blackhole's current `src/`. On ambiguous mapping,
   or a cross-cutting change (e.g. `rules/`), widen the re-check to every row in the affected
   `kind` tier rather than guessing at a narrower row set.
6. **Apply the Adoption Lens v2** to every touched row still classified `gap`, or one that has
   regressed to `gap` on re-check (`covered → gap` regressions are legal and mandatory per D1).
7. **Score ADOPT/ADAPT items** with `V-PARETO-02`.
8. **Update matrix rows.** A Lens v2 verdict lands as a status transition on the cited row(s) —
   never as prose only (see `## Never`).
9. **File gated issues** for verified ADOPT/ADAPT items at or above `min_priority`, capped at
   `max_issues_per_run`, deduped against open issues and matrix `in-flight` refs.
10. **Bump the watermark** to the latest version covered by this run, and **append a run-log
    entry** to `documentation/audits/mercure-sync.md`.

### Backlog mode

Trigger: maintainer invocation, no new mercure release required.

1. **Take the top-priority `gap`/unswept rows** from
   `documentation/audits/mercure-parity-matrix.md`, ordered by each row's `priority` field
   (`V-PARETO-02`).
2. **Deep-compare each against the pinned plugin cache** — full mechanism content, not just
   release notes.
3. **Apply the Adoption Lens v2** to classify each.
4. **Update rows.** A Lens v2 verdict lands as a status transition on the cited row(s) — never
   as prose only.
5. **File gated issues** for verified ADOPT/ADAPT items at or above `min_priority`, capped at
   `max_issues_per_run`, deduped against open issues and matrix `in-flight` refs.

## References

- [Adaptive routing precedent](../../../documentation/audits/analysis-blackhole-adaptive-phase-routing.md)
- [Companion-files precedent](../../../documentation/audits/mercure-companion-files-gap-analysis.md)
- [ADR-006 — Kaizen Hunt](../../../documentation/decisions/ADR-006-kaizen-hunt.md) (Pareto scoring
  + verify-before-file discipline, ported here without a second formula or a second finding store)
- [ADR-013 — Mercure Parity Program](../../../documentation/decisions/ADR-013-mercure-parity-program.md)
  D1 (matrix row schema, single-writer rule), D2 (Adoption Lens v2), D3 (this skill's dual-mode
  workflow)
- [`documentation/architecture.md`](../../../documentation/architecture.md) — why this skill
  lives outside `src/`

## Never

- Never adopt a mercure mechanism without running it through the Adoption Lens v2 first
- Never adopt a mechanism that fails either of the two Lens v2 hard rejections, and never file
  an issue for an item tiered N/A without a rebuttal that clears its stated burden of proof
- Never file an unverified finding (mirrors `V-HUNT-01`)
- Never invent a second Pareto formula or a second findings store — reuse `V-PARETO-02` and
  `findings-ledger.json`
- Never add a new blackhole skill/subsystem when an existing extension seam (hunt kind, route
  flag, V-code family, `verify.ts` check) already fits (`V-INT-02`)
- Never create a dated variant of `documentation/audits/mercure-sync.md` — always update the one
  canonical file in place
- Never let a Lens v2 verdict land as prose only — it must land as a matrix row **status
  transition** (`gap → in-flight(ref)`, `→ adapted`, `→ covered`, or `N/A(reason)`) on the cited
  row(s) of `documentation/audits/mercure-parity-matrix.md`

---
name: prj-mercure-sync
description: >-
  Compare blackhole against the latest mercure plugin releases and file gated
  adoption issues. Use when asked to sync with mercure, review mercure's
  changelog, check for upstream patterns to adopt, or run a mercure sync.
disable-model-invocation: true
---

# Mercure Sync

Maintainer workflow for reviewing what shipped in recent **mercure** plugin releases and
deciding what, if anything, blackhole should adopt — filtered through blackhole's own
philosophy, never copied wholesale. This is a self-development tool for the blackhole
*project*, not a campaign capability: it does not compile through `src/` and never ships to
consumer repos running a blackhole campaign (they have no reason to diff themselves against
mercure). Precedent: [`prj-create-release`](../prj-create-release/SKILL.md).

## Prerequisites

- `gh auth status` succeeds, with read access to `CorentinLumineau/mercure` and write access
  to this repo's issues
- `documentation/audits/mercure-sync.md` exists (created by the first run)

## Contract

| Artifact | Path |
|----------|------|
| Living audit doc | `documentation/audits/mercure-sync.md` |
| Last-reviewed watermark | `last_reviewed_mercure_version` frontmatter field on that doc |
| Filed issues | `[Upstream] <summary>` via `gh issue create`, `deferred_to_issue` linkage in `findings-ledger.json` |
| Filing cap/kill-switch | optional `.blackhole/config.json` `mercure_sync` block: `{ "enabled": true, "max_issues_per_run": 5, "min_priority": 30 }` — absent block = these defaults |

## Adoption Lens

Every mercure mechanism gets classified against blackhole's own design identity before it is
ever considered for adoption. This lens *is* the point of the skill — the comparison is easy,
the filtering is what keeps blackhole blackhole. Two prior deep-dives already apply this lens
in full and are the reference examples:
[`analysis-blackhole-adaptive-phase-routing.md`](../../../documentation/audits/analysis-blackhole-adaptive-phase-routing.md),
[`mercure-companion-files-gap-analysis.md`](../../../documentation/audits/mercure-companion-files-gap-analysis.md).

**REJECT** a mercure mechanism outright when it:

- Introduces **synchronous, mid-loop human gating** into a worker agent. Blackhole's answer to
  "ask the human" is already async — `AskQuestion` + `status: blocked`, resolved whenever a
  human next engages, never a live turn-blocking wait (see `README.md` § Human-in-the-loop).
  mercure's `AskUserQuestion` pattern is a strictly worse fit for a background orchestrator —
  never import it as a new primitive, even if a specific mercure skill leans on it heavily.
- Grows the **skill surface**. Blackhole is deliberately one skill (`blackhole`) with modes —
  not 74 skills like mercure. A new mercure mechanism almost never becomes a new blackhole
  skill; it becomes a mode, a `route{}` flag, a V-code, a hunt kind, or a reference file
  extending an agent that already exists.
- Is **not agent-agnostic**. State must live in `.blackhole/` markdown/JSON that any harness
  can read — never a Claude-Code-only mechanism (hooks, MCP-only tools, statusline).
  `mercure-sync` itself is a rare, deliberate exception (a maintainer-only project skill under
  `.claude/skills/`, not part of the campaign runtime) — the campaign machinery itself never gets
  this exception.
- **Duplicates an existing extension seam** (`V-INT-02`) — check first whether a hunt kind
  (`src/references/hunt/*.md`), a `route{}` flag (mirroring `security_review_required`/
  `docs_impact`), an existing V-code family, or a `verify.ts` check already covers the ground.
- Doesn't apply to blackhole's **domain**. Blackhole orchestrates a backlog; it does not run a
  production service. mercure mechanisms aimed at runtime operations (incident response, SRE,
  observability dashboards) are out of scope by default — note them as N/A, don't force a fit.

**ADOPT / ADAPT** when a mechanism is:

- **Config-gated, advisory-by-default** — mirrors the `docs_governance`/`kaizen` kill-switch
  pattern: absent block or `enabled: false` preserves current behavior exactly.
- **Findings-ledger-driven, not interactive** — drift or gaps become a WARN finding or an
  auto-filed follow-up issue through the existing Pareto path, never a mid-loop question.
- **Additive to an existing seam** — a new hunt kind, a new `route{}` flag consumed by
  existing orchestrator dispatch, a new V-code row, a new `verify.ts` check.

## Workflow

1. **Read the watermark.** Read `last_reviewed_mercure_version` from
   `documentation/audits/mercure-sync.md`'s frontmatter. If the doc does not exist yet, this is
   the first run — treat the watermark as unset and baseline against the current latest release.
2. **List releases since the watermark.**
   ```bash
   gh release list --repo CorentinLumineau/mercure
   ```
   If the watermark's version is already the latest, still consider running one *targeted* sweep
   of a mercure domain not yet covered by any prior sync entry (see the doc's coverage table) —
   don't report "nothing to do" just because no new tag landed; the backlog of *uncompared*
   mercure domains is usually larger than the backlog of *new releases*.
3. **Read release notes** for each new version:
   ```bash
   gh release view vX.Y.Z --repo CorentinLumineau/mercure
   ```
   For deeper mechanism-level detail than release notes carry, read the mercure plugin cache
   directly if the relevant version is present locally
   (`~/.claude/plugins/cache/mercure/mercure/<version>/`) — skills, agents, and rules content,
   not just the changelog line.
4. **Cross-reference against blackhole's current `src/`** (grep/read `src/agents/`,
   `src/references/`, `src/references/hunt/`, `src/references/blackhole-vcodes.md`) to classify
   each notable mercure mechanism: already-covered, or a genuine gap.
5. **Apply the Adoption Lens** to every gap: ADOPT / ADAPT / REJECT / N/A, each with a one-line
   rationale citing the specific principle satisfied or violated.
6. **Score ADOPT/ADAPT items** with `V-PARETO-02`: `Priority = Gain × (11 − Effort)`, both on a
   1–10 scale, same formula blackhole already uses for kaizen hunt findings — no second formula.
7. **Update `documentation/audits/mercure-sync.md` in place** (search-before-write; this file
   *is* the canonical path — never create a dated variant). Sections: frontmatter (including
   `last_reviewed_mercure_version`), Coverage table (which mercure domains have been swept, by
   which run/date), this run's Gap matrix, Adoption Lens verdicts, Pareto-scored backlog,
   Outcome table (filed issue links, updated after step 8).
8. **File gated issues.** For each ADOPT/ADAPT item with `Priority >= mercure_sync.min_priority`
   (default 30) that is independently re-verified (re-read the cited mercure source, confirm
   still absent from blackhole `src/` — mirrors `V-HUNT-01`'s verify-before-file discipline):
   ```bash
   gh issue create --repo CorentinLumineau/blackhole \
     --title "[Upstream] <summary>" \
     --body "<Summary / mercure source citation / Gain·Effort·Priority footer / adoption approach>"
   ```
   Dedup against open issues and the audit doc's own Outcome table first — never re-file. Cap at
   `mercure_sync.max_issues_per_run` (default 5); excess above-floor items stay recorded in the
   audit doc for the next run, never dropped (mirrors kaizen hunt's never-drop-findings rule).
   This skill never writes `queue.json` or `findings-ledger.json` directly — those files have a
   single-writer invariant (orchestrator-only, `blackhole-state.md`), and `mercure-sync` runs
   outside the orchestrator's own turn. The filed issue surfaces into `queue.json` through the
   ordinary "Native forge sync" ingestion on the campaign's next turn, exactly like any
   human-authored issue — no special ledger bookkeeping from this skill.
9. **Record outcomes** — append filed issue links to the audit doc's Outcome table. This table,
   not `findings-ledger.json`, is `mercure-sync`'s durable record of why each issue was filed.
10. **Bump the watermark** — set `last_reviewed_mercure_version` to the latest version actually
    covered by this run.

## References

- [Adaptive routing precedent](../../../documentation/audits/analysis-blackhole-adaptive-phase-routing.md)
- [Companion-files precedent](../../../documentation/audits/mercure-companion-files-gap-analysis.md)
- [ADR-006 — Kaizen Hunt](../../../documentation/decisions/ADR-006-kaizen-hunt.md) (Pareto scoring
  + verify-before-file discipline, ported here without a second formula or a second finding store)
- [`documentation/architecture.md`](../../../documentation/architecture.md) — why this skill
  lives outside `src/`

## Never

- Never adopt a mercure mechanism without running it through the Adoption Lens first
- Never file an issue for a REJECT- or N/A-classified item
- Never file an unverified finding (mirrors `V-HUNT-01`)
- Never invent a second Pareto formula or a second findings store — reuse `V-PARETO-02` and
  `findings-ledger.json`
- Never add a new blackhole skill/subsystem when an existing extension seam (hunt kind, route
  flag, V-code family, `verify.ts` check) already fits
- Never create a dated variant of `documentation/audits/mercure-sync.md` — always update the one
  canonical file in place

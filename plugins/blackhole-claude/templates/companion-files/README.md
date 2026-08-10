# Companion-file templates — blackhole campaign

Source templates for the companion files that `reviewer.md` §10's V-ADA audit
(`V-ADA-01/02/03/05/06/07`) checks for: `ARCHITECTURE.md`, `AGENTS.md`, `DESIGN.md`. Also
includes `product-principles.md.template`, the owner-rulings ledger `reviewer.md` §19's
`V-RULE-01` audit checks for, and `journeys.md.template`, the first companion file whose
activation is driven by a **hunt kind** (`ux-coherence`) rather than by project structure or
frontend detection — see § `journeys.md` hunt-kind gate below.
`src/SKILL.md` Phase 0's companion-file scaffold step creates these at the repo root
when missing — see that step for the full runtime contract; this README documents
what each template is for and the substitution/skip rules the scaffold follows.

## Templates

| File | Root file it seeds | Scope |
|------|--------------------|-------|
| `ARCHITECTURE.md.template` | `ARCHITECTURE.md` | Repo root — living codebase comprehension doc |
| `AGENTS.md.template` | `AGENTS.md` | Repo root — behavioral config, symlinked from `CLAUDE.md` |
| `DESIGN.md.template` | `DESIGN.md` | Repo root — visual design tokens, frontend-only |
| `product-principles.md.template` | `documentation/reference/product-principles.md` | Owner-rulings ledger — unconditional, not frontend-gated, same skip-if-exists treatment as `ARCHITECTURE.md`/`AGENTS.md` |
| `journeys.md.template` | `journeys.md` | Repo root — hunt-kind-gated: `kaizen.enabled && kaizen.kinds` includes `ux-coherence`, the first companion file activated by a hunt kind rather than project structure or frontend detection |
| `package-AGENTS.md.template` | *(reference only)* | Per-package `AGENTS.md` — not auto-instantiated |
| `package-ARCHITECTURE.md.template` | *(reference only)* | Per-package `ARCHITECTURE.md` — not auto-instantiated |

`package-*.template` files ship for future/manual use only. The scaffold step does
**not** walk detected monorepo packages and instantiate these per-package — that is
a deliberate non-goal (a reasonable future issue, not this one's scope).

## `{project-name}` substitution

The scaffold reads `.blackhole/config.json`'s `repo` field (`owner/repo-name`
format — see `src/references/config-template.md`) and substitutes the segment
after the `/` for every `{project-name}` placeholder. When `config.repo` is
absent or does not contain a `/`, it falls back to `basename "$(pwd)"` (the repo
root directory's own name).

## Skip-if-exists, never overwrite

The scaffold step creates `ARCHITECTURE.md` / `AGENTS.md` / `DESIGN.md` /
`documentation/reference/product-principles.md` **only when the target file does not
already exist**. An existing file — however stale — is left untouched. This makes the
scaffold idempotent: running Phase 0 repeatedly never clobbers a companion file a human
or agent has since edited.

## `DESIGN.md` frontend gate

`DESIGN.md` is created only when both of these hold:

1. `docs_governance.enabled` resolves to `true` (absent block or explicit `false` skips this —
   SSOT: `config-template.md`'s `docs_governance.enabled` row, issue #477) and
   `docs_governance.companion_files` is not `false` in `.blackhole/config.json`
   (the same config gate that wraps this entire scaffold step).
2. `bash scripts/detect-frontend.sh` emits `frontend=yes` on the target repo.

`scripts/detect-frontend.sh` is the single source of truth for the
frontend-detection keyword set — this scaffold invokes it rather than
restating any part of that keyword list.

## `journeys.md` hunt-kind gate

Unlike every other companion file, `journeys.md` is not gated on universal scaffolding
(`ARCHITECTURE.md`/`AGENTS.md`/`product-principles.md`) or on frontend detection
(`DESIGN.md`). It is created only when **all three** hold:

1. `docs_governance.enabled` resolves to `true` (absent block or explicit `false` skips this —
   SSOT: `config-template.md`'s `docs_governance.enabled` row, issue #477) and
   `docs_governance.companion_files` is not `false` in `.blackhole/config.json` (the same
   config gate that wraps this entire scaffold step).
2. `kaizen.enabled` is `true`.
3. `kaizen.kinds` contains `ux-coherence`.

This triple gate keeps a hunt-kind-scoped artifact from being written into every consumer
repo's scaffold regardless of whether that repo has opted into the kind that reads it
(`src/references/hunt/ux-coherence.md` § Scan heuristics, journeys heuristic).

The instantiated `journeys.md` ships with frontmatter `status: template` and an
`<!-- STATUS: unfilled template ... -->` sentinel comment. The `ux-coherence` journeys band
treats a still-`status: template` file as **not yet ground truth** and no-ops for the wave
(logged, not failed) rather than auditing against placeholder content — the owner must replace
the template's example `## Job:` section with real, owner-approved core user jobs and flip
`status` to `current` before the journeys heuristic audits normally.

## Full contract

See `src/SKILL.md` Phase 0's "Companion-file scaffold" step for the exact
gating, ordering, and fallback logic the orchestrator executes at runtime.

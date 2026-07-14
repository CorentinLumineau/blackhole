# Companion-file templates — blackhole campaign

Source templates for the companion files that `reviewer.md` §10's V-ADA audit
(`V-ADA-01/02/03/05/06/07`) checks for: `ARCHITECTURE.md`, `AGENTS.md`, `DESIGN.md`.
`src/SKILL.md` Phase 0's companion-file scaffold step creates these at the repo root
when missing — see that step for the full runtime contract; this README documents
what each template is for and the substitution/skip rules the scaffold follows.

## Templates

| File | Root file it seeds | Scope |
|------|--------------------|-------|
| `ARCHITECTURE.md.template` | `ARCHITECTURE.md` | Repo root — living codebase comprehension doc |
| `AGENTS.md.template` | `AGENTS.md` | Repo root — behavioral config, symlinked from `CLAUDE.md` |
| `DESIGN.md.template` | `DESIGN.md` | Repo root — visual design tokens, frontend-only |
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

The scaffold step creates `ARCHITECTURE.md` / `AGENTS.md` / `DESIGN.md` **only when
the target file does not already exist**. An existing file — however stale — is
left untouched. This makes the scaffold idempotent: running Phase 0 repeatedly
never clobbers a companion file a human or agent has since edited.

## `DESIGN.md` frontend gate

`DESIGN.md` is created only when both of these hold:

1. `docs_governance.companion_files` is not `false` in `.blackhole/config.json`
   (the same config gate that wraps this entire scaffold step).
2. `bash scripts/detect-frontend.sh` emits `frontend=yes` on the target repo.

`scripts/detect-frontend.sh` is the single source of truth for the
frontend-detection keyword set — this scaffold invokes it rather than
restating any part of that keyword list.

## Full contract

See `src/SKILL.md` Phase 0's "Companion-file scaffold" step for the exact
gating, ordering, and fallback logic the orchestrator executes at runtime.

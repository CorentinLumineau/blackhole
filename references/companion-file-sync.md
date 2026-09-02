# Companion-file Sync (implement-time, Phase 5.5)

Mercure-parity reference for the implementer's **Companion-file Sync** gate (`implementer.md`
§ Companion-file Sync). Repairs root companion files that the read-only reviewer flags as
`V-ADA-01` / root `V-ADA-05` — in the **same PR** that triggers them, not as a follow-up.

Templates are read from `templates/companion-files/{name}.template` (never inlined in agent
prompts). Substitution rules match `templates/companion-files/README.md` and `src/SKILL.md`
Phase 0 step 2: `{project-name}` from `.blackhole/config.json` `repo` (`owner/repo-name` →
`repo-name`), or `basename(repoRoot)` when `repo` is absent or has no `/`.

## Config gate

Inert when `docs_governance.enabled` does not resolve to `true` or
`docs_governance.companion_files === false` — same gate shape as `reviewer.md` §10.

## Procedure (implementer)

1. After incremental implementation, **before** `git add`: collect the list of paths about to be
   staged.
2. Run:
   ```bash
   bun run scripts/lib/companion-file-sync.ts --repo-root <worktree-abs> --diff-file <paths.txt>
   ```
3. Stage and commit any files the CLI created/repaired in the **same PR** as the triggering diff.
4. PR body: one `Companion-file repair:` line per repair (`vcode`, `file`, `action`).
5. Return JSON `companion_repairs[]` — one `{ vcode, file, action }` row per repair performed.

Never create `ARCHITECTURE.md` or repair `AGENTS.md` when the trigger predicates below are
false (no drive-by repairs).

## Triggers

### `V-ADA-01` — root `ARCHITECTURE.md` absent

| Predicate | Rule |
|-----------|------|
| File state | `ARCHITECTURE.md` missing at repo root |
| Diff scope | At least one staged path matches a **code-surface** prefix (below) and the diff is **not** exclusively `documentation/**` `*.md` |

**Code-surface prefixes** (repo-relative):

- `src/`, `scripts/`, `lib/`, `apps/`, `packages/`, `services/`
- `.cursor/`, `.claude/`, `codex-skills/`, `codex-agents/`, `templates/hooks/`, `plugins/`
- Root manifests: `package.json`, `tsconfig.json`, `bun.lock`, `bun.lockb`, `Cargo.toml`, `go.mod`, `pyproject.toml`

Helper: `needsArchitectureRepair(repoRoot, diffPaths)` in `scripts/lib/companion-file-sync.ts`.

**Repair**: `createArchitectureFromTemplate` — copy
`templates/companion-files/ARCHITECTURE.md.template` → `ARCHITECTURE.md` with
`{project-name}` substitution. **Never overwrite** an existing file.

### Root `V-ADA-05` — `AGENTS.md` absent or a symlink not pointing at `CLAUDE.md`

| Predicate | Rule |
|-----------|------|
| File state | Root `AGENTS.md` absent, or a symlink whose resolved target is not `CLAUDE.md` — a regular, non-symlink `AGENTS.md` is left untouched (not repaired) |
| Diff scope | At least one staged path matches an **agent-surface** prefix (below) |

**Agent-surface prefixes**:

- `src/agents/`, `.cursor/agents/`, `.cursor/rules/`, `.claude/agents/`
- `codex-agents/`, `codex-skills/blackhole/agents/`
- Root `AGENTS.md`, `CLAUDE.md`

Helper: `needsAgentsSymlinkRepair(repoRoot)` for file state; agent-surface diff check is
combined in `runCompanionFileSync`.

**Repair**: `repairAgentsSymlink` — a distinct regular (non-symlink) `AGENTS.md` is left
untouched (returns `[]`, no writes). Otherwise, ensure `CLAUDE.md` exists (from
`templates/companion-files/AGENTS.md.template` if absent, skip-if-exists), then replace
`AGENTS.md` with symlink `AGENTS.md` → `CLAUDE.md` (remove a broken symlink first). Symlink
only — no copy fallback.

### `V-ADA-09` — root `documentation/INDEX.md` missing a row for `journeys.md`

| Predicate | Rule |
|-----------|------|
| File state | `documentation/reference/journeys.md` exists and `documentation/INDEX.md` exists and has no row for `reference/journeys.md` |
| Diff scope | none — unconditional, purely additive, see Codebase Conventions |

Unlike `V-ADA-01`/`V-ADA-05`, this repair carries no diff-path predicate: it only ever fires
when `journeys.md` already exists on disk, so it cannot cause a drive-by file creation (issue
#728).

Helper: `needsJourneysIndexRepair(repoRoot)` for file state; `repairJourneysIndexRow(repoRoot)`
appends the row via `appendIndexRowIfAbsent` (`scripts/lib/check-common.ts`).

**Repair**: `repairJourneysIndexRow` — appends a `reference/journeys.md` row
(`type: reference`, `status: template`, `reviewTrigger: on ADR acceptance`) to
`documentation/INDEX.md`. No-op (returns `null`) when `journeys.md` is absent, when
`documentation/INDEX.md` is absent, or when the row already exists.

## Out of scope (this reference)

- `DESIGN.md` / `V-ADA-03`
- Package-level `V-ADA-06/07`
- `V-ADA-02` INDEX append (Carry Staged Artifacts)
- Monorepo per-package `ARCHITECTURE.md` / `AGENTS.md` auto-walk
- `journeys.md`'s own *creation* stays bootstrap-only (`src/SKILL.md` Phase 0 step 2), never
  implement-time — only the INDEX row repair above runs at implement-time

## Ledger contract

On `status: complete`, the orchestrator matches each `companion_repairs[]` row's `(vcode, file)`
against open/deferred ledger rows using the **V-ADA-01/V-ADA-05/V-ADA-09 dedup** rule (ignore
`issue_ref`), sets `status: fixed-in-pr`, `pr_ref`, and appends `companion-repair: <action>` to
`summary`. See `findings-ledger.md` § Status transitions.
<!-- GENERATED by scripts/build.ts from src/references/companion-file-sync.md — do not hand-edit -->

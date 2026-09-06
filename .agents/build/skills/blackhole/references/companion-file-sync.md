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
`docs_governance.companion_files === false` — same gate shape as `reviewer.md` § Companion-File Audit.

## Procedure (implementer)

1. After incremental implementation, **before** `git add`: collect the list of paths about to be
   staged.
2. Run:
   ```bash
   bun run --cwd <worktree-abs> scripts/lib/companion-file-sync.ts --repo-root <worktree-abs> --diff-file <paths.txt>
   ```
   `--cwd` MUST equal `--repo-root` (issue #798 — pins module resolution to the worktree, the
   same tree the CLI operates on).
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

### `V-ADA-09` — `documentation/reference/journeys.md` missing `summary:` frontmatter

| Predicate | Rule |
|-----------|------|
| File state | `documentation/reference/journeys.md` exists and its frontmatter has no `summary:` field |
| Diff scope | none — unconditional, purely additive, see Codebase Conventions |

Unlike `V-ADA-01`/`V-ADA-05`, this repair carries no diff-path predicate: it only ever fires
when `journeys.md` already exists on disk, so it cannot cause a drive-by file creation (issue
#728).

Helper: `needsJourneysSummaryRepair(repoRoot)` for file state; `repairJourneysSummary(repoRoot)`
backfills the field directly on `journeys.md`'s own frontmatter. Issue #832 (ADR-031 Phase 2)
retired the earlier hand-appended-row mechanism this section used to describe — the root
`documentation/INDEX.md` row for `journeys.md` is now reproduced automatically at carry time
from this `summary` field, so the repair no longer touches `documentation/INDEX.md` at all.

**Repair**: `repairJourneysSummary` — inserts a `summary: "..."` line into `journeys.md`'s
frontmatter immediately after its `type:` line. No-op (returns `null`) when `journeys.md` is
absent or already carries a `summary:` field.

**CLI flag naming note**: the bootstrap-time invocation (`src/SKILL.md` Phase 0 step 2) still
spells this flag `--upsert-journeys-index` — the name predates issue #832 and was not renamed
alongside the behavior change. It calls the same `repairJourneysSummary` function described
above, not an index-row upsert. Renaming the flag is a CLI surface change reaching
`scripts/lib/companion-file-sync.ts`, `src/SKILL.md` and its generated mirrors,
`templates/companion-files/README.md` and its mirrors, and
`scripts/verify.cwd-pin-guard.test.ts` — out of scope for this docs-only fix (issue #947);
left as a documented mismatch rather than silently implied to match current behavior.

## Out of scope (this reference)

- `DESIGN.md` / `V-ADA-03`
- Package-level `V-ADA-06/07`
- `V-ADA-02` INDEX append (Carry Staged Artifacts)
- Monorepo per-package `ARCHITECTURE.md` / `AGENTS.md` auto-walk
- `journeys.md`'s own *creation* stays bootstrap-only (`src/SKILL.md` Phase 0 step 2), never
  implement-time — only the summary-frontmatter repair above runs at implement-time (also
  reachable at bootstrap via the `--upsert-journeys-index` CLI flag, see naming note above)

## Ledger contract

On `status: complete`, the orchestrator matches each `companion_repairs[]` row's `(vcode, file)`
against open/deferred ledger rows using the **V-ADA-01/V-ADA-05/V-ADA-09 dedup** rule (ignore
`issue_ref`), sets `status: fixed-in-pr`, `pr_ref`, and appends `companion-repair: <action>` to
`summary`. See `findings-ledger.md` § Status transitions.
<!-- GENERATED by scripts/build.ts from src/references/companion-file-sync.md — do not hand-edit -->

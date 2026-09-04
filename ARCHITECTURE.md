# Architecture: blackhole

<!--
  Living codebase comprehension document. Update as the system evolves.
  Architectural decisions live in documentation/decisions/ — see INDEX.md for the full log.
  Agents update structural sections (Project Structure, Tech Stack, etc.) when the underlying
  state changes. No agent tracking overhead — this is a human-readable reference.
-->

## Overview

Blackhole is an agent-agnostic backlog campaign orchestrator: a single `src/` source tree of
markdown agents/skills/rules is compiled (`bun run build`) into native plugin targets for
Claude Code, Cursor, Codex CLI, and Antigravity/Gemini, so any of those hosts can run the same
five-phase (Handle → Plan → Implement → Review → Loop) loop that drains a forge's issue backlog
using isolated git worktrees and a project-local JSON state ledger.

---

## 1. Project Structure

```
backlog-campaign/
├── src/                  # EDIT SURFACE — only hand-edited source (agents, skills, rules, references)
│   ├── agents/           # coordinator, orchestrator, router, planner, implementer, reviewer, investigator, hunter (markdown)
│   ├── references/       # protocol docs: blackhole-protocol, blackhole-state, phase-*, forge-sync, ...
│   └── SKILL.md          # blackhole skill entry (source)
├── scripts/              # Bun/TypeScript build, verify, doctor, release, campaign-status tooling
├── .blackhole/           # GITIGNORED runtime state (protocol SSOT) — queue.json, findings-ledger.json,
│                         #   config.json, plans/, archive/ — never hand-edited by agents outside protocol
├── .agents/              # GITIGNORED ephemeral per-run handoff dirs (orchestrator/, worker_*/, explorer_*/)
│                         #   plus .agents/build/ (Antigravity/Gemini compiled output, built by default)
├── skills/, agents/, references/, rules/   # BUILD OUTPUT — flat skills.sh registry mirror of src/
├── .cursor/               # BUILD OUTPUT — Cursor IDE agent/rules/skills mirror
├── .claude/ + .claude-plugin/   # BUILD OUTPUT — Claude Code plugin + marketplace manifest
├── codex-agents/ + codex-skills/ + .codex-plugin/ + codex-marketplace.json  # BUILD OUTPUT — Codex CLI
├── .gemini-plugin/ + plugins/blackhole/   # BUILD OUTPUT — Antigravity/Gemini targets (built by default; --gemini/--all/--no-codex are deprecated no-op aliases)
├── documentation/        # ADRs, audits, reviews, architecture reference (this project's own docs)
├── fixtures/              # Example/test fixtures for config, queue, ledger, plugin manifests
├── templates/             # Hook templates used by the build
├── AGENTS.md              # Quick-start agent roster + trigger index
├── README.md              # Project pitch, HITL model, Pareto gating explanation
└── CLAUDE.md               # Entry point for Claude Code sessions in this repo
```

**Golden rule**: `src/` is the only editable source tree. Every platform directory above it
(`.cursor/`, `.claude/`, `codex-*`, `.gemini-plugin/`, `plugins/`, flat `skills/`/`agents/`/
`references/`/`rules/`) is a compiled artifact of `scripts/build.ts` — hand-edits there are
silently overwritten on the next build and are rejected by CI ("Verify build is in sync").
Full build-pipeline diagram: `documentation/architecture.md`.

---

## 2. System Diagram

```mermaid
flowchart LR
    subgraph SRC["src/ — edit surface"]
        A1[agents/*.md]
        A2[references/*.md]
        A3[SKILL.md]
    end

    BUILD["scripts/build.ts (bun run build)"]

    subgraph TARGETS["Compiled agent-host targets"]
        T1[Claude Code<br/>.claude/ + .claude-plugin/]
        T2[Cursor<br/>.cursor/]
        T3[Codex CLI<br/>codex-agents/ codex-skills/]
        T4[Antigravity/Gemini<br/>.agents/build/ .gemini-plugin/ plugins/blackhole/]
        T5[skills.sh registry<br/>flat skills/ agents/ references/ rules/]
    end

    SRC --> BUILD --> T1 & T2 & T3 & T4 & T5

    subgraph RUNTIME["Campaign runtime (gitignored, protocol SSOT)"]
        R1[.blackhole/queue.json]
        R2[.blackhole/findings-ledger.json]
        R3[.blackhole/config.json]
        R4[.blackhole/plans/*.md]
    end

    HOST["Any agent host (Claude Code / Cursor / Codex / Gemini)"] -->|runs 5-phase loop| RUNTIME
    T1 & T2 & T3 & T4 & T5 -.->|loaded by| HOST

    RUNTIME -->|worktrees + PRs| FORGE[(Forge: GitHub/Gitea issues & PRs)]
```

---

## 3. Core Components

### 3.1. Source compiler (`scripts/build.ts`)

**Purpose**: Compiles the single `src/` markdown source tree into every agent-host's native
plugin format (Claude Code, Cursor, Codex CLI, Antigravity/Gemini, skills.sh flat registry),
keeping one authored copy of each skill/agent/rule instead of five hand-maintained forks.

**Technologies**: TypeScript, Bun runtime, `bun test` for build/verify test coverage.

**Deployment**: Local dev tool + CI step (`.github/workflows/verify.yml`) — not a running service.

### 3.2. Campaign agent roster (`src/agents/*.md`)

**Purpose**: Eight markdown-defined agents implementing the backlog loop — `coordinator` (user
intake/blocker routing), `orchestrator` (five-phase loop + worker scheduling + forge sync),
`router` (issue classification into the `route{}` object, ADR-004), `planner` (touch-paths +
plan artifacts), `implementer` (TDD in isolated worktrees), `reviewer` (PR quality +
plan-conformance audit), `investigator` (evidence-gathering for router re-route checkpoints),
`hunter` (read-only kaizen improvement scanner, ADR-006).

**Technologies**: Markdown agent-definition format, consumed natively by each compiled target
(Claude Code subagents, Cursor custom agents, Codex agent YAML, Gemini/Antigravity agents).

**Deployment**: Runs inside whichever agent host the user invokes (Claude Code, Cursor,
Codex CLI, Antigravity) — no separate hosting; the agent host is the runtime.

### 3.3. Protocol references (`src/references/*.md`)

**Purpose**: The behavioral rulebook the agents follow — `blackhole-protocol.md` (five-phase
lifecycle, clarify gates, branch/worktree hygiene, merge linkage), `blackhole-state.md` (queue/
ledger write protocol, SSOT boundaries), `blackhole-vcodes.md` (violation severity table),
plus per-phase playbooks (`phase-handle.md`, `phase-plan.md`, `phase-implement.md`,
`phase-review.md`, `phase-loop.md`) and cross-cutting docs (`forge-sync.md`, `issue-splitting.md`,
`recovery-protocol.md`, `checkpoint-protocol.md`, `worker-schemas.md`).

**Technologies**: Markdown, compiled verbatim into every platform target's `references/` dir.

**Deployment**: Read by agents at runtime from whichever compiled target the host loads.

### 3.4. Campaign runtime state (`.blackhole/`)

**Purpose**: The single source of truth for in-flight campaign state — `queue.json` (issue
phase/status/DAG), `findings-ledger.json` (V-code findings, dedup + deferral tracking),
`config.json` (campaign configuration), `plans/<issue>.md` (plan artifacts per issue),
`archive/` (rotated ledger snapshots).

**Technologies**: JSON (schema-validated via `scripts/validate-worker-json.ts`), plain markdown
for plans.

**Deployment**: Local, gitignored, per-repo-clone — not shared infrastructure.

### 3.5. Support scripts (`scripts/*.ts`)

**Purpose**: `build.ts` (compiler), `verify.ts` (plugin coherence checks across compiled
targets), `doctor.ts` (environment readiness), `campaign-status.ts` (queue dashboard),
`review-aggregate.ts` (merges reviewer findings into the ledger), `release.ts` (semver release
automation), `install-verify.ts` / `forge-deps.ts` / `forge-scope.ts` (installation and forge
scope validation).

**Technologies**: Bun + TypeScript, each with a co-located `*.test.ts`.

**Deployment**: Invoked via `bun run <script>` locally and in CI.

---

## 4. Data Stores

### 4.1. `.blackhole/queue.json`

**Type**: Flat JSON file (no database).

**Purpose**: Tracks every backlog issue's campaign phase, status (`ready`/`blocked`/`in-flight`/
`done`), and DAG dependencies. Read/written by the orchestrator every turn.

**Key schemas/collections**: See `src/references/queue-dag.md` / `.cursor/skills/blackhole/references/queue-dag.md` for the schema; example at `fixtures/queue.example.json`.

### 4.2. `.blackhole/findings-ledger.json`

**Type**: Flat JSON file (append-only, deduplicated).

**Purpose**: Records every V-code finding raised during implementation/review, with Pareto
scoring (`Priority = Gain * (11 - Effort)`) driving whether a finding is auto-filed as a new
forge issue or archived as noise.

**Key schemas/collections**: See `src/references/findings-ledger.md`; example at
`fixtures/findings-ledger.example.json`.

### 4.3. `.blackhole/config.json` / `.blackhole/plans/*.md`

**Type**: JSON (config) + markdown (plans).

**Purpose**: Per-repo campaign configuration and per-issue implementation plans produced by the
planner agent (touch-paths, acceptance criteria).

---

## 5. External Integrations

| Service | Purpose | Integration method |
|---------|---------|--------------------|
| GitHub / Gitea (forge) | Issue backlog source, PR creation/merge, native sync of new issues into the queue | `gh` CLI (and forge-equivalent) invoked by orchestrator/worker agents |
| Claude Code, Cursor, Codex CLI, Antigravity/Gemini | Agent hosts that load the compiled plugin targets and execute the campaign loop | Each host's native plugin/skill/agent loading mechanism (no shared API) |

---

## 6. Deployment & Infrastructure

**Cloud provider**: None — this is a local developer tool / CLI-driven repo automation, not a
hosted service.

**Key services**: N/A (no cloud infra; the "runtime" is whichever agent host + forge CLI the
developer already has installed).

**CI/CD**: GitHub Actions (`.github/workflows/verify.yml`) — runs `bun run build` and
`bun run verify`, fails the PR if the build drifts from committed compiled targets or if plugin
coherence checks fail.

**Environments**: Single environment — the developer's local clone. No staging/prod split;
`scripts/release.ts` handles semver tagging/publishing of the marketplace plugin.

**Monitoring & logging**: None (no running service) — visibility is via `bun run status`
(`scripts/campaign-status.ts`) showing the queue dashboard, and the findings ledger.

---

## 7. Security

**Authentication**: Delegates entirely to the host agent's and the `gh`/forge CLI's existing
authentication — blackhole itself holds no credentials or auth logic.

**Authorization**: Forge-level permissions (repo write access) gate what the worker/orchestrator
agents can do (branch push, PR create/merge); no additional authorization layer in this repo.

**Data encryption**: N/A — no data store beyond local gitignored JSON/markdown files.

**Key practices**: Branch/worktree hygiene enforced by protocol (V-BRANCH-01/02/03,
V-WORKTREE-01) — no direct commits to `main`, all work isolated in `blackhole/issue-N` branches
inside dedicated worktrees, pruned after merge.

---

## 8. Development & Testing

**Local setup**: `bun install`, then see `AGENTS.md` and `README.md#-installation-paths` for
per-host setup (Cursor submodule, Claude Code plugin marketplace, Codex CLI, skills.sh).

**Run commands**:
```bash
bun install                # install
bun run build               # compile src/ -> all platform targets, incl. Antigravity/Gemini (tracked ⇒ built-by-default)
bun run verify               # validate plugin coherence across compiled targets
bun test                     # run all *.test.ts (build, verify, forge-*, review-aggregate, ...)
```

`--gemini`, `--all`, and `--no-codex` are deprecated no-op aliases kept only for muscle-memory compatibility (`scripts/build.ts`'s `DEPRECATED_BUILD_FLAGS`, ADR-007 R5′).

**Testing frameworks**: `bun test` (Bun's built-in test runner) — every `scripts/*.ts` has a
co-located `*.test.ts`.

**Code quality tools**: `scripts/verify.ts` (plugin coherence / structural checks), CI-enforced
"build is in sync" gate (no separate linter/formatter configured in `package.json`).

---

## 9. Future Considerations

- **Committed build-output measurement** (issue #328, open): **61.0% of tracked files**
  (410 of 672) are compiled build output, accounting for **88.4% of tracked bytes**
  (7.60× src→build duplication) and 6.39× change amplification. The open question is
  which documented install path actually resolves each committed tree (`.claude/` +
  `.claude-plugin/`, `plugins/blackhole`,
  `plugins/blackhole-claude`, `.cursor/`, `codex-agents/` + `codex-skills/` +
  `.codex-plugin/`, `.gemini-plugin/`, `.agents/build/`, and the flat root
  `skills/`/`agents/`/`references/`/`rules/` registry); trees with no resolving install
  path are candidates for release-time generation instead of tracking. No tree is removed
  until that mapping lands — issue #328 is a measurement task only.
- **ADR status vocabulary** (issue #324, open): ADR frontmatter uses four spellings
  (`Accepted`, `accepted`, `current`, `superseded`) against the three values declared in
  `doc-governance.md` (`current | deprecated | archived`), and no check enforces either
  set. The open question is whether ADRs adopt the generic doc-governance enum or an
  ADR-specific one.

---

## 10. Agent Notes

- **Entry points**: `CLAUDE.md` / `AGENTS.md` at repo root route a session into the blackhole
  skill (`SKILL.md`, `.claude/skills/blackhole/SKILL.md`); the five-phase loop is defined in
  `src/references/blackhole-protocol.md` (compiled to every platform's `references/` dir).
- **Key patterns**: `src/` is the only hand-edited source — every other agent/skill/rule/plugin
  tree is regenerated by `scripts/build.ts`. Campaign runtime state lives exclusively under
  `.blackhole/` (see `src/references/blackhole-state.md`); ephemeral per-run agent handoff dirs
  under `.agents/orchestrator|worker_*|explorer_*` are NOT a substitute for `.blackhole/` state.
- **When working on X**: Any change to an agent/skill/rule/reference must be made in `src/` and
  then compiled via `bun run build` (compiles every platform target, including Antigravity/Gemini, by default) — never
  hand-edit a compiled target directly, CI will reject the drift.
- **Avoid**: Do not hand-edit `.cursor/`, `.claude/`, `codex-*`, `.gemini-plugin/`,
  `plugins/blackhole/`, or the flat root `skills/`/`agents/`/`references/`/`rules/` — all are
  build output. Do not treat `.agents/*` handoff dirs as campaign state — only `.blackhole/*` is
  protocol SSOT.

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| Blackhole | This project's name for the agent-agnostic backlog campaign orchestrator. |
| Campaign | A full run of the five-phase loop against a repo's forge backlog until it is empty. |
| Touch-Paths | The set of files a plan authorizes a worker to modify; deviating is a V-SCOPE-02 violation. |
| Ledger | `.blackhole/findings-ledger.json` — the append-only record of V-code findings. |
| Pareto gating | Scoring findings by `Priority = Gain * (11 - Effort)` to decide auto-file vs archive. |
| SSOT | Single Source of Truth — for campaign state, exclusively `.blackhole/*`. |
| Compiled target | A platform-specific directory (`.claude/`, `.cursor/`, `codex-*`, etc.) generated from `src/` by `scripts/build.ts`. |

---

## Active Constraints
- `documentation/INDEX.md` is a generated build artifact — never hand-append a row to it; add a `summary:` frontmatter field to the doc instead and let the generator produce the row (ADR-031)
- Assigned-worktree write containment (`BLACKHOLE_ASSIGNED_WORKTREE`) must cover every tool surface a worker can write through — `Write`/`Edit` and `Bash` alike — never only the dedicated file-editing tools (ADR-029)
- Any PR touching `templates/hooks/**` must also bump `package.json`'s version in the same diff — the installed Claude Code plugin cache is version-keyed, not content-addressed, so an unbumped hook change ships inert to every existing installation (ADR-030)

- `src/` is the only editable source — every platform tree is a build output regenerated by
  `scripts/build.ts`; CI blocks PRs where a compiled target has drifted from `src/`.
- Campaign protocol state lives only under `.blackhole/*` — ephemeral `.agents/orchestrator|
  worker_*|explorer_*` handoff dirs and `.agents/build/` (Gemini build output) are never treated
  as protocol state.
- No direct commits/force-pushes to `main`/`master`/`release/*` (V-BRANCH-01/02) — all worker
  changes go through isolated worktrees on `blackhole/issue-N` branches and a reviewed PR.
- Every PR must link its issue (`Closes #N`) before merge (V-GIT-01).
- Blackhole is agent-agnostic by design — protocol and state must remain readable/writable by
  any agent host, not coupled to Claude Code, Cursor, Codex, or Gemini specifically.
- UI-affecting issues above trivial size require an owner-approved mockup + interpretation block
  before implement dispatch (ADR-017)
- UI-affecting PRs must carry rendered visual evidence at every declared display target, or an
  explicit declaration that it was unavailable. (ADR-018)
- A companion file introduced for a single hunt kind must be gated on that kind's activation,
  never added to the universal Phase-0 scaffold. (ADR-019)
- No issue may advance past a phase transition while its `queue.json` `rulings_checked_at`
  watermark trails the owner-rulings ledger's `rulings_revision` — it is re-judged by the planner
  or quarantined at the background-worker barrier first. (ADR-020)
- Backlog hygiene (duplicate open issues, stale referents, low-information enrichment) must run through the `backlog` kaizen hunt kind and its orchestrator enrichment pass — not ad-hoc scripts or retrospective heuristics. (ADR-022 backlog hunt)
- Each V-code carries exactly one severity and one semantic rule; overloaded codes must split by
  minting a fresh identifier rather than renumbering established SSOT headings (ADR-024 v-pareto split)
- Before squash-merge, detect CONFLICTING PRs and classify each conflict hunk mechanical vs
  semantic against the explicit rule in merge-conflict-protocol.md — never restate procedures
  inline in consumers; semantic hunks block with conflict_hunks[] surfaced to the owner
  (ADR-023)
- Campaign implementers must never delegate a PR fix back to an external review bot (e.g.
  posting `/git-fix-pr` when ActionMan/workclaude is installed on the consumer forge) — findings
  are applied in-process and the bot's verdict is re-checked on the new HEAD SHA. (ADR-026)

---

## Package Map (Monorepo)

| Package | Path | Responsibility |
|---------|------|-----------------|
| — | — | Single-package repo — not a monorepo. `src/` compiles to multiple *platform targets* (see §1), not multiple independently-versioned packages. |


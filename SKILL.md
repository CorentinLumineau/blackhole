# Blackhole

Orchestrates issue implementation until the forge backlog is empty. Binding
runbook: `references/blackhole-protocol.md`.

## Entry (Multitask Mode)

If the agent lacks a native long-running goal loop, use Multitask Mode (Pattern B) with a coordinator + background orchestrator:

1. User talks to **`coordinator`** agent (or attaches this skill in Multitask Mode)
2. Coordinator runs Phase 0 → spawns **`orchestrator`** in background
3. User feedback → coordinator **resumes** orchestrator (`interrupt: false`)

Full flow: [multitask-mode.md](references/multitask-mode.md)
Orchestrator spawn text: [campaign-prompt.md](references/campaign-prompt.md)

If the harness has a deterministic fan-out primitive **and** background→foreground completion
notifications (capabilities C1/C2 in [claude-code-native.md](references/claude-code-native.md)),
prefer **Pattern C**: main chat acts as orchestrator directly, no coordinator, gate-first batched
clarify in the foreground. Full flow: [claude-code-native.md](references/claude-code-native.md).

Direct `/blackhole run` or `/goal` in a single session: act as orchestrator (legacy Pattern A) — still follow all phases below.

## Modes

| Mode | Trigger | Who runs it |
|------|---------|-------------|
| `run` | `run`, `campaign`, "finish the backlog" | Coordinator spawns orchestrator |
| `status` | default, `status`, `sync` | Coordinator or orchestrator — auto-sync + dashboard |
| `handle #N` | `handle #N` | Orchestrator — phase 1 only |
| `plan #N` | `plan #N` | Orchestrator — phase 2 only |
| `implement #N` | `implement #N` | Orchestrator — phase 3 only |
| `review #N` | `review #N` | Orchestrator — phase 4 only |
| `hunt [kind]` | `hunt`, `hunt <kind>` | Orchestrator — manual kaizen wave (`kaizen.trigger: manual`, or any time regardless of trigger) |
| `stop` (drain, default) | `stop`, `pause`, `drain the campaign` | Orchestrator (foreground, Pattern C/A) or Coordinator relay → orchestrator (Pattern B) — see `phase-stop.md` |
| `stop --abandon` | `stop --abandon`, `abandon`, `kill`, `abort`, `force stop` | Orchestrator/Coordinator, explicit opt-in only — see `phase-stop.md` |
| `campaign-audit` | `audit`, `campaign audit` | Read-only protocol conformance check |

## Phase 0: Bootstrap (ALL modes)

**Native forge sync** — automatic, never AskQuestion to confirm.

1. **Config** — `.blackhole/config.json` (from `config-template.md` in this repo). In `run` mode
   this step also runs the **Campaign launch configuration gate** (`coordinator.md` § Bootstrap
   preflight, the SSOT): either the full 6-step form (first bootstrap, post-campaign restart, or
   explicit reconfigure) or otherwise the lightweight
   routine resume confirmation gate — print the current config, then Proceed / Reconfigure.
   The gate applies in `run` mode only; every other mode in the table above loads config with no
   confirm step.
2. **Companion-file scaffold** — gated by `docs_governance.companion_files` (default `true`,
   config already loaded from step 1); skip entirely when `docs_governance.enabled` does not
   resolve to `true` (absent `docs_governance` block, absent `enabled` field, or explicit
   `false` — SSOT: `config-template.md`'s `docs_governance.enabled` row, issue #477) or
   `docs_governance.companion_files` is explicitly `false`. For
   `ARCHITECTURE.md`/`AGENTS.md`/`documentation/reference/product-principles.md`
   (the owner-rulings ledger — `V-RULE-01`), create the file from
   `templates/companion-files/{name}.template` **only if it does not already exist**,
   substituting `{project-name}` from `.blackhole/config.json`'s `repo` field
   (`owner/repo-name` → `repo-name`) or `basename "$(pwd)"` when `repo` is absent or has no
   `/`. Additionally create `DESIGN.md` under the same skip-if-exists rule **only when**
   `bash scripts/detect-frontend.sh` emits `frontend=yes`. Additionally create
   `documentation/reference/journeys.md` under the same skip-if-exists rule **only when** the
   companion-file scaffold above is not skipped **and** `kaizen.enabled` is `true` **and**
   `kaizen.kinds` contains `ux-coherence`. When created (not skipped), run
   `bun run scripts/lib/companion-file-sync.ts --repo-root <path> --upsert-journeys-index` to
   upsert its `documentation/INDEX.md` row (idempotent; no-op when `documentation/INDEX.md`
   does not yet exist in the target repo).
   Full contract: [templates/companion-files/README.md](../templates/companion-files/README.md).
   Initial creation runs here at bootstrap; implement-time repair of absent/broken root
   companions is `implementer.md` § Companion-file Sync (`companion-file-sync.md`) — no
   duplicate scaffold logic in this step.
3. **State init** — `queue.json`, `findings-ledger.json`, `plans/`
4. **Validate** — `bun run scripts/lib/state-write-guard.ts` on both JSON files (never `jq empty`
   alone — `blackhole-state.md` § Write protocol)
5. **Forge sync** — if `auto_sync` true (default): `gh auth status` then [forge-sync.md](references/forge-sync.md). Sandbox: `full_network`.
6. **Dashboard** — open issues/PRs, new since sync, in-flight, LEDGER OPEN, ready set

---

## Five-phase lifecycle

| Phase | Reference |
|-------|-----------|
| 1 Handle | [phase-handle.md](references/phase-handle.md) |
| 2 Plan | [phase-plan.md](references/phase-plan.md) |
| 3 Implement | [phase-implement.md](references/phase-implement.md) |
| 4 Review | [phase-review.md](references/phase-review.md) |
| 5 Loop | [phase-loop.md](references/phase-loop.md) |

Review infrastructure: [review-core.md](references/review-core.md)

Cross-cutting:

- [clarify-gates.md](references/clarify-gates.md) — AskQuestion for **all sizes**
- [issue-splitting.md](references/issue-splitting.md) — split any non-reviewable PR

**Binding:** Never drop a V-code finding → `findings-ledger.json`. Deferrals
require `gh issue create` + `deferred_to_issue`.

---

## Orchestration (run mode — orchestrator)

0. Auto-sync every turn
1. Ready set → [queue-dag.md](references/queue-dag.md) — skip `blocked` (user gates)
2. Per issue: handle → plan → **user gate if needed** → implement → review → loop
3. Spawn workers via the designated agent files (`planner`, `implementer`, `reviewer`), `run_in_background: true`, one turn per batch
4. End turn; triage completions → ledger → next phase

**Do not spawn implement** while `status: blocked` with
`awaiting-user-clarification`, `awaiting-plan-approval`, `awaiting-design-approval`, or
`awaiting-ruling-recheck`.

---

## State references

- [findings-ledger.md](references/findings-ledger.md)
- [queue-dag.md](references/queue-dag.md)
- [forge-sync.md](references/forge-sync.md)
- [config-template.md](references/config-template.md)
- [worker-schemas.md](references/worker-schemas.md)
- [checkpoint-protocol.md](references/checkpoint-protocol.md)
- [ground-truth.md](references/ground-truth.md)

## Campaign audit mode

Read-only conformance check (`campaign-audit`):

1. Run `bun run verify` (or read last CI result)
2. Validate fixture schemas (`fixtures/queue.example.json`, `fixtures/findings-ledger.example.json`)
3. Check phase playbooks reference consistent agent names and phase strings per `ground-truth.md`
4. Output `audit-report.md` with F-codes:

| F-code | Check |
|--------|-------|
| F-AGENT-01 | All agents in ground-truth exist in `src/agents/` |
| F-AGENT-03 | Validate agent frontmatter `name:` matches its filename |
| F-PHASE-01 | Five phase playbooks present and named correctly |
| F-VERIFY-01 | `bun run verify` passes |
| F-SCHEMA-01 | Fixture JSON validates |
| F-DRIFT-01 | declaration vs independent-scan conformance — see `build.ts` § facts |
| F-DOCS-01 | Companion files present (`ARCHITECTURE.md`, `AGENTS.md`) / `documentation/decisions/INDEX.md` current on consumer repo — a row in either schema `scripts/detect-doc-schema.sh` detects (mercure or blackhole) counts as current (read-only, report only) |
| F-HUNT-01 | Kaizen hunt conformance (read-only, report only): (a) `hunt_state` watermark internally consistent — each kind key exists in `kaizen.kinds`, `waves <= kaizen.max_waves`, `exhausted` forced `true` once `waves` or `dry_waves` hits its stop threshold; (b) sample hunt-origin filed issues (ledger `phase: hunt` rows with `deferred_to_issue` set) — re-read the cited `file:line` against the issue's Verbatim-code excerpt, flag drift as STALE-since-filing (does not roll back); (c) cumulative filed-issue count per kind does not exceed `waves(kind) * kaizen.max_issues_per_wave` (upper-bound cap sanity check) |
| F-PARITY-01 | Forge/queue parity (read-only, report only; descoped from #570 because `bun run verify` is offline-only): fetch open, campaign-scoped forge issues via the same `bun scripts/forge-scope.ts list-args`-scoped `gh issue list --state open --json number,labels --limit 200` call `forge-sync.md` §2/§4/§9 already use (`V-INT-02` — no second scope-filter implementation), then diff both directions against `queue.json`: (a) an in-scope open forge issue with no matching `queue.json` entry is a finding; (b) a `queue.json` entry whose `status` is not `merged`/`closed` (the terminal set `queue-dag.md` already defines) and whose forge issue is closed or absent from the fetch is a finding. On `gh auth status` failure or a failed list call, report "parity unchecked — forge unavailable" — never a silent clean pass. |
| F-STALECITE-01 | Stale-issue-citation scan (read-only, report only, advisory): grep `src/**/*.md` for lines carrying both an `#NNN` reference and an open-framing marker on the same line — `future`, `not implemented`, `tracked issue`, `residual gap`, `deferred to` (case-insensitive) — then resolve each candidate `#NNN`'s forge state (`gh issue view N --json state`; reuse `F-PARITY-01`'s fetch when both codes run in the same audit pass rather than a second `gh` call) and report every candidate whose issue is CLOSED. A bare `#NNN` with no marker on the same line never fires — e.g. a `(ADR-NNN, #NNN)`-style attribution, or `doc-governance.md`'s own still-open `#464` citation ("tracked separately (issue #464)" — contains the `tracked` marker but #464 is open, so it correctly does not fire). Worked positive fixtures (pre-#583-fix text, `git show a90ac60^`): `blackhole-state.md`'s "not implemented by this section... (D4, tracked issue #468)" and "issue #474 follow-up" residual-gap bullet, and `implementer.md`'s "a future reviewer audit (#468)" — all three closed by #468/#557 and correctly fire against the pre-fix text. On `gh auth status` failure or a failed `gh issue view` call for any candidate, report "stale-citation scan unchecked — forge unavailable" — never a silent clean pass. |
| F-STOP-01 | `queue.json` contains no `in-flight` entry naming a worker outside the currently-running set (`scripts/checks/stop-mode.check.ts`'s `assertNoOrphanedInFlight` — a pure invariant unit-tested in `scripts/verify.stop-mode.test.ts`; the guarantee is satisfied by construction via the drain/abandon procedures in `phase-stop.md`, not scanned by `bun run verify`) |
| F-STAGE-01 | ADR-021 D1 staging contract self-consistency and producer conformance — `.blackhole/staged/<issue>/manifest.json`'s field names and enum values never silently drift between `blackhole-state.md` § Staging's own JSON example/field table and the `planner`/`investigator` producer prompts (`scripts/checks/staging-schema.check.ts`, `V-STAGE-01`/`V-STAGE-02`, scanned by `bun run verify`) |

Do not modify code during audit — report only.

## Rules references

- [blackhole-protocol.md](references/blackhole-protocol.md)
- [blackhole-state.md](references/blackhole-state.md)
- [blackhole-vcodes.md](references/blackhole-vcodes.md)

## User interaction

- [clarify-gates.md](references/clarify-gates.md) — default clarify; narrow auto-proceed only
- Chat feedback → clarify if ambiguous → file issue → auto-sync ingests
- Split per [issue-splitting.md](references/issue-splitting.md) — not epics only
<!-- GENERATED by scripts/build.ts from src/SKILL.md — do not hand-edit -->

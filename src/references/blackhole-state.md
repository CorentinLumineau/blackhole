---
description: Queue and findings-ledger write protocol for Blackhole state
globs:
  - .blackhole/**
alwaysApply: false
---

# Blackhole State

## Protocol SSOT

Campaign protocol state lives **only** under `.blackhole/*`:

- `config.json` — campaign configuration
- `queue.json` — issue phase, status, DAG
- `findings-ledger.json` — V-code findings
- `plans/<issue>.md` — plan artifacts
- `staged/<issue>/` — durable artifact staging area (see § Staging (ADR-021 D1) below)
- `archive/` — rotated ledger snapshots, pre-mutation `queue.json` snapshots, and (ADR-042,
  issue #893) `hook-events-<turn-timestamp>/` — consumed PreToolUse hook-event files, moved
  here rather than deleted once ingested

The following are **not** blackhole protocol state:

- `.agents/orchestrator/`, `.agents/worker_*/`, `.agents/explorer_*/` — ephemeral session handoff dirs
- All build-output trees (`.cursor/`, `.claude/`, `skills/`, `codex-*`, `.agents/build/`, etc.)

Full harness-wide rule: `blackhole-protocol.md` § Campaign state vs. agent handoff dirs.

Mutations to `.blackhole/queue.json` and
`findings-ledger.json` MUST follow these rules.

## Paths

| File | Purpose |
|------|---------|
| `config.json` | Campaign config (see `config-template.md`) |
| `queue.json` | Issue phase, status, DAG (gitignored) |
| `findings-ledger.json` | V-code findings (gitignored) |
| `plans/<issue>.md` | Plan artifacts (gitignored) |
| `staged/<issue>/manifest.json` | Durable artifact staging manifest (gitignored, see § Staging (ADR-021 D1)) |
| `archive/` | Rotated ledger snapshots and pre-mutation `queue.json` snapshots (gitignored) |
| `archive/hook-events-<ts>/` | Consumed PreToolUse hook-event files, archived rather than deleted once ingested (gitignored, ADR-042/#893) |
| `doc-health.json` | Doc-tree health signal, Scope-1 only (gitignored, see § Doc-Health Signal) |

Full schemas: `{{AGENT_DIR}}/skills/blackhole/references/findings-ledger.md`,
`queue-dag.md`.

## Write protocol

**`jq empty <file>` is never sufficient as a write guard on its own — do not reintroduce it as a
simplification.** It exits 0 on a zero-byte file: it detects malformed JSON, not *absent* JSON.
Issue #489 traced a real incident to exactly this gap — a heredoc-authored `jq` program failed to
compile, the shell redirect had already truncated the `.tmp` file to 0 bytes before `jq` ran,
`jq empty` on that 0-byte file exited 0, and the empty file was atomically installed over live
`queue.json`, losing all 98 issue entries. `findings-ledger.json` was untouched only because that
mutation happened not to run in the same incident.

1. Snapshot the live file to `archive/<file>-<timestamp>.json` before mutating it (queue and
   ledger alike) — recovery must never depend on a scratchpad `.tmp` file surviving by luck.
2. Write the candidate output to `<file>.tmp`.
3. Validate the `.tmp` file before installing it:
   ```
   bun run scripts/lib/state-write-guard.ts --tmp <file>.tmp --live <file> --entity-key <key> [--allow-shrink]
   ```

   **Consumer-repo invocation** (issue #796): `scripts/lib/state-write-guard.ts` does not
   resolve from a consumer repo's root — it lives inside the vendored plugin, not the consumer's
   own `scripts/` tree. Resolve the plugin root the same way
   `scripts/consumer-promote-review.sh` already does for `promote-review-artifact.ts`
   (`implementer.md` § Promote Review Artifact): `BLACKHOLE_PLUGIN_ROOT` env var, else
   `vendor/blackhole`, else `node_modules/blackhole`. From a consumer repo:

   ```bash
   bun run --cwd "${BLACKHOLE_PLUGIN_ROOT:-vendor/blackhole}" scripts/lib/state-write-guard.ts \
     --tmp <consumer-repo-abs-path>.tmp --live <consumer-repo-abs-path> --entity-key <key>
   ```

   A bare `scripts/lib/state-write-guard.ts` path invoked from a consumer repo's root will not
   resolve (`Module not found` — same failure class as issue #798). See
   `queue-dag.md`'s `--entity-key` shape note above for the array-vs-object detail this
   resolution note does not restate (V-DRY-01).

   `<key>` is `issues` for queue.json, `findings` for the ledger. Exit code is the contract: `0`
   validation passed, safe to install; `1` refused (reason on stderr); `2` malformed usage. The
   guard fails closed (exit `1`) on any of:
   - the `.tmp` file is empty (0 bytes) — the case `jq empty` cannot catch
   - malformed JSON — the one case `jq empty` does catch
   - the required top-level entity key (`issues`/`findings`) is absent
   - the entity count is lower than the live file's, unless the caller passes `--allow-shrink`
     for a legitimate reduction (an issue removed, a ledger rotated to `archive/`) — even with
     `--allow-shrink`, a collapse to exactly zero is always refused; a declared shrink is not a
     declared wipe
4. Only on a passing validation, atomically install: `mv <file>.tmp <file>`.
5. Bump `refreshed_at` on every mutation.
6. Idempotency: dedup ledger by `(vcode, file, line, issue_ref)` before append.

## Single-writer invariant

The orchestrator is the sole writer of `queue.json` and `findings-ledger.json`. Workers
spawned as part of a parallel batch (e.g. a router wave, `orchestrator-runtime.md` § Background worker
barrier) never write either file directly — each worker computes and returns its result as
JSON, and the orchestrator applies mutations serially, one completed worker at a time, post-barrier
(`orchestrator-runtime.md` § Triage), even though the batch itself ran in parallel. This closes the
lost-update race that a direct-write-per-worker protocol would otherwise create (concurrent
read-before-either-writes on the same counter/array — issue #224). File locking (`flock`) and
optimistic retry/CAS were considered and explicitly deferred in favor of this invariant, because
the documented single-orchestrator-per-campaign topology (`multitask-mode.md` already forbids a
second live orchestrator) closes the race without new locking/CAS machinery.

## Staging (ADR-021 D1)

Thinking-time agents (`planner` Design Track, `investigator`'s `analyze`/`investigate`
sub-modes) cannot commit into `documentation/` — no PR branch exists yet at Phase 2
(`documentation/decisions/ADR-021-durable-artifact-staging.md` D1). They instead write into
`.blackhole/staged/<issue>/`, a durable staging area the orchestrator passes to the agent as an
**absolute repo-root path** at spawn time — the same convention `phase-implement.md` § "Plan
artifact paths (worktree rule)" already uses for the plan file
(`{repo_root}/.blackhole/plans/issue-N.md`), because these agents may run before any worktree
exists. `phase-plan.md`, `phase-handle.md`, and `orchestrator-dispatch.md` each point back to
this section for that absolute-path-passing convention rather than restating it.

Gated by `docs_governance.enabled` / `docs_governance.write_governance`, "absent or false ⇒
inert" — identical phrasing to `artifact-contract.md`'s existing kill switch: when either flag
resolves absent or `false`, no staging write happens and no manifest entry is appended.

**Scratch-file naming (issue #911)**: every heredoc-authored write under this staging
convention — including the plan file itself (`{repo_root}/.blackhole/plans/issue-N.md`) —
computes its full destination path first, writes the heredoc body to
`<that-full-destination-path>.tmp`, then atomically `mv`s it into place. This makes
cross-issue scratch-file collision impossible by construction, not by agent discipline: two
concurrently running agents each resolve a destination already namespaced by issue
(`.blackhole/staged/883/…` vs `.blackhole/staged/909/…`, or `plans/issue-883.md` vs
`plans/issue-909.md`) — their `.tmp` intermediates can never share a path, unlike a generic,
unnamespaced scratch name (a bare `/tmp/scratch.md` chosen by convention rather than derived
from the destination — the failure this replaces). The `.tmp` suffix is
**extension-suffixed** (`foo.md.tmp`), never **extension-replaced** (`foo.tmp.md`): a replaced
suffix still ends in `.md` and would be picked up by any wholesale `*.md` directory glob — the
same `<file>.tmp` convention § Write protocol above already uses for `queue.json`/
`findings-ledger.json`, reused rather than reinvented (`V-INT-03`). No partial-write hazard:
the one consumer that globs a staged tree wholesale,
`scripts/checks/adr-supersession.check.ts`'s `fs.readdirSync(plansDir).filter(n =>
n.endsWith('.md'))`, never matches a `<name>.md.tmp` file, and both
`carry-staged-artifacts.ts` and the reviewer's Staged Artifact Carry Audit resolve
`staged_path` from `manifest.json` entries directly, never by directory glob — a stray `.tmp`
left by a dead or interrupted agent is inert everywhere.

**Secondary control — content verification before `mv`**: this naming rule closes the
*collision* failure mode (two agents choosing the same destination); it does not close a
*content* failure mode where an agent resolves the wrong destination outright (e.g. a
copy-paste error naming issue #883's directory while holding #909's content — same symptom,
different cause). Before every such `mv` into `.blackhole/`, grep the `.tmp` file for its own
issue number and for the absence of any other issue's number — a stated obligation on the
writing agent (`planner`, `investigator`), not left to individual judgment.

### `.blackhole/staged/<issue>/manifest.json`

```json
{
  "issue": 465,
  "updated_at": "2026-08-06T18:00:00.000Z",
  "entries": [
    {
      "route": "design",
      "sub_mode": null,
      "produced_by": "planner",
      "declared_at": "2026-08-06T17:55:00.000Z",
      "staged_path": ".blackhole/staged/465/ADR-021-durable-artifact-staging.md",
      "target_path": "documentation/decisions/ADR-021-durable-artifact-staging.md",
      "target_kind": "new_file"
    },
    {
      "route": "design",
      "sub_mode": null,
      "produced_by": "planner",
      "declared_at": "2026-08-06T17:55:00.000Z",
      "staged_path": ".blackhole/staged/465/decisions-index-row.md",
      "target_path": "documentation/decisions/INDEX.md",
      "target_kind": "append_row"
    },
    {
      "route": "design",
      "sub_mode": null,
      "produced_by": "planner",
      "declared_at": "2026-08-06T17:55:00.000Z",
      "staged_path": ".blackhole/staged/465/architecture-active-constraint.md",
      "target_path": "ARCHITECTURE.md",
      "target_kind": "append_row"
    },
    {
      "route": "analyze",
      "sub_mode": "analyze",
      "produced_by": "investigator",
      "declared_at": "2026-08-06T17:40:00.000Z",
      "staged_path": ".blackhole/staged/465/analysis-issue-465.md",
      "target_path": "documentation/audits/analysis-issue-465.md",
      "target_kind": "new_file",
      "summary": "Evidence pass for issue #465's durable artifact staging design"
    },
    {
      "route": "plan",
      "sub_mode": null,
      "produced_by": "planner",
      "declared_at": "2026-08-06T17:58:00.000Z",
      "staged_path": ".blackhole/staged/465/plan-durable-artifact-staging.md",
      "target_path": "documentation/plans/plan-durable-artifact-staging.md",
      "target_kind": "new_file",
      "summary": "Implementation plan for durable artifact staging (ADR-021)"
    },
    {
      "route": "review",
      "sub_mode": null,
      "produced_by": "implementer",
      "declared_at": "2026-08-12T18:00:00.000Z",
      "staged_path": ".blackhole/staged/465/review-durable-artifact-staging.md",
      "target_path": "documentation/reviews/review-durable-artifact-staging.md",
      "target_kind": "new_file"
    }
  ]
}
```

The `design` triple above stages an ADR body, its `documentation/decisions/INDEX.md` row, and
(when the Cross-Cutting Heuristic promotes a finding, `planner.md` §4.8 Trigger A) an
`ARCHITECTURE.md` `## Active Constraints` bullet — issue #474. The `analyze`/`investigate` entry
stages an investigator-authored note carrying its own `summary` field directly on the `new_file`
entry (issue #832, ADR-031 Phase 2) — the root **documentation/INDEX.md** row is reproduced
automatically at carry time from that field rather than hand-appended from a paired staged
`append_row` fragment (the pre-#832 shape retired issue #490/ADR-021 D2 introduced). `planner.md`
Step 4 Trigger B stages the analogous `ARCHITECTURE.md` entry for the `analyze`/`investigate`
route (not shown above for brevity — same shape as the `design`-route `ARCHITECTURE.md` entry,
with `route: "analyze"`, `sub_mode: "analyze"`, `produced_by: "planner"`). The `plan` entry
(issue #445, ADR-021 D3) stages the durable plan body with its own `summary` field the same way;
the `review` entry is staged by `implementer` at merge-readiness from `findings-ledger.json`, not
by `reviewer` (ADR-021 A2). `plan` and `review` extend the `route` enum; `implementer` extends
`produced_by` — see the field table below.

| Field | Values | Notes |
|---|---|---|
| `issue` | number | Matches the `<issue>` directory name |
| `updated_at` | ISO8601 | Bumped on every append |
| `entries[].route` | `analyze` \| `investigate` \| `design` \| `brainstorm` \| `plan` \| `review` \| `runbook` \| `research` | Matches `artifact-contract.md`'s route→artifact table; `brainstorm` is reserved for schema completeness — it is **not** populated yet (brainstorm already has its own working `.blackhole/plans/issue-N-brainstorm.md` → docs-only-implementer mechanism, untouched here); `plan` and `review` are ADR-021 D3 durable promotion routes (issue #445); `runbook` is docs_impact/ops touch-path staging (issue #689); `research` is the ADR-033 durable-research-notes route (issue #807), targeting `documentation/investigations/research-{concern-slug}.md` |
| `entries[].sub_mode` | `research` \| `investigate` \| `analyze` \| `null` | Set by `investigator` entries: `research` now targets `documentation/investigations/research-{concern-slug}.md` (ADR-033, issue #807) — it is no longer forbidden; also set to `"analyze"` by `planner`'s Step 4 Trigger B entries (issue #474), since those derive from an investigator analyze note even though `planner` stages them; `null` for `planner`/design/plan/review entries otherwise |
| `entries[].produced_by` | `planner` \| `investigator` \| `implementer` | Which agent staged the artifact; `implementer` is review-artifact-only (generated at merge-readiness per ADR-021 A2, issue #445) |
| `entries[].declared_at` | ISO8601 | When the entry was staged |
| `entries[].staged_path` | string | Repo-relative path under `.blackhole/staged/<issue>/` |
| `entries[].target_path` | string | Repo-relative target path. Usually under `documentation/`, per `artifact-contract.md`'s route table. For `target_kind: append_row` this is `documentation/decisions/INDEX.md` (`design` route, `planner.md` §4.8) or `ARCHITECTURE.md` **at the repo root** — not under `documentation/` — for the Active Constraints append (`design`/`analyze` routes, `planner.md` §4.8 Trigger A / Step 4 Trigger B, issue #474). `documentation/INDEX.md` is no longer a valid `append_row` target for any route (issue #832, ADR-031 Phase 2) — the root index is regenerated automatically at carry time instead |
| `entries[].target_kind` | `new_file` \| `append_row` | Tells the carry-step whether to copy a whole file or append a row fragment to an existing file (`documentation/decisions/INDEX.md`) or bullet list (`ARCHITECTURE.md` `## Active Constraints`) |
| `entries[].summary` | string, optional | Set on a `new_file` entry in place of the retired paired root-INDEX `append_row` entry (issue #832, ADR-031 Phase 2) — `rewriteInvestigatorFrontmatter` writes it onto the promoted investigator note's own frontmatter; a `plan`-route entry's plan body already carries its own `summary` in lifecycle frontmatter, so this field mirrors that value rather than introducing a second source of truth. `documentation/INDEX.md`'s row for the promoted doc is then reproduced automatically from this frontmatter field at carry time (`doc-index-generate.ts`'s `buildDocIndexRows`) |

Enforced by `scripts/checks/staging-schema.check.ts`.

### Write protocol extension

Same atomic `.tmp` + `mv` read-modify-write as § Write protocol above, applied to
`manifest.json`. Each producer (`planner`, `investigator`) appends only its own entries and never
mutates another producer's row. This is **not** covered by § Single-writer invariant above — that
invariant is scoped to `queue.json`/`findings-ledger.json` only. Concurrency safety here instead
comes from `planner` and `investigator` never running for the same issue in the same phase
(design-track `planner` runs in Phase 2; `analyze`/`investigate` `investigator` runs in Phase 1 or
at escalation — never overlapping for one issue), so there is no lost-update race to close.

### Consumers of this section's manifest schema

- The **carry-step** that copies staged artifacts into their `documentation/` targets and commits
  them inside the PR is implemented at `implementer.md` § Carry Staged Artifacts (D2) — this
  section only documents the manifest shape that step consumes.
- The **reviewer audit** that diffs the staged manifest against the PR to detect a declared but
  never-carried artifact is implemented at `reviewer.md` § Staged Artifact Carry Audit
  (`V-AUTO-02`, BLOCK) — this section only documents the manifest shape that audit consumes.
- **Resolved gap (issue #474 follow-up, closed by #557)**: `implementer.md` § Carry Staged
  Artifacts' `append_row` idempotency guard originally keyed off "the row's `path` column
  value" — a table-row assumption that did not generalize to the `ARCHITECTURE.md`
  `## Active Constraints` bullet target added above, which has no table or `path` column.
  `implementer.md` now dedups that target by the `(ADR-{NNN})` / `(analyze: issue #N)` citation
  suffix `planner.md`'s own near-duplicate check (§4.8 Trigger A / Step 4 Trigger B) already
  uses — reused, not reinvented.
- **Mechanized (issue #715, R-10)**: the carry-step's shape guard, `target_kind` dispatch,
  9-row frontmatter rewrite, and both `append_row` dedup discriminators above are implemented at
  `scripts/carry-staged-artifacts.ts` / `scripts/lib/carry-staged-artifacts.ts` — `implementer.md`
  § Carry Staged Artifacts now states only the search-before-write judgment and the invocation
  line, not the mechanical logic itself.
- **Two-root resolution (issue #760)**: the carry-step resolves each entry's `staged_path`
  against `--staging-root` (default `--repo-root` when omitted) and `target_path` always against
  `--repo-root` — this manifest's own fields are unchanged (both remain repo-relative strings);
  only the CLI's read-time root differs from its write-time root, since `staged_path` lives in
  the main clone and `target_path` must land in the PR worktree.

## Ledger obligations

- Append before orchestrator ends turn
- `deferred` without `deferred_to_issue` is invalid
- Increment `next_id` when adding `F-NNNNN` ids

## Queue obligations

- `in-flight` set when worker spawned; clear on merge or blocker
- At most one `migration_slot: true` in `in-flight`
- Promote `blocked → ready` only when dependencies satisfied and user gates pass

## Sync

**Native auto-sync** — reconcile with forge automatically (see
`forge-sync.md`). Never ask the user to run sync. Runs at: Phase 0 bootstrap,
start of every orchestrator turn, Phase 5 loop, before parallel batch scheduling.
Fix drift before spawning workers.

## Doc-Health Signal

Same cadence as § Sync above — start of every orchestrator turn. Scope-1 only
(`doc-governance.md` § Doc-Tree Health Signal): blackhole's own `documentation/` tree, not a
consumer repo's.

Existence-gated: when `scripts/checks/doc-health.check.ts` exists at repo root (blackhole
self-hosting its own campaign), refresh `.blackhole/doc-health.json` via
`bun run scripts/doc-health-signal.ts`; absent, this step is inert — no error, no attempted
invocation. Scope-2 (a consumer repo's tree) is enforced at review time by `reviewer.md` § Doc-Governance Judgment Audit.

`doc_debt: "yes"` is visibility only: no ledger append, no phase gate. `V-DOCHEALTH-03` stays
advisory. Full rationale for this turn-start mechanism over a literal `SessionStart` hook:
`doc-governance.md` § Doc-Tree Health Signal, "Always-On Channel" (`V-DOC-05` — not restated
here).

## Plugin-Drift Signal

Same cadence as § Sync above — start of every orchestrator turn
(`orchestrator-runtime.md` § Session resume & recovery, step 4). Advisory-only, mechanism 2 of
the composite fix for issue #800 (ADR-030) — mechanism 1 is the diff-content reviewer BLOCK gate
`V-PLUGIN-01` (`src/agents/reviewer.md` § Plugin Cache Version-Bump Audit). This signal covers the residual gap mechanism 1
cannot see: a PR correctly bumps `package.json`'s version, but nobody ever runs the manual
republish+reinstall step afterward, leaving an installed Claude Code plugin cache copy stale
while reporting the same version string as the repo build (the cache is version-keyed, not
content-addressed — `blackhole-protocol.md` § Branch & Worktree Hygiene).

**Widened scope (issue #912, ADR-044).** Claude Code composes PreToolUse hooks from every
enabled source and merges them deny-wins, with no override — a signal built from one guessed
installed-cache path can report "not installed" while a *different*, stale copy is actively
vetoing calls the repo's own current code allows. The signal now enumerates every registered
source instead of guessing one path, and asserts an ordering only where a resolvable commit SHA
proves one:

1. **Enumerate** (`scripts/lib/hook-sources.ts`) four settings layers plus every candidate row
   in `~/.claude/plugins/installed_plugins.json`: project `.claude/settings.json` (resolves to
   the repo's own build output, `origin_kind: repo-build`), `enabledPlugins` (resolves to one or
   more installed-cache rows, `origin_kind: plugin-cache` — when more than one install row could
   apply to this project, e.g. a project-scope row alongside a user-scope row, **all candidates
   are reported and none is picked**; the scope-precedence rule is a reconstructed assumption,
   never adjudicated), user `~/.claude/settings.json` and `.claude/settings.local.json`
   (`origin_kind: foreign` — third-party or unrecognized automation).
2. **Order** (`scripts/lib/hook-source-ordering.ts`) each present, SHA-bearing source against
   `origin/main` via an injected git resolver (`merge-base --is-ancestor` run in **both**
   directions), rendering exactly three distinct outcomes, none collapsed into "no drift":
   *strict* (older / newer / identical / **diverged** — two installs off different branches, its
   own state), *version-differs-ordering-unproven* (a version string with no resolvable SHA — the
   majority consumer-repo topology, since a consumer has neither blackhole's commit history nor a
   blackhole `origin/main`), and *no-baseline* (a foreign source — presence and deny-wins
   participation only, rendered as its own state in the clean case **and** the drifted one).
   `veto_pairs[]` names every pair where one source is provably older than another, since
   deny-wins composition means an older source can still override a newer one.
3. **Hash** (`scripts/lib/plugin-drift.ts`'s reused `hashDirectory`) each present directory-kind
   source's content, feeding the `installed_present`/`hooks_hash_match` derived roll-up so
   `renderPluginDriftWarning` keeps working: `hooks_hash_match` is `true` only when **every**
   present plugin-cache candidate's content matches the repo build's — any one mismatch flips it
   to `false` (the "prefer false positives" bias the design's binding constraints require).

Existence-gated: when `scripts/plugin-drift-signal.ts` exists at repo root (blackhole
self-hosting its own campaign), refresh `.blackhole/plugin-drift.json` via
`bun run scripts/plugin-drift-signal.ts`; absent, this step is inert — no error, no attempted
invocation. The signal is schema `version: 2`, carrying `sources[]` (each with its enumeration,
ordering, and content-hash fields merged) and `veto_pairs[]`.

`scripts/campaign-status.ts`'s `renderPluginDriftWarning` renders one line per non-clean source
(never fully silent while a foreign source is registered — its unverifiable provenance never
becomes clean, even after every SHA-bearing source matches) plus one line per `veto_pairs[]`
entry — visibility only, no ledger append, no phase gate. The ordering leg is
**effectively self-hosting-only**: in a consumer repo, blackhole's commit history is absent from
the local object store and `origin/main` is a different project, so the signal renders
`ordering_available: false` with a reason rather than guessing.

**Scan-boundary disclosure (ADR-044 § A-5), unconditional.** Every source outside the four-layer
scan (e.g. a plugin's own bundled settings registering a matcher this scan doesn't parse) stays
invisible. The signal states this boundary in its own emitted output — a fixed `scan_boundary`
field on the JSON signal (`SCAN_BOUNDARY_NOTE`, `plugin-drift-signal.ts`), printed by the CLI on
its own line, and appended by `renderPluginDriftWarning` to **every** render, clean or not — so a
clean render never reads as "the net is current". A fully clean render still surfaces a `✓
Plugin cache: every registered source within scan boundary is clean.` line followed by the
disclosure; a warning render appends the same disclosure after its per-source and `veto_pairs[]`
lines. Whether a copy this scan cannot see actually issued a live denial is only ever observed at
runtime, which is issue #919's scope, not this one's.

## Worktree & Branch obligations

- Run `git worktree prune` and `git fetch --prune` before creating a new worktree or branch.
- Before removing a worktree — post-merge cleanup included, not only the mergeable-release
  boundary — check `git -C <worktree> log @{u}..HEAD` is empty, then issue the removal itself as a
  standalone command with a literal absolute path (no variable, no chained call, no trailing
  redirect). Full guard, rationale, and procedure: `blackhole-protocol.md` § Branch & Worktree
  Hygiene (Removal safety refusal); `recovery-protocol.md` §4/§6(c).
- Verify worktree directories are clean and removed from disk after worker tasks finish. Do not leave orphaned worktree directories in the scratchpad.

Note: `config.json`'s `docs_governance` block is a kill switch for companion-file,
docs-impact-routing, and write-governance state mutations. Any future feature that
reads or mutates state under this block's scope must check `docs_governance.enabled`
(and the relevant sub-flag) before acting. The absent-block default is defined once, in
`config-template.md`'s `docs_governance.enabled` row and contract note — this file does
not restate it (V-DRY-01, issue #477).

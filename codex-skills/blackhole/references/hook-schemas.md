# Hook Schemas

Cursor SubagentStop hook install/behavior specs and the PreToolUse hook-events schema for campaign worker agents. Split out of [`worker-schemas.md`](worker-schemas.md) (issue #473) to restore `V-CONTENTGATE-01` headroom — these sections are optional/harness-level installs, not part of the worker JSON return contract that file documents.

## SubagentStop hook (Cursor)

**Install:** Merge the `hooks` block from [`templates/hooks/subagent-stop-validate.json`](../../templates/hooks/subagent-stop-validate.json) into your project's `.cursor/hooks.json`. Requires `bun` on `PATH`; hook `command` paths are relative to the repo root.

**Behavior:** On `subagentStop`, when the hook `matcher` hits `planner`, `implementer`, `reviewer`, `router`, `investigator`, or `hunter`, Cursor runs `bun run scripts/validate-worker-json.ts --hook` with the stop payload on **stdin**. Non-zero exit blocks handoff (`failClosed: true`). Subagent stops with `status` `error` or `aborted`, or non-campaign subagents, pass through (exit `0`).

**Extraction order:** Worker JSON is parsed from (1) a fenced ` ```json ` block in `summary`, (2) the last brace-balanced `{...}` object in `summary`, or (3) the tail of `agent_transcript_path` when readable — tier 3 is best-effort only: an unverified Cursor community bug report records `agent_transcript_path` arriving null for background subagents, so this tier can silently yield nothing even when correctly named and read.

**Exit codes:** `0` = valid or pass-through; `1` = validation or JSON extraction failure; `2` = hook stdin JSON parse failure.

### Orchestrator / harness fallback (non-Cursor)

Harnesses without Cursor hooks can validate worker output before mutating `queue.json`:

```bash
# Full structural validation (preferred)
bun run scripts/validate-worker-json.ts --role planner --file handoff.json
bun run scripts/validate-worker-json.ts --role implementer --json '{"status":"complete",...}'

# Quick spot-check only (not a substitute for full validation)
jq -e '.status and .plan_path' handoff.json
```

Fixture pairs for each role live under [`fixtures/worker-json/`](../../fixtures/worker-json/). Validator implementation: [`scripts/validate-worker-json.ts`](../../scripts/validate-worker-json.ts).

## SubagentStop resume hook (Cursor, #154)

**Install:** Merge the `hooks` block from [`templates/hooks/subagent-stop-resume.json`](../../templates/hooks/subagent-stop-resume.json) **after** the validate hook entry in `.cursor/hooks.json`. Install guide: [`templates/hooks/README.md`](../../templates/hooks/README.md).

**Behavior (Option C — hybrid):** On `subagentStop`, when the hook `matcher` hits `orchestrator`, `router`, `planner`, `implementer`, `reviewer`, or `investigator`, Cursor runs `bun run scripts/campaign-resume-signal.ts --hook` with the stop payload on **stdin**. The hook always evaluates resume gates first, then atomically upserts `.blackhole/resume-request.json`. Exit is always `0` (`failClosed: false`).

| Stopping agent | `followup_message` | File write |
|----------------|-------------------|------------|
| `orchestrator` | **Yes** — coordinator doorbell only | `resume-request.json` when gates pass |
| `router` / `planner` / `implementer` / `reviewer` / `investigator` | **No** | `resume-request.json` only when **stale barrier** detected |
| Non-campaign subagents | No | No |
| `status: error` / `aborted` | No | No |

**Ordering rule:** validate hook entry **must** appear first in the `subagentStop` array.

### Resume gates (all must pass)

1. `.blackhole/queue.json` exists and parses as JSON.
2. **Work remains:** at least one issue with `status: ready` or `status: in-flight`, or checkpoint `## Ready set` non-empty, or checkpoint `## In-flight workers` non-empty.
3. **No user gate:** no issue `notes` matching `awaiting-user`, `awaiting-plan`, or `awaiting-design` while `status` is `blocked` or `in-flight`.
4. **Orchestrator doorbell:** stdout `followup_message` emitted only when `subagent_type` resolves to `orchestrator` and file write succeeds.
5. **Stale barrier (workers only):** checkpoint `## In-flight workers` has active entries **and** stopping worker JSON validates — writes file with `reason: stale_barrier`, no `followup_message`.

Hook **must not** mutate `queue.json`, `findings-ledger.json`, or plan files.

### `.blackhole/resume-request.json` schema

```json
{
  "version": 1,
  "requested_at": "2026-07-09T12:00:00.000Z",
  "reason": "orchestrator_turn_complete",
  "target": "coordinator",
  "dedupe_key": "turn-12",
  "coalesce_until": "2026-07-09T12:00:05.000Z",
  "stopping_agent": "orchestrator",
  "queue_refreshed_at": "2026-07-09T11:59:00.000Z",
  "orchestrator_turn_id": 12
}
```

| Field | Values | Required |
|-------|--------|----------|
| `version` | `1` | yes |
| `requested_at` | ISO-8601 | yes |
| `reason` | `orchestrator_turn_complete` \| `stale_barrier` | yes |
| `target` | `coordinator` | yes |
| `dedupe_key` | string | yes — `turn-{id}` or `stale-wave-{turn}-{issue-set-hash}` |
| `coalesce_until` | ISO-8601 | yes — now + 5s; concurrent stops merge into one record |
| `stopping_agent` | agent role string | yes |
| `queue_refreshed_at` | string | yes |
| `orchestrator_turn_id` | number \| null | when checkpoint present |

**Write protocol:** read-modify-write via `.blackhole/resume-request.json.tmp` + `mv`. If existing record has `coalesce_until` in the future and same `dedupe_key`, refresh timestamp only (dedup). Coordinator **acks** by deleting the file or writing `{ "acked_at": ... }` after successful resume.

**Doorbell message (orchestrator stop only):**

```json
{
  "followup_message": "Blackhole: pending resume-request.json. Run coordinator turn flow — bun run status (full dashboard), then resume orchestrator with interrupt:false if work remains and queue is not user-blocked. Ack resume-request.json after resume."
}
```

### Manual test runbook (WAVE spawn)

| Step | Actor | Action | Expected |
|------|-------|--------|----------|
| 1 | maintainer | Merge validate + resume hook fragments into `.cursor/hooks.json` | Hooks tab shows both entries |
| 2 | coordinator | Phase 0 + spawn orchestrator `run_in_background: true` | orchestrator live |
| 3 | orchestrator | WAVE 0: spawn 2–4 `router` workers, barrier-wait, triage, turn-end | checkpoint workers empty |
| 4 | orchestrator | END TURN with ready work remaining | `subagentStop` fires |
| 5 | resume hook | writes `resume-request.json`, emits coordinator `followup_message` | file present; coordinator wakes |
| 6 | coordinator | `bun run status` → full dashboard → resume orchestrator | next turn without user chat |
| 7 | coordinator | delete/ack `resume-request.json` | file absent |
| 8 | negative | set `notes: awaiting-plan-approval` on in-flight issue, repeat step 4 | hook exits 0, **no** file, **no** followup |

```bash
bun test scripts/campaign-resume-signal.test.ts
# Manual: after orchestrator turn-end with work remaining:
test -f .blackhole/resume-request.json && jq -e '.target == "coordinator"' .blackhole/resume-request.json
```

Fixtures: [`fixtures/resume-signal/`](../../fixtures/resume-signal/). Implementation: [`scripts/campaign-resume-signal.ts`](../../scripts/campaign-resume-signal.ts).

## PreToolUse hook events (`.blackhole/hook-events/`, #447)

**Install:** shipped, never merged by hand — `bun run build` copies [`templates/hooks/pretooluse/`](../../templates/hooks/pretooluse/hooks.json) into `plugins/blackhole/hooks/`, `plugins/blackhole-claude/hooks/`, and (as a side effect of the shared `compileGeminiTree` call site) `.agents/build/hooks/`, so a marketplace install wires `PreToolUse` for `Bash` and `Write|Edit` with no consumer action. Each bundle reads pattern data from its own `hooks/patterns/`; the canonical SSOT — and the path every other install form resolves, since those vendor the repo source — is repo-root `templates/hooks/pretooluse/patterns/`. Deliberately literal, not `codex-skills`-relative: only these three roots receive the tree, so a per-target placeholder would render a path that does not exist on the other five generated copies of this file (root `references/`, `skills/blackhole/references/`, `.cursor/skills/blackhole/references/`, `.claude/skills/blackhole/references/`, `codex-skills/blackhole/references/`).

**Behavior:** two tiers, because an unattended worker has nobody to ask. A **block** match (destructive command, system path, `../` traversal, write resolving outside the worktree, or — outside a git context — outside the payload's own `cwd` subtree) prints `{"hookSpecificOutput":{"permissionDecision":"deny", ...}}`, writes the reason to **stderr** (the field the harness's exit-2 blocking-error contract feeds back to the calling model), and exits `2`. A **warn** match (sensitive filename, force push, registry publish, destructive SQL) prints the same `hookSpecificOutput.permissionDecision: "allow"` shape plus a `systemMessage`, and exits `0`. No match: exit `0`, no output, no record. Patterns are data — adding one is a JSON edit, never a code change.

**Failure split:** *fail-closed* on pattern-load failure — a validator that cannot parse its pattern data cannot tell safe from dangerous, so it denies. That is only safe to ship because `scripts/checks/hooks.check.ts` (`V-HOOKWIRE-01` / `V-HOOKPAT-01`) validates both pattern files at `bun run scripts/verify.ts` time. `validate-file-changes.js`'s worktree-containment sub-check degrades in two steps rather than skipping outright on plumbing failure (#512): outside a git context, it falls back to bounding writes to the payload's own `cwd` subtree — a target inside `cwd` is allowed (stderr notice, no block), a target outside `cwd` is denied (`outside-cwd-fallback`). If `cwd` itself resolves too broad to trust as a bound (`/`, `$HOME`, a bare temp root — the same breadth check `scratchpad_dir` uses, #510/F-00088) the write is denied outright (`cwd-fallback-too-broad`) rather than silently accepted. This never stalls a worker operating within its own working directory — the routine case — while closing the "anywhere on disk" gap the prior unconditional skip left open for consumer installs that may start outside a repository. The git-independent pattern checks (system path, traversal) are unaffected either way and always run first. *Fail-closed* also on any other uncaught exception in either validator's `main()` (#580) — a top-level `try/catch` around `main()` routes it through the same `failClosed()` these two checks already use, recording `uncaught-validator-error`; this closes the defect *class* (any current or future unguarded call in the synchronous call graph), not just the two crash sites an investigation confirmed by execution (`worktree-removal-guard.js`'s and `hook-event-log.js`'s unguarded `path.resolve` calls on a non-string `cwd`/`file_path`). One tier remains genuinely fail-*open*, deliberately: a process-level failure the validator's own JS-level catch cannot intercept — a missing `bun` binary, an OOM kill, or the wrapper's own 5-second hook timeout killing the process before it reaches any `catch` — still degrades to allow via the wrapper's exit-code fallback (`hook-exec-failure`, `tier: error`), so an infra hiccup can never stall the orchestrator's own session. The wrapper record carries `worktree`, `tool` (matcher-derived; `null` for `validate-file-changes` when Write vs Edit is indistinguishable without stdin replay), and exit-code-only `detail` — no stdin replay.

### `.blackhole/hook-events/<event-id>.json` schema

One file per event, written by non-agent code into the **main clone** (resolved via `git rev-parse --git-common-dir`, so every linked worktree lands in one directory). Filenames are `<iso-ts>-<pid>-<rand>.json` — unique by construction, so concurrent worktrees never race; unlike `resume-request.json` no read-modify-write merge is needed at write time.

| Field | Values | Required |
|-------|--------|----------|
| `version` | `1` | yes |
| `recorded_at` | ISO-8601 | yes |
| `hook` | `validate-bash-command` \| `validate-file-changes` | yes |
| `tool` | `Bash` \| `Write` \| `Edit` | yes — wrapper `hook-exec-failure` records may set `tool: null` when the hook is `validate-file-changes` (Write\|Edit matcher; Write vs Edit indistinguishable without stdin replay) |
| `decision` | `deny` \| `allow` | yes |
| `tier` | `block` \| `warn` \| `error` | yes — `error` is wrapper fail-open only (`decision: allow`) |
| `pattern_id` | matched entry's `id`, or `outside-worktree` \| `outside-assigned-worktree` \| `outside-cwd-fallback` \| `cwd-fallback-too-broad` \| `bash-outside-assigned-worktree` \| `bash-write-target-unresolvable` \| `main-clone-clean` \| `main-clone-checkout-path` \| `main-clone-restore` \| `main-clone-reset-destructive` \| `main-clone-apply` \| `main-clone-checkout-force` \| `main-clone-stash` \| `main-clone-target-unresolvable` \| `pattern-load-failure` \| `hook-input-parse-failure` \| `uncaught-validator-error` \| `hook-exec-failure` | yes |
| `reason` | human-readable refusal/flag text | yes |
| `worktree` | absolute worktree root of the calling process, or `null` | yes |
| `detail` | matched command or file path — credential literals masked, ≤300 chars (`block`/`warn` tiers; the `error` tier is unredacted — see note below) | yes |
| `agent_id` | the PreToolUse payload's own `agent_id` field verbatim, or `null` | yes |
| `agent_type` | the PreToolUse payload's own `agent_type` field verbatim, or `null` | yes |

`agent_id`/`agent_type` (#907, observability-only, no decision change) are the harness's own
PreToolUse fields — present, per Anthropic's schema, only when the hook fires from within a
subagent, absent on the main thread — recorded exactly as received so "absent" (`null`) is
distinguishable from "not captured" (a key predating this schema addition would simply be
missing). Confirmed present at runtime, but only for one population: a bare `Agent`-tool subagent
spawned under one-shot headless `claude -p` (anonymous and named alike). For the population issue
#907 actually depends on — an in-process, `SendMessage`-addressable Pattern C teammate — neither
field has ever been observed on the wire; this recording exists precisely so a real
`in_process_teammate` event can settle it. The `*.meta.json` evidence available for that
population points the other way: a named teammate's own metadata carries two separate fields,
`agentType` (the operator-chosen display name) and `customAgentType` (the role), while this
payload exposes only one `agent_type` string of unconfirmed origin (`.blackhole/plans/issue-907-design.md`
critic B, from `impl-903`/`fix-880-i3`/`review-896-2`/`rv-900`). On top of that population gap,
both fields are `.optional()` with no published Claude Code stability guarantee, so a missing or
non-string value degrades to `null` rather than being passed through raw. **Never build decision
logic on either field**: whether `agent_type` reflects the spawned `subagent_type` (its role) or
the operator-chosen teammate `name` is unresolved for the population that matters, and treating
either reading as a stable identity/role key was exactly the mistake the #907 design note warned
against.
These two are recorded for human/dashboard observability only. No redaction: unlike the `error`
tier's unredacted stderr tail (which carries arbitrary process output), `agent_id`/`agent_type`
are short, harness-generated identifiers/labels, not free text that could embed a credential —
the `redact()` masking `reason`/`detail` already receive is not needed here. The wrapper's own
`hook-exec-failure` record (below) hardcodes both to `null`: that wrapper forwards stdin without
parsing it, so it has nothing to extract them from — a permanent, not temporary, gap.

`outside-cwd-fallback` and `cwd-fallback-too-broad` are the one pair of `pattern_id` values that never actually reach this file: both fire only when `allWorktreeRoots(cwd)` found no git context, and `recordEvent`'s own destination (`git rev-parse --git-common-dir` from that same `cwd`) needs exactly the git context that is absent — so the deny still happens (stderr + exit `2`), but there is nowhere to persist the record, same as the campaign's pre-existing no-git-context `/etc/passwd` deny. Triage (below) never sees these two; a consumer install running outside a repository is, by construction, outside Triage's `.blackhole/hook-events/` polling scope too.

`outside-assigned-worktree` fires when `BLACKHOLE_ASSIGNED_WORKTREE` is set to a registered family worktree and the Write/Edit target resolves outside that single assigned root (#620). When the env var is unset, empty, or not a registered family worktree, containment falls back to `allWorktreeRoots(cwd)` unchanged — the same fail-open degradation as an invalid `scratchpad_dir` in #510.

`outside-worktree`'s root set (#729) is `allWorktreeRoots()`'s union of five members: every
registered worktree nested under the main clone; every registered worktree nested under a
validated `scratchpad_dir` (the campaign's own `.blackhole/config.json` value, breadth-checked
via the same check `scratchpad_dir` uses elsewhere in this file); `scratchpad_dir` itself,
admitted only when `isExistingDirectory()` confirms it is still present on disk — a target
sitting directly at the scratchpad root, not just inside one of its `wt-*` subdirectories, is
in-bounds; the payload's own `cwd` worktree, always included when not already covered by the
three roots above (#729); and, when set and valid (same breadth and existence checks as
`scratchpad_dir`), an opt-in `BLACKHOLE_SCRATCHPAD_DIR` env var — a distinct mechanism from
the config `scratchpad_dir` above, naming the harness's own per-session scratchpad directory,
which is never a git worktree and so never appears in `git worktree list` output at all.

`bash-outside-assigned-worktree` and `bash-write-target-unresolvable` (issue #804, ADR-029) extend `outside-assigned-worktree`'s containment to the `Bash` tool: `validate-bash-command.js`'s `bash-write-target-guard.js` extracts common file-write-target shapes (`>`, `>>`, `&>`, `tee [-a]`, `sed -i[.suffix]`, `cp`, `mv`, heredoc targets) from the command string and, when `BLACKHOLE_ASSIGNED_WORKTREE` is set, checks each resolvable target against that same single root. A resolvable target outside the assigned root denies (`bash-outside-assigned-worktree`, block tier); a write-shaped command whose target cannot be resolved statically (a dynamic argument, or a command like `python3 -c`/`perl -i`/`awk`/`dd`/`rsync` whose write behavior cannot be determined from the command string alone) is allowed but recorded (`bash-write-target-unresolvable`, warn tier) — never a silent allow. Unset, empty, or not a registered family worktree: fail open, byte-identical to today (same #620 degradation `outside-assigned-worktree` already documents).

The eight `main-clone-*` pattern ids (issue #897, ADR-043) refuse a working-tree-mutating `git` subcommand whose effective repository is not a linked worktree — this includes the campaign's main clone, but also any other standalone, non-linked-worktree checkout (`worktree-removal-guard.js`'s `findRemovalInvocations` cannot tell those apart from each other, only from a genuine linked worktree; see ADR-043 § Consequences). `validate-bash-command.js`'s `git-main-clone-guard.js` reuses the same clause walk `worktree-removal-guard.js` already runs for `git worktree remove` (a second subcommand match emitted only from the CERTAIN executable position), then grades severity by recoverability — none of the six block-tier ids below can be recovered by inspecting reflog or `refs/stash` after the fact:

| `pattern_id` | Matched subcommand shape | Tier |
|---|---|---|
| `main-clone-clean` | `git clean` with a force flag | block |
| `main-clone-checkout-path` | `git checkout <ref> -- <path>` / `git checkout -- <path>` | block |
| `main-clone-restore` | `git restore` without `--staged` alone | block |
| `main-clone-reset-destructive` | `git reset --hard` / `--merge` | block |
| `main-clone-apply` | `git apply` / `git am` | block |
| `main-clone-checkout-force` | a forced `git checkout`/`switch <branch>` (`-f`/`--force`/`--discard-changes`) | block |
| `main-clone-stash` | `git stash` (any form) | warn — persists in `refs/stash`, retrievable via `fsck --unreachable` even after `drop` |
| `main-clone-target-unresolvable` | a matched destructive subcommand whose effective repository identity could not be determined (an anomalous, not merely absent, git failure — the same "routine vs. anomalous" discrimination `mainCloneRoot` already makes elsewhere in this file) | warn — never denied; a transient broken-`GIT_DIR` condition must never convert into a block for every subsequent call |

Effective repository resolution honors a `-C <path>` / `--git-dir=<path>` / `--work-tree=<path>` override when present (`extractGitRepoOverride`, a sibling reader of the same option run `skipGitGlobalOptions` walks — that function is not modified) — the campaign's own convention is `git -C <worktree-abs-path> ...`, so keying identity on the invoking shell's cwd alone would misresolve exactly the commands this check most needs to see. `git add`, `git commit`, and `git merge`/`rebase`/`cherry-pick` are deliberately excluded — all recoverable via the object store or reflog — so `git add` in particular stays unguarded by this check (the other half of finding F-00034's original damage), and `git worktree remove` stays owned entirely by the pre-existing `#532` removal-safety checks above, never by this guard.

**Orchestrator consumption:** Triage step 1b ([`orchestrator-runtime.md`](orchestrator-runtime.md) § Triage) and the turn-start step 6 ([`orchestrator-runtime.md`](orchestrator-runtime.md) § Session resume & recovery) both glob the directory via `scripts/lib/hook-event-triage.ts`, resolving `issue_ref` by matching `worktree` against `queue.json`'s in-flight worktree paths. Finding identity is **per class** — `(vcode, pattern_id, worktree)` (ADR-042, issue #893), not per event: a recurrence of an already-`open` `V-HOOK-01`/`V-HOOK-02`/`V-HOOK-03` row increments that row's `occurrences` and bumps `last_seen_at` instead of appending a second row; a class whose only prior row is `deferred` still gets a fresh `open` row rather than a silent bump. The consumed event file is then moved to `.blackhole/archive/hook-events-<turn-timestamp>/`, never unlinked. Written from outside the agent process, a refusal from one of blackhole's own validators — anything that writes through `hook-event-log.js` — is still on the record even when the worker never mentions it in its own return JSON: that defeats an uncooperative worker's *silence*, not its filesystem access: a worker with Bash access to the main clone could still delete or overwrite its own event file before ingestion runs. Globbing before validating the return JSON narrows that window; it does not close it. This guarantee does not extend to a foreign, co-installed PreToolUse hook's own deny: nothing in the documented Claude Code hooks contract lets one hook observe a sibling's decision — hooks run in parallel with no aggregated-decision indicator exposed (`documentation/investigations/research-cross-plugin-hook-denial-visibility.md`) — so a foreign source's deny leaves no record here at all. #912 raises the ceiling at config time only: it enumerates every registered PreToolUse source and flags when a foreign one is present, since any registered hook participates in the harness's deny-wins merge. That is the honest boundary — visibility that a foreign source *could* veto a call, never confirmation that it *did*.

`detail` on an `error`-tier (`hook-exec-failure`) record is no longer the bare `"process exit code N"` literal (ADR-042 item 5): the wrapper (`scripts/lib/build/claude-native-settings.ts`) captures the validator subprocess's own stderr to a temp file, appends a `(timeout)`/`(crash)` discriminator (elapsed wall-clock time against the wrapper's own 5-second hook timeout — a coarse heuristic, since a genuine harness-level kill leaves nothing running to observe its own cause) and, when non-empty, a ≤300-char tail of that stderr — the same length cap `block`/`warn`-tier `detail` already carries. No stdin/command replay is added.

Unlike `block`/`warn`-tier `detail`, this `error`-tier stderr tail is **not** run through `redact()` — it is captured directly by the shell wrapper, which deliberately does not reimplement `hook-event-log.js`'s `redact()` in shell (V-INT-02): duplicating that masking logic in Bash would be a second, drifting definition of what counts as a credential literal. This is an accepted, unmitigated gap: a validator crash whose uncaught error message happens to include a credential fragment would be captured verbatim into `.blackhole/hook-events/`, folded into the ledger `summary`, and rendered on `bun run status` — a persistent, lower-trust artifact, unlike the transient process stderr it was read from. Closing this (e.g. a small shared masking script both `hook-event-log.js` and the wrapper can invoke) is out of scope for ADR-042 and would need its own change.

## PermissionDenied hook (Claude Code, not installed)

A real, currently-shipped Claude Code hook event — confirmed via `anthropics/claude-code#41261`, which quotes the shipped changelog verbatim. Blackhole does not register or consume it: no `hooks.json` entry, no ledger wiring. Documented here only because its firing condition is easy to over-infer as a cross-hook denial signal, and it is not one: it fires **only** after Claude Code's own auto-mode permission classifier denies a call. It **never** fires after a PreToolUse hook's own deny decision — not blackhole's own validators (§ PreToolUse hook events, `hook-event-log.js`, above), and not a foreign, co-installed plugin's. It was evaluated as the one plausible indirect channel for cross-hook denial visibility and ruled out on exactly this ground (`documentation/investigations/research-cross-plugin-hook-denial-visibility.md`) — it fires from a different decision path than the PreToolUse contract these hooks share, not as an escalation from it.
<!-- GENERATED by scripts/build.ts from src/references/hook-schemas.md — do not hand-edit -->

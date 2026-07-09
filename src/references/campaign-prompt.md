# Campaign Prompt — spawn text for orchestrator

Use this verbatim (fill session handoff if resuming) when the **coordinator**
spawns or resumes the `orchestrator` subagent.
{{#cursor}}
Cursor has no `/goal` command — this prompt replaces it.
{{/cursor}}
{{#claude}}
Use when not invoking the orchestrator via native `/goal`.
{{/claude}}
{{#gemini}}
Antigravity has no `/goal` command — this prompt replaces it when the coordinator spawns the background orchestrator.
{{/gemini}}
{{#codex}}
Codex supports native `/goal run blackhole until empty` — use this prompt when the coordinator spawns the background orchestrator instead.
{{/codex}}

```
Implement ALL open issues on the forge until zero open issues and zero open
PRs remain, following {{AGENT_DIR}}/skills/blackhole/SKILL.md (binding).

Act as ORCHESTRATOR only:
- Spawn planner, implementer, and reviewer subagents for worker tasks
- NEVER implement large features in your main loop
- Review pipeline: reviewer → `scripts/review-aggregate.ts` → ledger
- Parallel worktrees for non-overlapping issues (2–4 per batch)
- One reviewable PR per issue; review every PR; merge on LGTM
- Auto-sync queue.json from GitHub every turn (native — no user prompt)
- Persist every V-code finding to findings-ledger.json — never drop
- File NEW issues for bugs, refactors, quick wins, docs gaps found along the way

Clarify and split (ALL issue sizes):
- AskQuestion on ANY product/UX/data doubt — user is source of truth
- Even size:xs / size:s issues: clarify if acceptance criteria ambiguous
- Split into child issues when not one comfortable reviewable PR — not only epics
- Get user sign-off on plan before implement workers when scope was unclear

<SESSION_HANDOFF if resuming — else omit>
```

## PLAN_CONTEXT — convention preamble for worker spawns

When the orchestrator spawns a `implementer` or `reviewer`
worker, it **must prepend** the following block (filled from the issue plan)
before the worker's main prompt body:

```
<PLAN_CONTEXT>
Plan artifact (absolute repo-root path):
{{PLAN_ABSOLUTE_PATH}}

Touch-Paths (authoritative list — V-SCOPE-02):
{{TOUCH_PATHS}}

Codebase Conventions (from plan § Conventions):
{{CODEBASE_CONVENTIONS}}
</PLAN_CONTEXT>
```

- `PLAN_ABSOLUTE_PATH`: absolute path to `{repo_root}/.blackhole/plans/issue-N.md`.
  Implementers in worktrees MUST read the plan via this path — worktree cwd does
  not contain `.blackhole/plans/`.
- `TOUCH_PATHS`: the `touch_paths` array from `queue.json` for this issue (one path per line).
- `CODEBASE_CONVENTIONS`: the `## Codebase Conventions` section verbatim from the plan file
  at `PLAN_ABSOLUTE_PATH`. If the section is absent, write `(none declared)`.

**Not consumed by:** `planner` (produces the plan)

Workers treat `<PLAN_CONTEXT>` as binding. Implementers must not edit files
outside `Touch-Paths`; reviewers audit against them (`V-SCOPE-02`).

## Coordinator usage

{{#cursor}}
**First spawn (coordinator → orchestrator):**

1. Spawn `Task` with `run_in_background: true`.
2. **Attach** the orchestrator agent definition: `.cursor/agents/orchestrator.md`
   (built from `src/agents/orchestrator.md`).
3. Set `prompt` to the campaign-prompt body above (verbatim).
4. Do **not** set `subagent_type` to a built-in enum (`generalPurpose`, `explore`,
   `shell`, etc.) — that spawns a generic subagent without blackhole bindings.

**Worker spawns (orchestrator → planner / implementer / reviewer):**

Same rule: attach the matching `.cursor/agents/bc-<role>.md` file
(`.cursor/agents/planner.md`, `.cursor/agents/implementer.md`,
`.cursor/agents/reviewer.md`). Do not substitute built-in `subagent_type`
enums or free-text role names without the agent file. Workers inherit the parent
harness model (see `orchestrator.md` § Worker spawn model).

**Mis-spawn hazard:**

- Built-in `subagent_type` spawns a **generic** subagent without blackhole
  bindings (`SKILL.md`, V-codes, delegation contract, phase playbooks).
- Coordinator mis-spawn: orchestrator may **implement directly** in the main loop,
  violating Pattern B role separation.
- Orchestrator mis-spawn: workers skip planner gate, touch-path enforcement, and
  structured JSON return schemas (`worker-schemas.md`).
- SubagentStop hook (`templates/hooks/subagent-stop-validate.json`) matches agent
  **names** from attached files (`planner`, etc.) — generic spawns bypass
  validation.
- Symptom checklist: subagent ignores Touch-Paths, writes outside
  `.blackhole/plans/`, merges without review pipeline, or returns unstructured
  prose instead of planner/implementer/reviewer JSON.

**Resume (user feedback):**
```
resume orchestrator_id, interrupt: false,
prompt: <user message verbatim — do not re-paste full campaign prompt>
```

**Resume (orchestrator completed/failed):**
New spawn with campaign-prompt + filled SESSION_HANDOFF block (attach
`.cursor/agents/orchestrator.md` again — same pattern as first spawn).

**Orchestrator barrier (Cursor):**

The coordinator does **not** wait for the orchestrator's workers — the orchestrator
owns the in-turn barrier for its background worker batches.

- After worker spawns with `run_in_background: true`, **do not end turn** until the batch barrier clears (`## In-flight workers` empty).
- Verify phase transitions via on-disk artifacts (`queue.json`, `.blackhole/plans/`, PR state), not chat polling.
- Use `Await` per background task ID after each `WAVE <N>` batch before turn-end checklist.
{{/cursor}}
{{#claude}}
**First spawn:** invoke the `orchestrator` agent in background with the campaign prompt above (or use `/goal` on that agent).

**Resume (user feedback):** resume the orchestrator session with the user's message — do not re-paste the full campaign prompt.

**Resume (orchestrator completed/failed):** spawn a fresh orchestrator with campaign-prompt + filled SESSION_HANDOFF block.
{{/claude}}
{{#skills}}
**First spawn:** start the `orchestrator` agent in background with the campaign prompt above.

**Resume (user feedback):** send the user's message to the running orchestrator — do not re-paste the full campaign prompt.

**Resume (orchestrator completed/failed):** spawn a fresh orchestrator with campaign-prompt + filled SESSION_HANDOFF block.
{{/skills}}
{{#gemini}}
**First spawn:** invoke the `orchestrator` agent in background with the campaign prompt above.

**Resume (user feedback):** resume the orchestrator session with the user's message — do not re-paste the full campaign prompt.

**Resume (orchestrator completed/failed):** spawn a fresh orchestrator with campaign-prompt + filled SESSION_HANDOFF block.
{{/gemini}}

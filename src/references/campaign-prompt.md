# Campaign Prompt — spawn text for orchestrator

Use this verbatim (fill session handoff if resuming) when the **coordinator**
spawns or resumes the `bc-orchestrator` subagent.
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
Codex supports native `/goal run bc-campaign until empty` — use this prompt when the coordinator spawns the background orchestrator instead.
{{/codex}}

```
Implement ALL open issues on the forge until zero open issues and zero open
PRs remain, following {{AGENT_DIR}}/skills/bc-campaign/SKILL.md (binding).

Act as ORCHESTRATOR only:
- Spawn bc-planner, bc-implementer, and bc-reviewer subagents for worker tasks
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

When the orchestrator spawns a `bc-implementer` or `bc-reviewer`
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

- `PLAN_ABSOLUTE_PATH`: absolute path to `{repo_root}/.bc-campaign/plans/issue-N.md`.
  Implementers in worktrees MUST read the plan via this path — worktree cwd does
  not contain `.bc-campaign/plans/`.
- `TOUCH_PATHS`: the `touch_paths` array from `queue.json` for this issue (one path per line).
- `CODEBASE_CONVENTIONS`: the `## Codebase Conventions` section verbatim from the plan file
  at `PLAN_ABSOLUTE_PATH`. If the section is absent, write `(none declared)`.

**Not consumed by:** `bc-planner` (produces the plan)

Workers treat `<PLAN_CONTEXT>` as binding. Implementers must not edit files
outside `Touch-Paths`; reviewers audit against them (`V-SCOPE-02`).

## Coordinator usage

{{#cursor}}
**First spawn (coordinator → orchestrator):**

1. Spawn `Task` with `run_in_background: true`.
2. **Attach** the orchestrator agent definition: `.cursor/agents/bc-orchestrator.md`
   (built from `src/agents/bc-orchestrator.md`).
3. Set `prompt` to the campaign-prompt body above (verbatim).
4. Do **not** set `subagent_type` to a built-in enum (`generalPurpose`, `explore`,
   `shell`, etc.) — that spawns a generic subagent without bc-campaign bindings.

**Worker spawns (orchestrator → bc-planner / bc-implementer / bc-reviewer):**

Same rule: attach the matching `.cursor/agents/bc-<role>.md` file
(`.cursor/agents/bc-planner.md`, `.cursor/agents/bc-implementer.md`,
`.cursor/agents/bc-reviewer.md`). Do not substitute built-in `subagent_type`
enums or free-text role names without the agent file. Workers inherit the parent
harness model (see `bc-orchestrator.md` § Worker spawn model).

**Mis-spawn hazard:**

- Built-in `subagent_type` spawns a **generic** subagent without bc-campaign
  bindings (`SKILL.md`, V-codes, delegation contract, phase playbooks).
- Coordinator mis-spawn: orchestrator may **implement directly** in the main loop,
  violating Pattern B role separation.
- Orchestrator mis-spawn: workers skip planner gate, touch-path enforcement, and
  structured JSON return schemas (`worker-schemas.md`).
- SubagentStop hook (`templates/hooks/subagent-stop-validate.json`) matches agent
  **names** from attached files (`bc-planner`, etc.) — generic spawns bypass
  validation.
- Symptom checklist: subagent ignores Touch-Paths, writes outside
  `.bc-campaign/plans/`, merges without review pipeline, or returns unstructured
  prose instead of planner/implementer/reviewer JSON.

**Resume (user feedback):**
```
resume orchestrator_id, interrupt: false,
prompt: <user message verbatim — do not re-paste full campaign prompt>
```

**Resume (orchestrator completed/failed):**
New spawn with campaign-prompt + filled SESSION_HANDOFF block (attach
`.cursor/agents/bc-orchestrator.md` again — same pattern as first spawn).
{{/cursor}}
{{#claude}}
**First spawn:** invoke the `bc-orchestrator` agent in background with the campaign prompt above (or use `/goal` on that agent).

**Resume (user feedback):** resume the orchestrator session with the user's message — do not re-paste the full campaign prompt.

**Resume (orchestrator completed/failed):** spawn a fresh orchestrator with campaign-prompt + filled SESSION_HANDOFF block.
{{/claude}}
{{#skills}}
**First spawn:** start the `bc-orchestrator` agent in background with the campaign prompt above.

**Resume (user feedback):** send the user's message to the running orchestrator — do not re-paste the full campaign prompt.

**Resume (orchestrator completed/failed):** spawn a fresh orchestrator with campaign-prompt + filled SESSION_HANDOFF block.
{{/skills}}
{{#gemini}}
**First spawn:** invoke the `bc-orchestrator` agent in background with the campaign prompt above.

**Resume (user feedback):** resume the orchestrator session with the user's message — do not re-paste the full campaign prompt.

**Resume (orchestrator completed/failed):** spawn a fresh orchestrator with campaign-prompt + filled SESSION_HANDOFF block.
{{/gemini}}

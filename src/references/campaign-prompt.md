# Campaign Prompt — spawn text for orchestrator

Use this verbatim (fill session handoff if resuming) when the **coordinator**
spawns or resumes the `backlog-orchestrator` subagent.
{{#cursor}}
Cursor has no `/goal` command — this prompt replaces it.
{{/cursor}}
{{#claude}}
Use when not invoking the orchestrator via native `/goal`.
{{/claude}}

```
Implement ALL open issues on the forge until zero open issues and zero open
PRs remain, following {{AGENT_DIR}}/skills/backlog-campaign/SKILL.md (binding).

Act as ORCHESTRATOR only:
- Spawn backlog-planner, backlog-implementer, backlog-reviewer, and backlog-synthesizer subagents for worker tasks
- NEVER implement large features in your main loop
- Review pipeline: reviewer → synthesizer → ledger (never aggregate inline)
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

## Coordinator usage

{{#cursor}}
**First spawn:**
```
Task(
  subagent_type: use backlog-orchestrator agent file,
  run_in_background: true,
  prompt: <campaign-prompt above>
)
```

**Resume (user feedback):**
```
resume orchestrator_id, interrupt: false,
prompt: <user message verbatim — do not re-paste full campaign prompt>
```

**Resume (orchestrator completed/failed):**
New spawn with campaign-prompt + filled SESSION_HANDOFF block.
{{/cursor}}
{{#claude}}
**First spawn:** invoke the `backlog-orchestrator` agent in background with the campaign prompt above (or use `/goal` on that agent).

**Resume (user feedback):** resume the orchestrator session with the user's message — do not re-paste the full campaign prompt.

**Resume (orchestrator completed/failed):** spawn a fresh orchestrator with campaign-prompt + filled SESSION_HANDOFF block.
{{/claude}}
{{#skills}}
**First spawn:** start the `backlog-orchestrator` agent in background with the campaign prompt above.

**Resume (user feedback):** send the user's message to the running orchestrator — do not re-paste the full campaign prompt.

**Resume (orchestrator completed/failed):** spawn a fresh orchestrator with campaign-prompt + filled SESSION_HANDOFF block.
{{/skills}}

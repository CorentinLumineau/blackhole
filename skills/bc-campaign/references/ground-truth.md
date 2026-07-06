# Ground Truth — Protocol Drift Detection

Machine-verified canonical values for bc-campaign. `scripts/verify.ts` reads this file and fails on mismatch.

**Do not edit counts manually without updating the corresponding source files.**

## Agents

| bc-coordinator | `src/agents/bc-coordinator.md` |
| bc-orchestrator | `src/agents/bc-orchestrator.md` |
| bc-planner | `src/agents/bc-planner.md` |
| bc-implementer | `src/agents/bc-implementer.md` |
| bc-reviewer | `src/agents/bc-reviewer.md` |

**agent_count:** 5

## Phases

Exact phase strings used in `queue.json` `issues.*.phase`:

- `handle`
- `plan`
- `implement`
- `review`
- `done`

Phase playbook files:

- `phase-handle.md`
- `phase-plan.md`
- `phase-implement.md`
- `phase-review.md`
- `phase-loop.md`

**phase_playbook_count:** 5

## V-codes

Source: `src/references/bc-campaign-vcodes.md`

**vcode_table_rows:** 27

## Verify checks

**verify_check_count:** 17

| Check ID | Description |
|----------|-------------|
| V-TOOLS-01 | No tools: allowlist on agents; correct disallowedTools per deny matrix |
| V-DELEG-01 | Worker agents declare 5-field or output contract |
| V-AGENT-01 | Agent frontmatter complete |
| V-PHASE-01 | Phase playbooks use consistent phase names |
| V-VCODE-01 | V-codes referenced in agents or phases |
| V-BUILD-01 | Build produces clean output (fails on dirty build-output paths; opt out via VERIFY_SKIP_BUILD=1) |
| V-SCHEMA-01 | Fixture JSON validates |
| V-PLAN-01 | In-flight plan/implement/review entries require plans/issue-N.md |
| V-SKILL-01 | SKILL.md modes align with phases |
| V-GROUND-01 | Ground-truth counts match filesystem |
| V-EPIC-01 | epic-orchestration.md exists and phase-handle links to it |
| V-CHECKPOINT-01 | checkpoint template frontmatter keys align with orchestrator and phase-loop write order |
| V-GEMINI-01 | Gemini build outputs complete; no stale platform conditionals |
| V-CODEX-01 | Codex build succeeds as part of default `bun run build` |
| V-CODEX-02 | Codex plugin.json and marketplace validate against fixture baselines |
| V-CODEX-03 | codex-skills/bc-campaign/SKILL.md with disable-model-invocation |
| V-CODEX-04 | Five agent YAML files in codex-agents/ with instructions block |

## Config schema

**config_schema_version:** 1

Required keys: `repo`, `target_branch`, `forge`

## SKILL modes

- `run`
- `status`
- `handle`
- `plan`
- `implement`
- `review`
- `campaign-audit`

**skill_mode_count:** 7

## References (required)

- `review-core.md`
- `worker-schemas.md`
- `checkpoint-protocol.md`
- `findings-ledger.md`
- `queue-dag.md`
- `agent-tools.md`
- `epic-orchestration.md`

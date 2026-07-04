# Ground Truth — Protocol Drift Detection

Machine-verified canonical values for backlog-campaign. `scripts/verify.ts` reads this file and fails on mismatch.

**Do not edit counts manually without updating the corresponding source files.**

## Agents

| Name | File |
|------|------|
| backlog-coordinator | `src/agents/backlog-coordinator.md` |
| backlog-orchestrator | `src/agents/backlog-orchestrator.md` |
| backlog-planner | `src/agents/backlog-planner.md` |
| backlog-implementer | `src/agents/backlog-implementer.md` |
| backlog-reviewer | `src/agents/backlog-reviewer.md` |
| backlog-synthesizer | `src/agents/backlog-synthesizer.md` |

**agent_count:** 6

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

Source: `src/references/backlog-campaign-vcodes.md`

**vcode_table_rows:** 27

## Verify checks

**verify_check_count:** 10

| Check ID | Description |
|----------|-------------|
| V-TOOLS-01 | No tools: allowlist on agents; correct disallowedTools per deny matrix |
| V-DELEG-01 | Worker agents declare 5-field or output contract |
| V-AGENT-01 | Agent frontmatter complete |
| V-PHASE-01 | Phase playbooks use consistent phase names |
| V-VCODE-01 | V-codes referenced in agents or phases |
| V-BUILD-01 | Build produces clean output |
| V-SCHEMA-01 | Fixture JSON validates |
| V-SKILL-01 | SKILL.md modes align with phases |
| V-GROUND-01 | Ground-truth counts match filesystem |
| V-EPIC-01 | epic-orchestration.md exists and phase-handle links to it |

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

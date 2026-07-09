# Cursor hooks — blackhole campaign

Install fragments from this directory into your project's `.cursor/hooks.json`.

## Order (required)

1. **Validate** — [`subagent-stop-validate.json`](subagent-stop-validate.json) (`failClosed: true`)
2. **Resume** — [`subagent-stop-resume.json`](subagent-stop-resume.json) (`failClosed: false`)

Validate must appear **first** in the `subagentStop` array so worker JSON is validated before `resume-request.json` is written.

## Example merged `hooks.json`

```json
{
  "version": 1,
  "hooks": {
    "subagentStop": [
      {
        "command": "bun run scripts/validate-worker-json.ts --hook",
        "matcher": "planner|implementer|reviewer|router|investigator",
        "failClosed": true
      },
      {
        "command": "bun run scripts/campaign-resume-signal.ts --hook",
        "matcher": "orchestrator|router|planner|implementer|reviewer|investigator",
        "failClosed": false,
        "loop_limit": 4
      }
    ]
  }
}
```

See [`src/references/worker-schemas.md`](../../src/references/worker-schemas.md) for resume contract, gates, and manual test runbook.

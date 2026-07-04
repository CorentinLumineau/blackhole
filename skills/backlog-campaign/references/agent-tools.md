# Agent Tool Policy — Deny-List SSOT

## Design principle

**Default allow, role deny.** Each agent inherits all platform tools by default.
Only the actions the role *must not* perform are blocked via `disallowedTools`.

This means new platform tools (MCP variants, `Task` subtypes, future additions)
work automatically — no plugin update required. Matches the mercure workflow-skills
pattern (e.g. `x-design` uses `disallowed-tools: Edit` only).

## Deny matrix

| Agent | `disallowedTools` | Rationale |
|-------|-------------------|-----------|
| **backlog-coordinator** | `Write, Edit, Delete` | Intake/routing only — never edits implementation files |
| **backlog-orchestrator** | `Write, Edit, Delete` | Coordinate only — spawn workers, mutate JSON state via Shell/jq, not source edits |
| **backlog-planner** | `Delete` | May write `plans/issue-N.md`; must not delete arbitrary repo files |
| **backlog-implementer** | *(none)* | Full implementation access — tests, git, gh, edits, new MCP tools |
| **backlog-reviewer** | `Write, Edit, Delete` | Read-only audit (`V-SCOPE` at review time) |
| **backlog-synthesizer** | `Write, Edit, Delete` | Read-only aggregation (ADR-002) |

## Not denied (inherits from platform)

`Task`, `Shell`/`Bash`, `AskQuestion`, `Agent`, MCP tools (`CallMcpTool`, `gh`, etc.),
and all future platform additions.

## Frontmatter convention

Use `disallowedTools` (camelCase) — the Cursor agent convention. Same key is
recognised by Claude Code agents. No `tools:` allowlist line.

```yaml
---
name: backlog-coordinator
description: ...
model: sonnet
permissionMode: default
disallowedTools: [Write, Edit, Delete]
---
```

Implementer omits `disallowedTools` entirely (full access by design):

```yaml
---
name: backlog-implementer
description: ...
model: sonnet
permissionMode: default
---
```

## Verify

`V-TOOLS-01` in `scripts/verify.ts` enforces:

- No `tools:` allowlist on any agent frontmatter
- Each agent has the expected `disallowedTools` value per the deny matrix above
- Implementer has no `disallowedTools` field (or empty)

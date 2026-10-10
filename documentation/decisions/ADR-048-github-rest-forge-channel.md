---
type: adr
summary: "The GitHub forge adapter makes every call as a REST call through gh api instead of gh porcelain (GraphQL), so scripts work wherever a token works, including cloud sessions where GraphQL is blocked; agents on the rest or mcp channel run each gh command in the playbooks through its row in forge-channels.md"
status: accepted
review_trigger: "on a change to GitHub's REST API for issues, pulls or checks, or to the GitHub MCP tool set"
created: 2026-10-10
last_updated: 2026-10-10
related:
  - documentation/decisions/ADR-027-forge-adapter-interface.md
  - documentation/decisions/ADR-046-run-context-resolution.md
---

# ADR-048: GitHub REST forge channel

## Status

Accepted — 2026-10-10 (phase 3 of the run-accuracy plan, approved by the owner).

## Context

The GitHub adapter (ADR-027) called `gh` porcelain commands: `gh issue list`, `gh pr view`,
`gh pr checks`, `gh repo view`. Those commands use GraphQL. In a Claude Code cloud session
GraphQL is blocked and `gh auth status` fails, while `gh api` REST calls with the session's
token work. Repositories that still carry a classic Project also fail on `gh pr edit`. So the
campaign's scripts failed exactly where a token was available, and the playbooks, which write
every forge step as a porcelain command, gave the agent no other route.

## Decision

1. Every `GitHubForgeAdapter` call is a REST call through `gh api` (`runGhApi` in
   `scripts/lib/forge-adapter/cli.ts`, still the only `gh` spawn site, V-FORGE-01). REST rows map
   to the forge types in `scripts/lib/forge-adapter/github-rest.ts`, whose pure mappers any
   channel holding REST-shaped JSON can reuse. `campaign-status`'s forge counts and
   `triage-deferred-findings`'s issue lookup use the same functions.
2. `checkForgeAuthSync('github')` reports `channel: 'gh'` when `gh auth status` succeeds and
   `channel: 'rest'` when only `gh api` works. Run context (ADR-046) records `gh` only for the
   former.
3. `src/references/forge-channels.md` maps each forge operation the playbooks use to its
   porcelain, REST and GitHub MCP form. On the `rest` or `mcp` channel, agents run each `gh`
   command through that table. The playbooks are not rewritten.

## Alternatives Considered

- **Keep porcelain and add a REST path only on failure.** Two transports for every call, and
  every failure path tested twice. Rejected: REST works on every channel `gh` porcelain works on.
- **In-process `fetch` with the token, no `gh` binary.** Removes one dependency, but the callers
  are synchronous and `fetch` is not, and it duplicates auth and proxy handling `gh api` already
  has. Deferred: hosts without the `gh` binary use the MCP channel.
- **Rewrite every playbook command as REST.** About 80 commands across 20 files, for no gain on
  hosts where porcelain works. The table gives the same result with one file.

## Consequences

- Scripts work in cloud sessions and Project threads with a token, with no `gh auth login`.
- Issue lists filter pull requests and milestone titles client side, and page through results
  at 100 rows per page.
- `gh pr checks` parity covers check runs and legacy commit statuses.
- A host with neither `gh` nor a token reaches the forge only through the agent's MCP tools.
  Scripts there run with their no-forge option.

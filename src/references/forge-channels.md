# Forge Channels

GitHub work reaches the forge through one of three channels. `.blackhole/run-context.json`
records which one this run uses (`route.forge_channel`, `run-context.md`). The decision is in
`documentation/decisions/ADR-048-github-rest-forge-channel.md`.

| Channel | When | What it needs |
|---------|------|---------------|
| `gh` | `gh auth status` succeeds | The GitHub CLI, logged in |
| `rest` | `gh auth status` fails but a token works (cloud sessions, Project threads, CI) | The `gh` binary and `GH_TOKEN`/`GITHUB_TOKEN`; only `gh api` is used |
| `mcp` | No working `gh`, but GitHub MCP tools (`mcp__github__*`) are in the agent's tool list | The MCP tools; the agent makes each call itself |

**Scripts** (`scripts/**`) make every GitHub call as a REST call through `gh api`
(`scripts/lib/forge-adapter/github.ts`), so they work on both the `gh` and `rest` channels. On
`mcp` they cannot reach the forge. Run them with their no-forge option (`campaign-status.ts
--no-gh`) and make the call from the table below yourself.

**Prose commands.** The playbooks write forge steps as `gh` porcelain commands (`gh pr view`,
`gh issue list`, …). Those commands use GraphQL. GraphQL is blocked in Claude Code cloud
sessions and fails on repositories that still carry a classic Project. On any channel other than
`gh`, run the matching row below instead. Same inputs, same outputs; only the transport changes.

## Operation table

`{repo}` is `owner/name`. REST bodies go on stdin: `gh api -X POST <endpoint> --input - <<<'<json>'`.

| Operation | `gh` porcelain | `rest` (`gh api`) | `mcp` tool |
|-----------|----------------|-------------------|------------|
| Auth probe | `gh auth status` | `gh api rate_limit` | `get_me` |
| List issues | `gh issue list --state open --json …` | `GET repos/{repo}/issues?state=open&per_page=100&page=N` (drop rows with `pull_request`; match milestone by title) | `list_issues` |
| View issue | `gh issue view N --json …` | `GET repos/{repo}/issues/N` | `issue_read` (`get`) |
| Create issue | `gh issue create --title … --body … --label …` | `POST repos/{repo}/issues` `{title, body, labels, milestone}` | `issue_write` (`create`) |
| Edit issue body or title | `gh issue edit N --body-file -` | `PATCH repos/{repo}/issues/N` `{body}` | `issue_write` (`update`) |
| Close issue | `gh issue close N --reason …` | `PATCH repos/{repo}/issues/N` `{state: "closed", state_reason}` | `issue_write` (`update`, `state: closed`) |
| Comment on issue or PR | `gh issue comment N` / `gh pr comment N` | `POST repos/{repo}/issues/N/comments` `{body}` | `add_issue_comment` |
| Add labels | `gh issue edit N --add-label …` | `POST repos/{repo}/issues/N/labels` `{labels}` | `issue_write` (`update`, full label set) |
| Remove a label | `gh issue edit N --remove-label L` | `DELETE repos/{repo}/issues/N/labels/L` (404 means already absent) | `issue_write` (`update`, full label set) |
| List labels | `gh label list --json name` | `GET repos/{repo}/labels?per_page=100` | `get_label` per name |
| List PRs | `gh pr list --state open --json …` | `GET repos/{repo}/pulls?state=open&per_page=100` | `list_pull_requests` |
| View PR | `gh pr view N --json state,mergedAt,headRefOid,…` | `GET repos/{repo}/pulls/N` (`merged_at` set means MERGED; head sha is `head.sha`) | `pull_request_read` (`get`) |
| Create PR | `gh pr create --title … --body … --head … --base …` | `POST repos/{repo}/pulls` `{title, body, head, base}` | `create_pull_request` |
| Change PR base | `gh pr edit N --base B` | `PATCH repos/{repo}/pulls/N` `{base}` | `update_pull_request` (`base`) |
| PR checks | `gh pr checks N` | `GET repos/{repo}/commits/{sha}/check-runs` plus `GET repos/{repo}/commits/{sha}/status` | `pull_request_read` (`get_check_runs`, `get_status`) |
| Merge PR | `gh pr merge N --squash` | `PUT repos/{repo}/pulls/N/merge` `{merge_method: "squash", sha: "<head sha>"}` | `merge_pull_request` (`squash`, `expectedHeadSha`) |
| List workflow runs | `gh run list --branch B` | `GET repos/{repo}/actions/runs?branch=B` or `?head_sha=S` | `actions_list` |
| Failed run log | `gh run view R --log-failed` | `GET repos/{repo}/actions/runs/R/jobs`, then `GET repos/{repo}/actions/jobs/J/logs` per failed job | `get_job_logs` (`run_id`, `failed_only`) |
| Re-run failed jobs | `gh run rerun R --failed` | `POST repos/{repo}/actions/runs/R/rerun-failed-jobs` | `actions_run_trigger` (`rerun_failed_jobs`) |
| View release | `gh release view T` | `GET repos/{repo}/releases/tags/T` | `get_release_by_tag` |
| Create release | `gh release create T --notes …` | `POST repos/{repo}/releases` `{tag_name, name, body}` | none, use `rest` |

Always pass the head sha when merging over REST or MCP. The merge is then refused if the PR moved
since the merge gate read it, the same guard `gh pr merge --match-head-commit` gives.

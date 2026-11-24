---
type: analysis
summary: "Research for issue #1379: tea vs gt 2.0 capability table for every Gitea adapter call; verdict is to stay on tea now, because gt 2.0 is six days old and its JSON shape was documented from man pages only, with a gt-based failed-step-log method as the one worthwhile follow-up"
status: current
created: 2026-11-24
last_updated: 2026-11-24
review_trigger: "on gt minor release or forge adapter change"
related: [1379, 1292, 1240]
---

# Evaluating the Gitea `gt` 2.0 CLI for the forge adapter

## Question

The Gitea backend of the forge adapter shells out to `tea` (`scripts/lib/forge-adapter/tea-cli.ts:7`, the sole spawn site). Output differences in `tea` have already cost fixes (#1292, #1240). Does `gt` 2.0 cover the adapter's calls with stable JSON, remove the raw API fallbacks, and coexist with `tea`?

## Method and what was verified

Verified from code: every adapter call and how it runs today (`gitea.ts:line` at base commit `edceb58f`).

Verified from documentation only (fetched 2026-11-24): the `gt` release page https://gitea.com/gitea/cli/releases, the README https://gitea.com/gitea/cli, and the 2.0.0-1 man pages mirrored at https://man.archlinux.org/man/extra/gitea-cli/ (`gt-api`, `gt-pr-edit`, `gt-pr-checks`, `gt-run-list`, `gt-run-logs`, `gt-issue`, `gt-pr`, `gt-label`, `gt-auth`).

Not verified:
- `gt` is not installed on the workstation (`which gt` finds only `tea` 0.14.2). Nothing was run against a Gitea server; no JSON payload was seen. Every `gt` claim is documentation, not behaviour.
- The announcement post in the issue (x.com) returned HTTP 402 and was not read. Claims below do not rest on it; the release page is the primary source.
- The tea-to-gt migration guide linked from the README was not read.

## Capability table

`tea` column: how `gitea.ts` runs the call today. `gt` column: `covered (cmd, JSON: yes/no)`, `partial`, `not covered` or `UNVERIFIED`. "JSON: yes" means the docs state `--json <fields>` exists for the command family; no payload shape was checked.

| Adapter call | tea today | gt 2.0 |
|---|---|---|
| authStatus | `tea logins` text, non-empty means ok (`gitea.ts:229`) | partial: `gt auth status` exists; its output and JSON support are UNVERIFIED (gt-auth man page). Login store is separate from tea (see below) |
| issueList | `tea issues list --fields` with `--output json`, paged by `listTeaPages` (`gitea.ts:214,260`) | covered: `gt issue list`, JSON: yes (release notes v0.1.0, v2.0.0 require a field list) |
| issueCreate | REST `POST issues` via `tea api`, labels resolved to ids first (`gitea.ts:270-279`) | covered: `gt issue create`; label-by-name resolution UNVERIFIED |
| issueEdit | `tea issue edit --title --description` (`gitea.ts:292-296`) | covered: `gt issue edit` |
| issueComment | `tea issue comment --content` (`gitea.ts:300`) | covered: `gt issue comment` |
| prList | REST `pulls` pages, or `tea pulls list` (`gitea.ts:317,414`) | covered: `gt pr list`, JSON: yes |
| prView | REST `GET pulls/N`, because `tea pull view` lacks labels, mergeability and head sha (`gitea.ts:421`) | partial: `gt pr view` exists; whether its JSON carries those fields is UNVERIFIED (`gt schema` lists them) |
| prCreate | REST `POST pulls` (`gitea.ts:426`) | covered: `gt pr create` |
| prComment | `tea pull comment --content` (`gitea.ts:430`) | covered: `gt pr comment` |
| labelAdd | `tea <kind> edit --add-labels` (`gitea.ts:436`) | covered: `gt pr edit --add-label`; issue side via `gt issue edit` UNVERIFIED. Documented refusal for PR authors without write access |
| labelRemove | `tea <kind> edit --remove-labels` (`gitea.ts:442`) | covered: `gt pr edit --remove-label`, same caveats |
| prChecks | REST combined commit status of the head sha, paged (`gitea.ts:493`) | covered: `gt pr checks`, JSON fields created_at, description, id, name, sha, state, updated_at, url; exit 8 pending, 1 failed. Shape vs `ForgeCheck` not compared |
| prFiles | REST `pulls/N/files` (`gitea.ts:337`) | not covered: no `files` subcommand; `gt pr diff` may help, UNVERIFIED |
| prChangeBase | REST `PATCH` then read base back (`gitea.ts:125-126`) | covered: `gt pr edit --base`; the read-back would still be needed |
| getDependencies | REST `issues/N/dependencies` pages (`gitea.ts:381`) | not covered: `gt issue` has no dependency subcommand; only `gt api` |
| setDependencies | REST `POST/DELETE` dependencies, PR body PATCH (`gitea.ts:396-409`) | not covered, same; PR body via `gt pr edit --body` |
| claim | REST issue GET, `PATCH assignees`, `tea labels create`, label edits (`gitea.ts:458-476`) | partial: `gt label create`, `gt issue edit --add-assignee` exist; `--set-assignees` replaces the list. Atomic semantics UNVERIFIED |
| release | same ops as claim (`gitea.ts:451`) | partial, as claim |
| viewerLogin | REST `GET user` (`gitea.ts:458`) | covered via `gt api user`; v2.0.0 notes say a token without `read:user` works for most commands, which may not include this one (UNVERIFIED) |
| (new) failed-step logs | none; the adapter has no CI-log method (`prChecks` returns check rows only) | covered: `gt run logs <id> --failed [--tail N]` prints failed steps of failed or canceled jobs; `gt run list --json` has id, status, conclusion, commit, branch (man pages `gt-run-logs`, `gt-run-list`) |

Raw API fallbacks in play today: `runTeaApi` (`tea-cli.ts:41`) reads response headers from stderr and checks the status line because `tea api` exits 0 on HTTP 4xx/5xx.

## Answers

1. **Does gt cover the adapter's needs with stable JSON?** Mostly. 16 of 19 interface methods have a documented `gt` command. `prFiles`, `getDependencies` and `setDependencies` have none. JSON: every list and view command takes `--json <fields>`; v2.0.0 made the field list mandatory, `null` for absent values, RFC 3339 UTC timestamps, and `gt schema` lists fields. But v2.0.0 is a breaking release six days old (2026-11-18), flags and JSON changed from 1.x, so "stable" has no track record. Only the 1.x series promises semver.
2. **Does it remove raw API fallbacks?** No. Six rows still need `gt api`. `gt api` is better than `tea api` on paper (`--paginate --slurp` returns one JSON array, `-i` prints status and headers to stderr, so the pagination and status-line workarounds might go), but that is UNVERIFIED without running it, and the status-code behaviour on 4xx is not documented in what was read.
3. **Minimum server version and coexistence.** Gitea 28 or newer (README, release notes up to 1.1.0; 2.0.0 notes not read). `gt` does not read tea's configuration; both install side by side (v0.1.0 notes). Cost: a second login (`gt auth login`, system keyring or `GITEA_TOKEN` plus `GITEA_INSTANCE_URL`) on every workstation and CI runner, and the keyring service name changed in 2.0.0, so 1.x credentials are unreadable.

## Migration cost

Touch points: `tea-cli.ts` (spawn site, JSON and api helpers), `gitea.ts` (every call above), `forge-doctor.ts` (tea detection, message at line 32), `dependencies.ts`, and tests `tea-cli.test.ts`, `gitea.test.ts`, `forge-doctor.test.ts`. A full swap is several PRs, not one, and still leaves `gt api` for dependencies and files.

## Recommendation

**Stay on `tea`.**

Rationale: `gt` does not remove the raw API paths (three methods have no command), the 2.0.0 JSON contract is a week old and was read only from man pages, and a second credential store would be an operational cost for every campaign worker. The one place `gt` clearly adds capability is failed-step logs, which the adapter does not expose today at all, so that is a new feature rather than a replacement; it can be revisited after `gt` is installed and its output observed on a real run.

Counter-case, for the option not chosen ("adopt for logs only"): the logs call is documented, small, and isolated, so a bounded `failedStepLogs` method behind `gt` would add value with no migration of existing calls. It loses today only because it needs a new adapter method, a second login and a doctor check, all on an untested one-week-old major release; none of its behaviour was observed here.

## Follow-up slices (file only if the owner wants logs)

1. Install `gt` 2.0 on one workstation and run `gt run logs --failed`, `gt pr view --json` and `gt api --paginate --slurp` against a staging Gitea; record real payloads. About 1 hour, no PR.
2. If that holds: add `ForgeAdapter.failedStepLogs` backed by `gt run logs --failed --tail`, Gitea only, with a `forge-doctor` check for `gt`. About 1 PR.
3. Full migration only if `gt api` removes the header and status workarounds and gains dependency-edge support. Several PRs; reconsider after `gt` 2.1.

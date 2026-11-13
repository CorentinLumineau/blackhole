---
type: adr
summary: "The campaign dashboard is generated on every refresh from campaign state with no hand-kept file: the scope lives in config.json campaign_scope, the owner's decisions in owner-decisions.json (both written only by scripts/campaign-record.ts), the headline and the blockers in the checkpoint's ## Headline and ## Blocking the run sections with a generated fallback, workstreams in status_page.streams, and everything else (stage board, moves, links, config rows) is derived from the one StatusReport; the Data page reads nine datasets and a contract test ties it to the generator"
status: accepted
review_trigger: "on a new fact the status page must show, or on a change to who answers owner gates"
created: 2026-11-13
last_updated: 2026-11-13
related:
  - documentation/decisions/ADR-048-github-rest-forge-channel.md
  - documentation/decisions/ADR-049-branch-state-store.md
  - documentation/reference/product-principles.md
  - src/references/status-page.md
---

# ADR-052: Campaign dashboard state

## Status

Accepted, 2026-11-13 (owner-approved design on issue #1145, ruling R-006).

## Context

The owner approved a campaign dashboard and asked for it to be produced on every run. In the
pilot the page read nine datasets built by a throwaway script from `queue.json`, live forge calls
and a hand-kept JSON file holding the headline, the blockers, the scope, the decisions log and an
issue-to-workstream list. A hand-kept file goes stale the first turn nobody edits it, and a
resumed session cannot tell which of its lines still hold.

## Decision

Each fact has one home, chosen by who writes it and how often:

| Fact | Home | Why there |
|------|------|-----------|
| Scope | `config.json` → `campaign_scope.entries` | The launch configuration gate already writes `config.json` and is where the owner states the scope; a mid-run change is a reconfiguration of the same thing. Structured (`kind`, `text`, `set_at`, `reason`, `refs`, `filter`) so the board can place a parked issue without parsing prose |
| Decisions | `owner-decisions.json` | An append-only log is not configuration. A separate file keeps `config.json` small and lets the record script append without rewriting the config |
| Headline, blockers | checkpoint `## Headline`, `## Blocking the run` | They describe this turn and are rewritten every checkpoint, exactly like `## Notes`. Free text by nature, so a section; a generated fallback covers a checkpoint that has none |
| Workstreams | `status_page.streams` (labels, milestone or epic parent, plus overrides) | A rule instead of a list, so a new issue lands in a stream without anyone editing state. Absent ⇒ one stream |
| Board stage, moves, links, config rows | derived in `scripts/lib/campaign-status/` | Already in the queue, the forge and `config.json`; recording them would create a second source |

Scope and decisions are written only by `scripts/campaign-record.ts` (atomic, validated,
idempotent), never by hand-edited JSON. Every renderer (`--json`, `--data`, `--html`, the text
dashboard) reads one `StatusReport`. The board reads the review label, CI and mergeability of at
most 15 open PRs over GitHub REST; offline it says "not checked" instead of guessing.

## Alternatives

- **Everything in the checkpoint.** One file, but the checkpoint exists only while work is in
  flight and is rewritten each turn, so a decisions log or a scope set at launch would be lost or
  copied forward by hand every turn.
- **A single `campaign-record.json` for scope and decisions.** Fewer files, but it splits the
  scope from the configuration gate that sets it, against the issue's acceptance criterion that
  `config.json` or the checkpoint holds the scope.
- **A hand-list of issues per workstream.** What the pilot did; it is the file this ADR removes.

## Consequences

- An existing campaign keeps working: absent records render as "Scope not recorded", no
  decisions, and a generated headline and blocker list.
- A dashboard published with the previous template is rewritten on its next refresh: missing
  dataset documents are created, the old ones deleted with the page rewrite, and hand edits to
  the stored page are carried over (`status-page.md` § Refresh procedure).
- A refresh online costs three REST reads per open PR, capped at 15 PRs.

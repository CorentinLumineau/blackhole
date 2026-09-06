---
type: research
summary: "Claude Code hooks docs confirm no cross-hook denial signal exists (PermissionDenied is auto-mode-classifier-only); issue #919's clean-pattern_id/confident-attribution ACs are not reliably deliverable as written — a Stop-time transcript heuristic is the only buildable path, with real false-positive/negative risk"
status: current
created: 2026-09-06
last_updated: 2026-09-06
review_trigger: "on file change"
issue: 919
confidence: 82
computed_at_revision: 1
---

# Research: does Claude Code expose a mechanism for one hook to learn a sibling hook denied a call?

## Executive Summary

**Verdict: (b) — no structured mechanism exists.** The only buildable path is the
Stop/SubagentStop transcript-scan heuristic `router-919` already identified from repo evidence.
Documentation read 2026-09-06 at `https://code.claude.com/docs/en/hooks` (redirect target of
`https://docs.claude.com/en/docs/claude-code/hooks`), cross-checked against
`anthropics/claude-code` issue #41261 (a documentation-gap report that quotes the official
changelog verbatim) and several third-party hook-reference aggregators for corroboration only,
never as a primary citation.

Two facts drive the verdict:

1. `PostToolUse` fires only after a tool call **succeeds** ("the tool already ran"); a denied
   call never executes, so `PostToolUse` never fires for it — and its absence is structurally
   indistinguishable from a worker simply never attempting the tool. `router-919`'s reasoning on
   this point is confirmed, not merely uncontradicted.
2. The one event that looks, at first glance, like a cross-hook denial signal —
   `PermissionDenied` — is scoped **exclusively** to Claude Code's own built-in auto-mode
   permission classifier, not to a deny issued by any PreToolUse hook (blackhole's own or a
   co-installed plugin's). This is the decisive finding this research adds beyond `router-919`'s
   repo-only pass, and it closes off the most promising-looking indirect path.

Given this, **issue #919's AC 2 (a clean `pattern_id`) and AC 3 (confident source attribution at
the same rigor as blackhole's own denials) are not reliably deliverable as written.** The
heuristic path that remains has concrete, uncloseable false-positive and false-negative sources
(§ below) that a "clean" / "confident" bar cannot absorb. Re-scoping is recommended over planning
against the AC as stated.

## Findings

### 1. Shared per-call identifier — exists, but does not solve the problem

`tool_use_id` is a genuine, documented correlation id present on `PreToolUse` and other tool
events:

> ```json
> {
>   "session_id": "abc123",
>   ...
>   "hook_event_name": "PreToolUse",
>   "tool_name": "Bash",
>   "tool_input": { ... },
>   "tool_use_id": "toolu_01ABC123..."
> }
> ```
> — https://code.claude.com/docs/en/hooks, PreToolUse example payload

This does let a *later* consumer (a transcript scan) correlate a specific tool-call entry back to
its own `tool_use_id` if that id also appears in the transcript's tool_use/tool_result blocks.
But it does **not** solve cross-hook correlation at decision time: "All matching hooks run in
parallel" (verbatim, `hooks.md` § Hook handler fields) — each hook receives the same payload
independently and produces its own decision with no visibility into what a sibling hook, running
at the same instant, decided. `tool_use_id` is the anchor a downstream heuristic would need; it
is not itself the missing aggregation channel.

### 2. Aggregated-decision indicator — none exposed to hooks; a merge happens, but only inside the harness

Multiple third-party hook guides (not independently confirmed against the primary doc's own text
during this session's fetches — see caveat below) describe a documented precedence rule:

> "Claude Code hooks use a strict decision precedence on the same event: deny > defer > ask >
> allow... the most restrictive answer applies" — paraphrased across `claudefa.st`,
> `pushary.com`, and `hidekazu-konishi.com` hook guides (WebSearch, 2026-09-06); a direct
> verbatim quote of this sentence could not be retrieved from `code.claude.com/docs/en/hooks`
> in this session's fetches (the page's exact "Decision control" prose on multi-hook conflicts
> did not surface in three separate targeted re-fetches — see caveat below).

The implication, if the third-party paraphrase is accurate: the *harness* does merge multiple
hooks' decisions into one final permission decision before the tool call proceeds or is blocked
("every one runs to completion before results merge" — same sources). That merge is real, but it
is a harness-internal computation exposed only as the single final PreToolUse-level effect
(tool blocked or not) — no event, field, or `hookSpecificOutput` shape documented anywhere in
this session's research exposes *which* hook among several matching ones produced the deny, or
how many hooks ran, to any hook (sibling or downstream). There is no aggregated-decision
indicator a hook — blackhole's own or otherwise — can read.

**Caveat on this finding's sourcing**: three separate direct re-fetches of
`https://code.claude.com/docs/en/hooks`, each asking verbatim for the multi-hook-conflict
sentence, returned "no such sentence found in the retrieved content" (the fetch tool routes
through a summarizing sub-model against a possibly-truncated view of a long page — the tool
itself reported `[Content truncated due to length...]` on at least one fetch). This finding is
therefore held at **medium confidence on the precedence rule's exact wording**, high confidence
on the conclusion that matters for #919 (no hook-to-hook visibility), since every source —
primary and third-party alike — agrees hooks run in parallel with no cross-visibility, and none
of the dozen-plus fetches/searches in this session surfaced any field carrying aggregation
detail.

### 3. `PermissionDenied` — real, but scoped away from the problem (decisive finding)

`PermissionDenied` is a real, currently-shipped hook event, absent from blackhole's own
`hook-schemas.md` and confirmed to postdate this repo's schema — see § 5. It is **not** a general
"a tool call was denied" signal. `anthropics/claude-code` issue #41261 (a documentation-gap
report, itself evidence the feature is real and under-documented, filed against
`https://code.claude.com/docs/en/hooks`) quotes Claude Code's own changelog verbatim:

> "Changelog v2.1.88 added: Added `PermissionDenied` hook that fires after auto mode classifier
> denials — return `{retry: true}` to tell the model it can retry"
> — quoted verbatim inside `anthropics/claude-code#41261`, body text, retrieved 2026-09-06

The word "classifier" is load-bearing. Claude Code's **auto permission mode** has its own
built-in classifier that can deny a tool call *without any hook running at all* — that is what
`PermissionDenied` observes. A deny produced by a **PreToolUse hook** (blackhole's own
`validate-bash-command`/`validate-file-changes`, or a co-installed plugin's equivalent) is a
different code path entirely and does not fire `PermissionDenied`. This directly refutes the one
plausible-looking indirect signal #919 could have used: a co-installed plugin's PreToolUse deny
does not surface through `PermissionDenied`, so subscribing to that event would not see the
denials #919 cares about.

(Direct re-fetch of `code.claude.com/docs/en/hooks` asking for a literal `### PermissionDenied`
heading returned "NO SUCH HEADING EXISTS" — consistent with issue #41261's own complaint that the
event is present in the exit-code table and matcher-support text but has no dedicated reference
section. The event's existence and scope are corroborated by three independent sources — the
exit-code-table row, the GitHub docs-gap issue quoting the changelog, and a third-party
hooks-events-reference aggregator — so its existence and scope-to-classifier-only are held at
high confidence despite the primary doc's own thin dedicated coverage.)

### 4. Stop / SubagentStop payload contents

Both example payloads were retrieved directly from the primary doc:

> ```json
> {
>   "session_id": "abc123",
>   "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
>   "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
>   "cwd": "/home/user/my-project",
>   "permission_mode": "default",
>   "effort": { "level": "medium" },
>   "hook_event_name": "Stop",
>   "stop_reason": "end_turn",
>   "last_assistant_message": "Here's what I found:\n\n...",
>   "stop_hook_active": true
> }
> ```
> — https://code.claude.com/docs/en/hooks, Stop example payload

> ```json
> {
>   ...
>   "hook_event_name": "SubagentStop",
>   "agent_id": "subagent_xyz",
>   "agent_type": "security-reviewer",
>   "stop_reason": "end_turn",
>   "last_assistant_message": "Security review complete:\n\n...",
>   "stop_hook_active": true
> }
> ```
> — https://code.claude.com/docs/en/hooks, SubagentStop example payload

Two points directly answer the spawn context's question:

- **`agent_transcript_path` is not a Claude Code field.** This repo's own
  `src/references/hook-schemas.md` § "SubagentStop hook (Cursor)" documents "the tail of
  `agent_transcript_path` when readable" as extraction tier 3 — but that section is explicitly
  scoped to **Cursor's** SubagentStop hook payload (a different harness blackhole also supports;
  see `documentation/architecture/` build-target notes), not Claude Code's. Claude Code's own
  field, confirmed above, is `transcript_path` — present in both example payloads shown by the
  primary doc. Any design built against "does `agent_transcript_path` exist on Claude Code" is
  asking about a field that belongs to a different harness's schema; the correct field to check
  guarantees for is `transcript_path`.
- **`transcript_path`'s presence is documented, its currency is not guaranteed.** The common
  input fields table states:

  > "`transcript_path` — Path to conversation JSON. The transcript file is written
  > asynchronously and may lag the in-memory conversation, so it may not yet include the current
  > turn's most recent messages when a hook fires. Hooks that need the final assistant text of
  > the current turn should use `last_assistant_message` on Stop and SubagentStop instead of
  > reading the transcript"
  > — https://code.claude.com/docs/en/hooks § Common input fields

  The field itself is listed unconditionally (no "not all events receive this" caveat, unlike
  `permission_mode`), and both example payloads carry it — so its **presence** is reliable. Its
  **content**, at the moment Stop/SubagentStop fires, may lag the real turn — a denied tool call
  that happened moments before Stop fires could plausibly not yet be flushed to the transcript
  file on disk. This is a genuine, admitted-by-the-docs race window for any Stop-time scan
  design, not a hypothetical concern.
- `last_assistant_message` carries only the agent's own final text response — it does not carry
  tool-call or denial detail, so it cannot substitute for a transcript scan; it is irrelevant to
  #919's detection problem beyond confirming what it is *not* useful for.

### 5. Recency / drift from this repo's own schema

Documentation retrieved 2026-09-06 from `https://code.claude.com/docs/en/hooks` (the current
canonical URL — `docs.claude.com/en/docs/claude-code/hooks` 301-redirects here, confirming this
repo's own `worker-schemas.md`/`hook-schemas.md` citations of the old `docs.claude.com` path are
stale in form, if not necessarily in content). Fields/events observed in the primary doc but
**absent from this repo's `src/references/hook-schemas.md`**:

- `PermissionDenied` (§3) — not mentioned anywhere in this repo's hook documentation.
- `PermissionRequest`, `PostToolUseFailure`, `PostToolBatch`, and ~25 other lifecycle events
  (`SubagentStart`, `TaskCreated`, `PreModelSwitch`, etc.) from the full event table — this repo
  documents only the two PreToolUse validators and the SubagentStop/Stop resume mechanics; it
  makes no claim to exhaustiveness and none of the unlisted events change this research's
  verdict, but they are noted here per the spawn context's instruction to flag doc/schema drift.
- `agent_id` / `agent_type` on `SubagentStop` — this repo's own `hook-schemas.md` § PreToolUse
  hook events table documents these two fields on the **PreToolUse** payload (added per issue
  #907, "present... only when the hook fires from within a subagent"). The primary Claude Code
  doc's `SubagentStop` *example* payload also carries `agent_id`/`agent_type` — consistent, not
  contradictory, but this research did not attempt to fetch the primary doc's PreToolUse-specific
  treatment of these two fields to confirm parity; treat as corroborating, not exhaustively
  cross-checked.
- `effort` (object with `level`) — present in the primary doc's common-fields table and both
  Stop/SubagentStop examples; not mentioned anywhere in this repo's own hook schemas. Not
  relevant to #919's question, noted only for drift-completeness.

No field or event found in this session's research reverses or narrows §§1-3's conclusion.

## Sources

- https://code.claude.com/docs/en/hooks — primary source, Claude Code hooks reference, fetched
  2026-09-06 (redirect target of `https://docs.claude.com/en/docs/claude-code/hooks`). Fetched
  in eight separate targeted passes this session (common fields table, PreToolUse/PostToolUse
  examples, Stop/SubagentStop examples, full event table, exit-code table, PermissionDenied
  heading probe, multi-hook-conflict probe, decision-control probe) because the underlying page
  is long enough that the fetch tool's summarizing pass truncates a single request
  (`[Content truncated due to length...]` reported on at least one fetch).
- https://github.com/anthropics/claude-code/issues/41261 — "[DOCS] Hooks reference missing
  `PermissionDenied` event and retry contract", fetched 2026-09-06. A documentation-gap report
  that quotes Anthropic's own "Changelog v2.1.88" text verbatim; used as the decisive citation
  for §3's scope-to-classifier-only finding, since the primary doc page itself has no dedicated
  `PermissionDenied` section to quote directly.
- WebSearch aggregating https://claudefa.st/blog/tools/hooks/hooks-guide,
  https://pushary.com/blog/claude-code-hooks-explained,
  https://hidekazu-konishi.com/entry/claude_code_hooks_complete_guide.html,
  https://cc.bruniaux.com/guide/hooks-events-reference/ — third-party hook-reference
  aggregators, used only for corroboration of the "deny wins" precedence claim (§2) and the
  PostToolUse-does-not-fire-on-deny claim (confirms `router-919`'s reasoning); never used as the
  sole citation for any claim in this note.
- `git show origin/main:src/references/hook-schemas.md` (repo ref `dba54799`) — this repo's own
  hook documentation, read for the §5 drift comparison and to confirm `agent_transcript_path` is
  this repo's Cursor-specific term, not a Claude Code field.
- `git show origin/main:documentation/investigations/hook-event-fail-open-visibility.md` — prior
  investigation (#893) into this repo's own `.blackhole/hook-events/` fail-open path; read for
  context on how blackhole's own PreToolUse validators already record decisions, establishing
  the baseline #919 is asking to extend to foreign hooks.

## Uncertainty

- §2's exact precedence wording ("deny > defer > ask > allow") is corroborated by multiple
  independent third-party sources but could not be retrieved verbatim from the primary doc in
  this session's fetches, despite three targeted attempts. The conclusion that matters for #919
  (no cross-hook visibility) does not depend on the exact wording and is independently confirmed
  by the "hooks run in parallel" primary-source quote plus the absence of any aggregation field
  anywhere in this session's research.
- This research could not determine, from documentation alone, whether a future Claude Code
  version might add a documented aggregation/observability event — issue #41261 itself shows
  Anthropic actively iterating on hook event coverage (PermissionDenied is itself a fairly recent
  addition per its v2.1.88 changelog citation) without a corresponding docs update. This is a
  documentation-currency risk for any downstream design, not a finding that changes today's
  verdict.

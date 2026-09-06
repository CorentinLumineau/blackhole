---
issue: #919
supersedes_adr: null
type: plan
summary: "Implementation plan for issue #919 (Quick track, docs-only): scope the V-HOOK-01/02/03 visibility guarantee in hook-schemas.md to blackhole's own validators (pointing at #912 for the foreign-source config-time ceiling), document the shipped-but-undocumented PermissionDenied Claude Code hook event with its precise firing condition, and mark SubagentStop extraction tier 3 (agent_transcript_path) best-effort per an unverified Cursor reliability report"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
related: [documentation/investigations/research-cross-plugin-hook-denial-visibility.md]
---

# Plan - Issue #919

## Objective

Issue #919 was withdrawn and re-scoped by owner ruling (see issue comments, not the original
body — ACs 2 and 3, the runtime denial-detection heuristic, are withdrawn as not-achievable per
`research-919`, verdict (b)). The surviving scope is three one-line prose corrections, all in
`src/references/hook-schemas.md`, that stop the doc from promising a visibility guarantee the
Claude Code hooks contract cannot deliver, and that record two pieces of confirmed-true
information a reader would otherwise re-derive the hard way (as #926 already did once):

1. Scope the `V-HOOK-01/02/03` visibility guarantee (line 190, "Orchestrator consumption"
   paragraph) to refusals from blackhole's own validators, and point at #912 for what is
   actually observable about a foreign PreToolUse source.
2. Document the shipped-but-undocumented `PermissionDenied` Claude Code hook event, with its
   precise firing condition, so nobody re-infers it as a cross-hook denial signal (it is not
   one).
3. Mark SubagentStop extraction tier 3 (`agent_transcript_path`, line 11) best-effort, citing an
   unverified Cursor community report of the field arriving null for background subagents.
   `agent_transcript_path` itself is correct as written (#926 closed invalid) — this adds a
   caveat, it does not fix an error.

No heuristic, detector, or new hook is built. `V-PLUGIN-01` is inert — the diff never touches
`templates/hooks/**`.

## Touch-Paths

- `src/references/hook-schemas.md` plus all generated dist trees per `scripts/lib/build/targets.ts`

(Confirmed 9 dist copies + `src/` = 10 total paths carrying this file today: `references/`,
`skills/blackhole/references/`, `.claude/skills/blackhole/references/`,
`.cursor/skills/blackhole/references/`, `codex-skills/blackhole/references/`,
`.agents/build/skills/blackhole/references/`, `plugins/blackhole/skills/blackhole/references/`,
`plugins/blackhole-claude/skills/blackhole/references/`,
`plugins/blackhole-agent-plugins/skills/blackhole/references/`. Do not hand-edit any of the 9 —
edit `src/` and run `bun run build`.)

## Documentation Impact

`documentation/investigations/research-cross-plugin-hook-denial-visibility.md` is cited by name
in two of the three edits below (change 1 and change 2) as the evidence source for the
visibility-boundary claims. That file is not modified by this plan — it is `research-919`'s own
staged deliverable (already present at `.blackhole/staged/919/`, carried by this issue's own PR
per ADR-021 D2) and this plan only points at its eventual `documentation/investigations/` path.
No other consumer doc references the edited paragraphs by name; `worker-schemas.md` (the file
`hook-schemas.md` was split from, issue #473) does not reference the PreToolUse hook-events
section or the SubagentStop extraction-order sentence, so it needs no companion update.

## Task Steps

- [ ] **T1 — Scope the V-HOOK visibility guarantee.** In `src/references/hook-schemas.md`, in
  the `## PreToolUse hook events` section's `**Orchestrator consumption:**` paragraph (line 190
  on `origin/main` @ `514c19b5`), replace:

  > Written from outside the agent process, a refusal the worker never mentions in its own
  > return JSON is still on the record — that defeats an uncooperative worker's *silence*, not
  > its filesystem access: a worker with Bash access to the main clone could still delete or
  > overwrite its own event file before ingestion runs. Globbing before validating the return
  > JSON narrows that window; it does not close it.

  with:

  > Written from outside the agent process, a refusal from one of blackhole's own validators —
  > anything that writes through `hook-event-log.js` — is still on the record even when the
  > worker never mentions it in its own return JSON: that defeats an uncooperative worker's
  > *silence*, not its filesystem access: a worker with Bash access to the main clone could still
  > delete or overwrite its own event file before ingestion runs. Globbing before validating the
  > return JSON narrows that window; it does not close it. This guarantee does not extend to a
  > foreign, co-installed PreToolUse hook's own deny: nothing in the documented Claude Code hooks
  > contract lets one hook observe a sibling's decision — hooks run in parallel with no
  > aggregated-decision indicator exposed
  > (`documentation/investigations/research-cross-plugin-hook-denial-visibility.md`) — so a
  > foreign source's deny leaves no record here at all. #912 raises the ceiling at config time
  > only: it enumerates every registered PreToolUse source and flags when a foreign one is
  > present, since any registered hook participates in the harness's deny-wins merge. That is the
  > honest boundary — visibility that a foreign source *could* veto a call, never confirmation
  > that it *did*.

  — **AC**: `grep -c "a refusal the worker never mentions" src/references/hook-schemas.md`
  returns `0` (old unqualified phrasing gone); `grep -c "writes through .hook-event-log.js." src/references/hook-schemas.md`
  and `grep -c "#912" src/references/hook-schemas.md` (scoped to the edited paragraph, not the
  file's other `#912`-free content) both return `1`.

- [ ] **T2 — Document the `PermissionDenied` hook event.** Append a new top-level section at the
  end of `src/references/hook-schemas.md` (after the existing final paragraph, which ends the
  `## PreToolUse hook events` section) — placement rationale below:

  > ## PermissionDenied hook (Claude Code, not installed)
  >
  > A real, currently-shipped Claude Code hook event — confirmed via
  > `anthropics/claude-code#41261`, which quotes the shipped changelog verbatim. Blackhole does
  > not register or consume it: no `hooks.json` entry, no ledger wiring. Documented here only
  > because its firing condition is easy to over-infer as a cross-hook denial signal, and it is
  > not one: it fires **only** after Claude Code's own auto-mode permission classifier denies a
  > call. It **never** fires after a PreToolUse hook's own deny decision — not blackhole's own
  > validators (§ PreToolUse hook events, `hook-event-log.js`, above), and not a foreign,
  > co-installed plugin's. It was evaluated as the one plausible indirect channel for cross-hook
  > denial visibility and ruled out on exactly this ground
  > (`documentation/investigations/research-cross-plugin-hook-denial-visibility.md`) — it fires
  > from a different decision path than the PreToolUse contract these hooks share, not as an
  > escalation from it.

  **Placement decision (judgment call, per spawn instruction):** the router found no enumerated
  "event list" to append a row to — `hook-schemas.md` has no such table; it is organized as one
  top-level `##` section per hook family (`## SubagentStop hook (Cursor)`,
  `## SubagentStop resume hook (Cursor, #154)`, `## PreToolUse hook events (...)`). A reader
  looking for "what hook events exist" scans those top-level headings, not a nested
  sub-bullet — so `PermissionDenied` gets its own top-level `##` section, matching that
  convention, rather than being folded into an existing hook family's prose (it is not a
  PreToolUse hook, so nesting it under `## PreToolUse hook events` would misrepresent its
  mechanism). It lands last (end of file) because it is the narrowest-scoped addition — a single
  paragraph about an event blackhole documents but never consumes — and because it directly
  continues the deny-visibility boundary T1 just drew, which a reader is most likely to still
  have in mind at that point in the file.

  — **AC**: `grep -c "PermissionDenied" src/references/hook-schemas.md` returns `0` before this
  edit (confirmed by owner in the issue comment) and `>= 1` after; `grep -c "auto-mode permission classifier"`
  and `grep -c "anthropics/claude-code#41261"` in `src/references/hook-schemas.md` both return
  `0` before and `1` after.

- [ ] **T3 — Mark extraction tier 3 best-effort.** In `src/references/hook-schemas.md`, under
  `## SubagentStop hook (Cursor)` (line 11 on `origin/main` @ `514c19b5`), replace:

  > **Extraction order:** Worker JSON is parsed from (1) a fenced ` ```json ` block in `summary`,
  > (2) the last brace-balanced `{...}` object in `summary`, or (3) the tail of
  > `agent_transcript_path` when readable.

  with:

  > **Extraction order:** Worker JSON is parsed from (1) a fenced ` ```json ` block in `summary`,
  > (2) the last brace-balanced `{...}` object in `summary`, or (3) the tail of
  > `agent_transcript_path` when readable — tier 3 is best-effort only: an unverified Cursor
  > community bug report records `agent_transcript_path` arriving null for background subagents,
  > so this tier can silently yield nothing even when correctly named and read.

  `agent_transcript_path` is **not** renamed and no other tier changes — #926 closed invalid
  because that field name and its placement under the Cursor header are both already correct;
  this is a reliability caveat, not a correction. "Unverified" is load-bearing wording: neither
  the router nor this plan independently confirmed the Cursor bug report — it is carried on
  report from #926's investigation, and the doc must let a future reader tell the difference
  between a verified spec fact and a reported reliability limitation.

  — **AC**: `grep -c "best-effort only" src/references/hook-schemas.md` returns `0` before, `1`
  after; `grep -c "agent_transcript_path" src/references/hook-schemas.md` returns the **same**
  count before and after (the field name itself is untouched — only a trailing caveat is added).

- [ ] **T4 — Regenerate and verify build consistency.** Run `bun run build`. — **AC**: `git status
  --porcelain` shows exactly the 10 paths listed under Touch-Paths as modified (no others);
  `grep -rc "PermissionDenied" <each of the 10 paths>` returns the same non-zero count in all 10;
  `grep -rc "writes through .hook-event-log.js." <each of the 10 paths>` likewise returns the
  same non-zero count in all 10 (confirms T1/T2/T3 propagated identically to every compiled
  copy, not just `src/`).

## Sprint Contract

Every task above carries its own machine-verifiable AC (grep-count before/after pairs for T1-T3,
a cross-tree consistency grep for T4). There is no task in this plan relying on the blanket "all
tests and linters pass" definition of done — this is a prose-only change with no test suite
coverage of its own; `bun run scripts/verify.ts`'s content-gate and doc-governance checks are the
applicable automated gates (see Verification below), run in addition to, not instead of, the
per-task grep ACs.

## Verification (Red-Before-Green)

Each of the three prose edits is demonstrated, not asserted, by a grep pair run against the
**pre-edit** file (`git show origin/main:src/references/hook-schemas.md`) and the **post-edit**
file, both quoted in the implementation's completion evidence:

| Change | Grep (pre-edit expected) | Grep (post-edit expected) |
|---|---|---|
| T1 (guarantee scoping) | `grep -c "a refusal the worker never mentions"` → `1` | same grep → `0`; `grep -c "#912"` (within the edited paragraph) → `1` |
| T2 (`PermissionDenied`) | `grep -c "PermissionDenied"` → `0` (owner-confirmed in issue comment) | same grep → `≥1`; `grep -c "auto-mode permission classifier"` → `1` |
| T3 (tier-3 caveat) | `grep -c "best-effort only"` → `0` | same grep → `1`; `grep -c "agent_transcript_path"` unchanged count before/after |

An edit with no demonstrable before/after grep is indistinguishable from a no-op — this table is
the evidence artifact, not a formality.

## Pareto Gating

- **Gain**: 6/10 — corrects a shipped false guarantee (foreign-hook denial visibility) and heads
  off a second wrong-assumption incident like #926's (which cost a full investigation round to
  correct); low but real ongoing cost if left unqualified.
- **Effort**: 2/10 — three one-line prose edits plus a build regen; no code, no tests, no schema
  change.
- **Priority** = 6 × (11 − 2) = **54** ≥ 30 — passes the filing/planning gate.

## V-code Compliance

- `V-INT-02`: N/A — no utility being reimplemented; this is prose only.
- `V-KISS-01`: Satisfied — no new mechanism, abstraction, or heuristic is introduced (the
  withdrawn heuristic per owner ruling stays withdrawn).
- `V-YAGNI-01`: Satisfied — no speculative feature; the plan documents an existing, shipped
  Claude Code event and narrows an existing claim, nothing more.
- `V-PLUGIN-01`: Inert — Touch-Paths never reach `templates/hooks/**`.
- `V-DOC-GOV-01..04`: search-before-write done (no existing doc covers these three corrections);
  canonical naming N/A (existing file, no rename); lifecycle frontmatter N/A (`hook-schemas.md`
  is a `src/` build source, not a `documentation/` lifecycle doc); no supersession (additive
  edits, no content replacement).

## Task Breakdown

Not applicable under this heading — Quick Track uses `## Task Steps` above, per `planner.md`'s
Quick Track section list. The plan-quality-gate CLI's `ac_mapping` check (which reads
`## Task Breakdown`) is therefore vacuously `true` on this plan by the documented
section-presence-gating design (`planner.md` Step 8, "Section-presence gating, not
track-gating") — every task's AC above is still machine-verifiable, stated inline.

# Clarify Gates — when to AskQuestion (all issue sizes)

User is **always** the source of truth for direction. Sync is automatic;
**clarification is not** — use `AskQuestion` when in doubt.

> [confidence-gates.md](confidence-gates.md) is the escalation mechanism (ADR-014: autonomy
> is always active, no master switch) — the categorical triggers below are preserved and feed
> the Problem/Technical dimension inputs of the confidence kernel (ADR-010 D6). This file is
> the dimension-input source for that kernel, not a standalone fallback gate.

## Default: clarify before commit

Before promoting an issue from **handle → plan** or **plan → implement**:

| Signal | Action |
|--------|--------|
| Missing acceptance criteria | AskQuestion — block until clear |
| Product / UX / data model choice | AskQuestion |
| Multiple valid technical approaches with trade-offs | AskQuestion |
| Destructive or irreversible (migration DROP, data delete) | AskQuestion — explicit approval |
| Issue body vague or contradictory | AskQuestion |
| Touch paths unclear | AskQuestion or explore worker, then confirm |
| User chat feedback ambiguous | AskQuestion before filing issue or implementing |

**Size label does not waive clarification.** `size:xs` with clear AC may
proceed after handle; `size:xs` with ambiguity still blocks on `status: blocked`,
`notes: awaiting-user-clarification`.

## AskQuestion payload contract

Every blocked clarification question must be **self-contained**: answerable by a
human who has **no session scrollback** — only the question text, the issue body,
and queue state. Blackhole's async HITL seam (`status: blocked` +
`notes: awaiting-user-clarification`) has no implicit context to fall back on;
the question itself must carry everything needed to decide.

Each `AskQuestion` payload must include all three elements:

| Element | Requirement |
|---------|-------------|
| **Decision** | The specific choice or approval being requested — lead with this. |
| **Evidence** | The finding that triggered the gate, with `file:line` citations or issue refs where applicable. |
| **Options** | Concrete alternatives with one-line trade-offs each (not bare signal-table labels like "Touch paths unclear"). |

**Efficient-output subset** (folded here — no standalone rule file):

- Lead with the decision being asked.
- Be precise about counts and scope (e.g. "3 children", not "several").
- Cap open-ended lists at 5 items; append an explicit "+N more" — never truncate silently.
- No preamble or closers ("Hope this helps", "Let me know").

Worked example: [epic-orchestration.md](epic-orchestration.md) §3 PO gate — the epic
split approval template demonstrates all three payload elements.

## Auto-proceed (narrow exception only)

Orchestrator may skip AskQuestion **only** when ALL true:

1. Acceptance criteria are testable and complete in the issue body
2. No product/UX/data ambiguity after reading issue + code touchpoints
3. Single obvious approach; no design docs or schema impact
4. One reviewable PR scope (see issue-splitting.md)
5. No open ledger BLOCK findings for this issue

Document in queue `notes: "clarify waived — narrow technical"` if proceeding.

## Queue status when waiting on user

```json
{
  "status": "blocked",
  "notes": "awaiting-user-clarification | awaiting-po-sign-off | awaiting-plan-approval"
}
```

Do **not** spawn implement workers while `blocked` for user gates.

## Chat feedback intake

User messages in coordinator/orchestrator chat:

1. If ambiguous → AskQuestion
2. If new work → file `gh issue create` with `$(bun scripts/forge-scope.ts create-args)` (structured body) → auto-sync ingests
3. If queue reorder → update `user_queue_order` after user confirms
4. If correction to in-flight issue → resume implement worker with scope update
5. If a durable owner statement (chat message, issue comment, or clarify-gate answer) reads as a
   ruling rather than a one-off task → append a `## Ruling:` section to
   `documentation/reference/product-principles.md` in the same turn — quote (`Verbatim`) first,
   paraphrase (`Interpretation`) second, `Status: active`, assigned the next sequential `R-NNN`
   id, and increment the file's frontmatter `rulings_revision` by 1 in the same edit. #422 owns
   automatic task-vs-ruling classification and the retro-audit conflict sweep (its Option C
   watermark reads `rulings_revision` as its staleness signal) — this bullet is the minimal
   manual append contract, not that classifier.

Never silently reinterpret user intent.

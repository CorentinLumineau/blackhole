# Clarify Gates — when to AskQuestion (all issue sizes)

User is **always** the source of truth for direction. Sync is automatic;
**clarification is not** — use `AskQuestion` when in doubt.

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

## Auto-proceed (narrow exception only)

Orchestrator may skip AskQuestion **only** when ALL true:

1. Acceptance criteria are testable and complete in the issue body
2. No product/UX/data ambiguity after reading issue + code touchpoints
3. Single obvious approach; no DESIGN.md or schema impact
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
2. If new work → file `gh issue create` (structured body) → auto-sync ingests
3. If queue reorder → update `user_queue_order` after user confirms
4. If correction to in-flight issue → resume implement worker with scope update

Never silently reinterpret user intent.

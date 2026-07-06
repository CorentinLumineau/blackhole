# Epic Orchestration Runbook

Applies when `phase-handle.md` flags an issue as `size:l`, `size:xl`, or
epic-shaped. The orchestrator follows this runbook instead of going directly
to `phase-plan.md`.

See also: `issue-splitting.md` (split triggers and child template).

---

## 1. Detect epic

An issue is epic-shaped when **any** of these hold:

- Labelled `size:l`, `size:xl`, or `epic`
- Body describes multiple separate concerns that cannot ship as one PR
- Plan estimate > ~1 day or > ~400 LOC across unrelated domains
- Orchestrator judgment: "this is too big for one comfortable review"

---

## 2. Split into children

Use `issue-splitting.md` split triggers to decompose the epic into child issues.

```
gh issue create --title "Child: <concern>" \
  --body "Part of #<parent>
## Acceptance criteria
- [ ] ...
## Scope
In: ...  Out: ...
## Dependencies
Blocked by #N (if any)
## Touch hints
- path/glob" \
  --label "size:s" \
  $(bun scripts/forge-scope.ts create-args)
```

- Target `size:s` or `size:m` per child. If a child is still too large, split again.
- Update `queue.json`: each child gets `epic_parent: <parent_number>` and `depends_on` as needed.
- After queue update, write-back each child's non-empty `depends_on` to its issue body ([forge-sync.md](forge-sync.md) §6.5).
- Parent issue: set `status: blocked`, `phase: handle`.

---

## 3. PO gate (design sign-off)

Set parent `notes: awaiting-plan-approval` and surface to coordinator:

```
AskQuestion: "Epic #<N> split into children #A, #B, #C.
Please review the split plan and confirm (or request changes) before I begin implementation."
```

Do **not** spawn any `bc-planner` or `bc-implementer` workers for children
until the user explicitly approves the split.

---

## 4. Wave scheduling

Once the PO approves, schedule children via topological wave sort (`queue-dag.md`):

1. Compute execution waves from `depends_on` links.
2. Log `WAVE <N>` before spawning each batch.
3. Parallelise non-overlapping children (2–4 per batch max).
4. Children with `depends_on` wait for their dependency PR to merge before entering `plan`.

---

## 5. Implement children (normal pipeline)

Each child follows the standard campaign flow:
`handle → plan → implement → review → done`

The orchestrator treats each child as an independent issue after wave scheduling.
Apply the 5-field delegation contract (`bc-orchestrator.md`) to every worker spawn.

---

## 6. Parent closure

Close the parent epic when **all** children reach `phase: done` (PRs merged):

```
gh issue comment <parent> --body "All children merged. Epic complete."
gh issue close <parent>
```

Update `queue.json`: parent `phase: done`, `status: merged`.

If a child is deferred or archived, add a comment on the parent explaining what
was left out and why, then close the parent anyway.

---

## State summary

| Epic state | `queue.json` entry |
|------------|--------------------|
| Detected, not split yet | `phase: handle`, `status: ready` |
| Split, awaiting PO gate | `phase: handle`, `status: blocked`, `notes: awaiting-plan-approval` |
| Approved, children in-flight | `phase: handle`, `status: blocked` (parent); children progress normally |
| All children done | `phase: done`, `status: merged` |

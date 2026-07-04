# Issue Splitting — when to split (not only epics)

Split when an issue **cannot ship as one comfortable, reviewable PR** — applies
to **any** size label, not only `size:l` / `size:xl`.

## Split triggers

| Trigger | Action |
|---------|--------|
| Multiple unrelated concerns in one issue | Split by concern |
| Schema + UI + lib in one PR would be huge | Split: schema → lib → UI |
| Explicit phases in body | One child per phase |
| Plan reveals >1 day or >~400 LOC touch | Split before implement |
| Review would need domain + security + math passes on unrelated files | Split |
| `size:m` but spans 3+ top-level domains | Split to `size:s` children |
| Parent is epic | Orchestrator-led split (runbook epic section) |

## Do not split

- Single-file bug with clear AC and one test
- Docs-only change in one directory
- User explicitly wants one PR (confirm via AskQuestion)

## Child issue template

Every child from split:

```markdown
Part of #<parent>

## Acceptance criteria
- [ ] Testable item

## Scope
In: ...
Out: ...

## Dependencies
Blocked by #N (if any)

## Touch hints
- path/glob
```

Labels: target `size:s` or `size:m`. If child still too large → split again in handle.

## Parent issue after split

- Parent `status: blocked`, `phase: handle` or `done` (tracking only)
- Close parent when all children merged, or keep open as epic tracker
- Update queue: children `epic_parent: <parent>`, `depends_on` as needed

## Small issue that grows

During **plan** or **implement**, if scope expands:

1. Stop implement worker if not yet merged
2. AskQuestion — user confirms split vs continue single PR
3. File children; move remaining work to child issues
4. Ledger any findings; defer to new issues as needed

Anti-pattern: one worker with "implement #N" and unbounded epic body.

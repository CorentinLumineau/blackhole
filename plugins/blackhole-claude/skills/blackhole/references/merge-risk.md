# Merge Risk — Merge Method and Low-Risk Merge Gate

Split out of `merge-gate.md` (formerly its § 9). The merge-eligibility algorithm stays there; this
file owns only the merge method and the low-risk automerge gate. Consulted by `phase-loop.md`
§ Merge protocol **step 4**, and by `merge-gate.md` § 4 for each merge in a gated batch.

## `classifyMergeRisk(pr) -> automerge | needs-chef` — low-risk merge gate

**Merge method.** Blackhole merges with `--squash` by default. A PR that has open stacked children
is merged with `--merge` (a merge commit) when the repo allows it, because the child then already
contains the parent's tip and recovery (`merge-gate.md` § 7) is a retarget with no commit, no push
and no CI rerun. When the repo allows no merge commit, it stays `--squash` and `merge-gate.md` § 7's
replay is mandatory. `bun run "${BLACKHOLE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?blackhole plugin root unset, see blackhole#1269}}"/scripts/stack-repair.ts merge-method --queue <abs queue.json>
--repo-slug <owner/repo> --forge <config.forge> --issue <N>` prints the choice as JSON (`method`,
`flag`, `reason`); with unreadable repo settings and open stacked children it prints `hold: true`
and exits 3 instead of choosing squash; `phase-loop.md` step 4 runs it.

Blackhole may merge **its own** PRs only when CI is already green (step 1 / C3) **and** the
diff is low-risk. Any other PR that has reached this point stays open for Chef (the orchestrator /
owner) with label `needs-chef` and a short comment saying why. This is a PR-quality signal, not a
fourth `mergeEligible()` condition (same shape as `merge-gate.md` § 6 / Step 0.6).

**Own PR:** head ref is `blackhole/issue-N` or `blackhole/issue-N-<slug>` (`V-BRANCH-03`). An omitted head ref is treated as own
(the merge protocol already only considers campaign issues). Any other head is a hold.

**Low-risk:** the changed-file list (and optional unified diff) touches **none** of:

| Category | Typical paths / content |
|----------|-------------------------|
| `auth-login` | `auth/`, `login`, `oauth`, `sso`, `passport`, `*password*`, `*jwt*` |
| `secrets-env` | `.env*`, `secrets`, `credentials`, `*.pem`/`*.key`, `.ssh/`, `.aws/credentials` |
| `prod-db` | paths combining prod/production with db/database/sql/postgres/mysql/mongo |
| `migrations` | `migrations/`, `migrate/`, `prisma/migrations/`, alembic, knexfile, flyway |
| `github-workflows` | `.github/workflows/**` |
| `release-tag` | `scripts/release.ts`, `scripts/release-cadence.ts`, `scripts/lib/release-cadence.ts`, `.github/releases/`, `git-create-release`, `package.json` version bump |
| `deletes-data` | deleted `data/`/`dumps/`/`*.sql`/`*.csv` files, or `DROP TABLE`/`TRUNCATE TABLE x`/`DELETE FROM`, or `TRUNCATE` followed by a table name (`TRUNCATE x`, `TRUNCATE ${t}`; the word `truncate` followed by a quote, comma or `(`, as in shell command lists and calls, does not count), in a patch to a `.sql`/`.dump`/migration file or to non-test, non-markdown code (the classifier's own source and its built copies are exempt) |

Mechanical check (exit `0` automerge, `1` hold, `2` usage) — judgment is above, arithmetic is not
here:

```
bun run "${BLACKHOLE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?blackhole plugin root unset, see blackhole#1269}}"/scripts/merge-risk.ts --name-status <abs> [--patches <abs unified diff>] --head-ref <branch>
bun run "${BLACKHOLE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?blackhole plugin root unset, see blackhole#1269}}"/scripts/merge-risk.ts --files <abs json>
```

`--files` JSON is `{ files: [{path, status, previousPath?}], patches?: [{path, patch}], headRef? }`.
`--name-status` is `gh pr diff <n> --name-status` (or `git diff --name-status`). `--patches` is
`gh pr diff <n>`; without it, `deletes-data` is path/status only. Stdout is the verdict JSON
including a ready-to-post `comment` that starts with `needs-chef:`.

Hold mechanics (`phase-loop.md` step 4, not here): create label `needs-chef` if missing, add it to
the PR, comment once (skip if a `needs-chef:` comment already exists), set `queue.json` `notes` to
`needs-chef: <categories>`, do not call `gh pr merge`.

## Edge cases

| Scenario | Resolution |
|----------|------------|
| Green CI, low-risk campaign PR (`blackhole/issue-N` or `blackhole/issue-N-<slug>`, none of the categories above) | `phase-loop.md` step 4 squash-merges (`automerge: true`) |
| Green CI, but the diff touches a high-risk category above (or head is not `blackhole/issue-N[-slug]`) | Step 4 **does not merge**. Label `needs-chef`, comment the script's `comment` field, leave the PR open for Chef |
| `needs-chef` already on the PR from a prior turn | Do not post a second `needs-chef:` comment; re-evaluate next turn if the diff changed |
| `DELETE FROM` / `DROP TABLE` only in a test, fixture or markdown file, or in the classifier's own source (including its built copies) | Not `deletes-data` — `isTestPath()`, `isDocPath()` (any `.md`/`.mdx`) and the matcher's own path suffix are exempt; a `.sql`/`.dump` or migration path is always scanned, even under a test or docs directory |
| `merge_mode: leave-open`, high-risk, CI green | Same hold half (label + comment); still no `gh pr merge` |
<!-- GENERATED by scripts/build.ts from src/references/merge-risk.md — do not hand-edit -->

## Verification Evidence Gate

Unconditional — no code path skips this, same "no bypass" shape as the Bugfix Gate's
Root-Cause Verification gate and the `refactor-strict`/`docs-only` gates above. Before any
`status: complete` claim, run this 5-step gate:

1.  **IDENTIFY** — what needs verification? (tests, build, lint, requirements, delivery
    boundary: branch pushed, PR open, worktree clean)
2.  **RUN** — execute the verification commands NOW.
3.  **READ** — read the FULL output (not just the exit code).
4.  **VERIFY** — state pass/fail with evidence (quote the output).
5.  **CLAIM** — only now may the `status: complete` claim be made.

**Delivery-boundary evidence** (GAP-3): before any `status: complete` claim that names a
delivery fact — "branch pushed", "PR opened", "worktree clean" — the RUN/READ/VERIFY steps
above must be backed by the corresponding command, not narrative: `git -C <path> status
--porcelain` (empty output confirms worktree clean), the Explicit Git Targeting Gate's `git -C
<path> ls-remote origin refs/heads/<branch>` vs. `git -C <path> rev-parse HEAD` check (a SHA
match confirms fully and correctly pushed — issue #516, stronger than an upstream-tracking
check since upstream tracking is exactly what can be corrupted), and the forge PR-state lookup
already used elsewhere in this workflow (confirms the PR is open). These three claims belong to
the same evidence-gated set as tests/build/lint — never asserted from what was *intended* to
run.

Steps 1-4 MUST produce artifacts (command + quoted output). Step 5 is only permitted after
1-4 succeed. If any step is skipped, do not return `status: complete` — either produce real
evidence (re-run the gate) or return `status: blocked` with an honest note.

**Banned red-flag phrases** — if any of these would appear in your own completion
summary/PR description, that is a signal the gate above was skipped. Delivery-boundary claims
(branch pushed, PR open, worktree clean) carry the identical evidentiary bar as the
test/build/lint claims below — no separate list is needed, since the phrases already cover
hedging regardless of claim subject:

- "should work" / "should pass" / "probably" / "likely"
- "based on the code" / "based on my analysis"

Presence of any of these phrases in a completion report is treated as an unverified claim.

**Sprint Contract closure (Standard track)**: on a Standard-track plan (the plan file's `##
Task Breakdown` carries per-task `— **AC**: <condition>` markers and a `**Sprint Contract**`
subsection — `planner.md` § Standard Track), the gate above runs once more, per-criterion,
instead of collapsing everything into the single blanket `evidence` pair. For each `— **AC**:
<condition>` marker attached to a task in the plan: identify the narrowest command or check
that actually exercises that specific condition (a targeted test, a grep against generated
output, a manual curl/response check — not the whole-suite command already captured in
`evidence`), run it, read its full output, and record one `ac_results[]` row `{ criterion,
check, result, verdict }` — `verdict` is `PASS` \| `FAIL` \| `N/A` (`N/A` only when the
condition is genuinely unexercisable this session, e.g. a manual/UI-only criterion with no
automated proxy; never used to skip a criterion that could be checked). Aggregate the rows into
`sprint_contract_status`: `PASS` when every row is `PASS`; `PARTIAL` when at least one row is
`FAIL` or `N/A`; `N/A` when the plan is not Standard track or carries no `— **AC**:` markers —
Quick/Skip/Design/Brainstorm tracks always resolve `N/A`, this gate never invents AC markers a
plan did not produce (`V-SCOPE-01`). Record the per-AC table in the PR description (one row per
`ac_results[]` entry: criterion \| check \| result \| verdict) — the same "artifact lives in the
PR body" pattern already used by the Reuse Check and Improvement Record above — so `reviewer.md`
§ 5-Field Contract & Plan Compliance's Objective Fulfillment can consume the structured verdicts instead of re-judging AC
narratively. This extends the 5-step gate above; it does not replace the single `evidence`
{command,result} pair used for the overall test/build/lint claim.

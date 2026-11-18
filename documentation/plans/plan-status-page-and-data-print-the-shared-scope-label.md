---
type: plan
summary: "Plan for issue 1306: one shared scope-label formatter, and the HTML page and --data Scope panel print it (all open issues) instead of Scope not recorded; template version 7 to 8"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan - Issue #1306

## Objective

An unrecorded campaign scope reads `all open issues` on every surface: text dashboard, `--summary`, `--html` page and `--data` Scope panel. Today the HTML page and `--data` still say "Scope not recorded" (#1270 fixed text only). The label and its three copies (`overview.ts` `scopeFilter`, `dashboard.ts` `formatScopeLabel`, `report.ts` `campaignName`) collapse into one formatter (V-DRY-01, V-INT-02). Out of scope: #1311 (Doc carry headline scope).

Pareto: Gain 5 x (11 - Effort 3) = **40**, at least 30. Rulings: none touched.

## Touch-Paths

- `scripts/lib/campaign-status/scope-label.ts` (new: the one formatter)
- `scripts/lib/campaign-status/scope-label.test.ts` (new)
- `scripts/lib/campaign-status/dashboard.ts` (drop local `formatScopeLabel`, re-export the shared one)
- `scripts/lib/campaign-status/overview.ts` (`scopeFilter` calls the formatter)
- `scripts/lib/campaign-status/report.ts` (`campaignName` calls the formatter)
- `scripts/lib/campaign-status/html.ts` (`scopeSection` unrecorded branch)
- `scripts/lib/campaign-status/data.ts` (`scopeRows` unrecorded branch)
- `templates/status-dashboard/index.html` (scope row omits "since" when no date; `bh-template-version` 7 to 8)
- Tests: `scripts/lib/campaign-status/{html,data,dashboard,dashboard-template,campaign-dashboard,report}.test.ts`, `scripts/campaign-status.test.ts`
- `src/references/status-page.md` (lines ~82 and ~216: unrecorded scope shows the label), plus all generated dist trees per `scripts/lib/build/targets.ts`
- Exemptions from the sweep AC: `config-template.md`'s `campaign_scope.entries` "Scope not recorded" Resolution sentence is updated in the same pass; no other exemptions.

Unchanged by design: `launch-summary.ts` and `campaign-status.ts` keep importing `formatScopeLabel` from `dashboard.ts` (re-export), so no import churn.

## Codebase Conventions

- Single-formatter pattern already named in `dashboard.ts:223` ("single scope-label formatter, V-DRY-01"); this plan moves it, it does not invent one.
- Datasets are derived from the one `StatusReport` (`data.ts` buildStatusData); no recomputation. `report.campaign.scope` is `{milestone, labels}` and is what the HTML/data builders read.
- Template contract: any template change bumps `bh-template-version` (`status-page.md:225`, `config-template.md:293`); `files/index.html` is only rewritten when the version differs (`status-page.md:150`), so the bump is what ships the fix to existing pages.
- Orientation checked at `overview.ts:93` (reads `c.scope_milestone`/`c.scope_labels`), `report.ts:228`, `dashboard.ts:225`.

## Design

`formatScopeLabel(scope: { milestone?: string | null; labels?: readonly string[] | null }, style: 'plain' | 'markdown' = 'plain'): string`:
- milestone and labels: `milestone M and labels a, b`; milestone only `milestone M`; labels only `labels a, b`; none `all open issues`.
- `markdown` wraps the milestone in `**` and each label in backticks (today's text-dashboard shape, so `milestone **v2**` stays byte-identical).
- Callers: `dashboard.ts` (markdown), `overview.ts`, `report.ts`, `html.ts`, `data.ts` (plain).

Unrecorded scope in HTML: `scopeSection` renders one line with the plain label instead of `empty('Scope not recorded')`.
Unrecorded scope in `--data`: `scopeRows` returns one row `{kind: 'Filter', text: <label>, reason: null, date: null}`. The template row today always appends " . since <date>", so it must skip that span when `date` is null; that edit is why the template version bumps 7 to 8. The `data-empty="scope"` line stays in the template (no data source can hit it any more, but removing a panel contract is beyond this issue).

Behaviour note: the text dashboard now also names labels when a milestone is set (previously dropped). No existing assertion pins that case.

## Task Steps

1. **RED**: write failing tests first (see Test Strategy). Run only the changed spec files.
2. Add `scope-label.ts`; `dashboard.ts` re-exports it and deletes its local copy.
3. Point `overview.ts` `scopeFilter` and `report.ts` `campaignName` at it.
4. `html.ts` and `data.ts` unrecorded branches as in Design.
5. Template: skip " . since" when no date; bump `bh-template-version` to 8; update the version assertion.
6. Update `status-page.md` and `config-template.md` wording; run `bun run build`.
7. Scout Check: one improvement record inside the touched files.

## Acceptance Criteria (machine-verifiable)

- **AC1**: `formatScopeLabel({}, 'plain')` returns `all open issues`; the literal `'all open issues'` appears in exactly one non-test file under `scripts/lib/campaign-status/` (`grep -rn "'all open issues'" scripts/lib/campaign-status --include=*.ts` excluding `*.test.ts` returns one line, in `scope-label.ts`).
- **AC2**: for scope `{milestone: 'v2', labels: []}`, `renderStatusHtml(report)` with no recorded entries contains `milestone v2` in the Scope section and not `Scope not recorded`; for empty scope it contains `all open issues`.
- **AC3**: `buildStatusData(report).scope` for an unrecorded report equals `[{kind: 'Filter', text: 'all open issues', reason: null, date: null}]`; with entries recorded it equals the existing rows (existing `data.test.ts:50` stays green).
- **AC4**: `--summary`, text dashboard, HTML and `--data` print the same label for one config (`campaign-dashboard.test.ts` cross-surface assertion; the old `expect(html).toContain('Scope not recorded')` at line 164 is inverted).
- **AC5**: `templates/status-dashboard/index.html` carries `bh-template-version" content="8"`; the Scope row code does not append "since" when `date` is empty; `dashboard-template.test.ts` asserts both and `bun test scripts/lib/campaign-status/dashboard-template.test.ts` passes.
- **AC6**: `grep -rn "Scope not recorded" src scripts --include=*.md --include=*.ts` outside the retained empty-line template assertion returns nothing stale (status-page.md and config-template.md reworded).
- **AC7**: `bun run build` regenerates dist trees clean and `bun run verify` passes in CI.

## Test Strategy (red first)

1. `scope-label.test.ts`: four scope shapes x plain/markdown, including the exact markdown strings `milestone **v2**` and `labels \`a\`, \`b\``.
2. `html.test.ts`: unrecorded scope shows the label (milestone, labels, none).
3. `data.test.ts`: unrecorded row (AC3).
4. `dashboard-template.test.ts`: version 8 and the no-"since"-when-undated assertion.
5. `campaign-dashboard.test.ts`: flip line 164 to assert the label on all four surfaces.
6. Run focused specs only through `with-test-lock`; the full suite is CI's (`ci-first-verification`).

## Documentation Impact

`src/references/status-page.md` (~82, ~216) and `src/references/config-template.md:89` (Resolution sentence). No new `documentation/` file.

## Execution Strategy & Stop Conditions

- If `html.test.ts` or `data.test.ts` pins another "Scope not recorded" string than those listed, then update it in the same pass; if it is outside Touch-Paths, stop and file a follow-up issue.
- If the template change needs more than the "since" guard and the version bump, then halt and revisit the plan.
- If changing `campaignName` to include labels alongside a milestone breaks a pinned title test, then revert that caller to its old wording and keep the AC1 literal in one place only.

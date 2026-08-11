# Blackhole V-Codes

Restate this table in every implementation and review agent prompt. Do not paste
longer definitions (token cost, drift). Persist every finding to
`findings-ledger.json`.

| Code | Rule | Severity | Primary enforcement site |
|------|------|----------|--------------------------|
| V-SOLID-01/03 | Single responsibility; substitutability | BLOCK | reviewer.md §3 (V-SOLID-01, V-SOLID-03 — SOLID & DRY Compliance) |
| V-DRY-01 | No >10-line duplication | BLOCK | reviewer.md §3 |
| V-DRY-02/03 | 3–10-line duplication; repeated magic values | WARN | reviewer.md §3 (V-DRY-02, V-DRY-03 — SOLID & DRY Compliance) |
| V-KISS-01 / V-YAGNI-01 | No over-abstraction; no speculative features | BLOCK | reviewer.md §12 (Suggestion Proportionality Gate) |
| V-KISS-03 | No empty scaffolding | WARN | reviewer.md §3 (Anti-Slop Audit) |
| V-YAGNI-03 | No single-consumer abstractions | WARN | reviewer.md §3 (Anti-Slop Audit) |
| V-DRY-04 | No copy-paste templates with trivial renames | WARN | reviewer.md §3 (Anti-Slop Audit) |
| V-PAT-01 | God Object — class/module with 7+ responsibilities or >300 lines (see `hunt/best-practices.md` SRP heuristic, `hunt/refactor.md` god-module cluster) | BLOCK | reviewer.md §3 (Design Pattern Review) |
| V-PAT-02 | Circular dependency between modules | BLOCK | reviewer.md §3 (Design Pattern Review) |
| V-PAT-03 | Missing error-handling pattern — bare catch / swallowed errors (see `hunt/bug.md`) | BLOCK | reviewer.md §3 (Design Pattern Review) |
| V-PAT-04 | Anti-pattern usage — singleton abuse, service locator | WARN | reviewer.md §3 (Design Pattern Review) |
| V-TEST-01/02 | All new logic tested, tests FIRST | BLOCK | reviewer.md §2 (TDD & Testing Baselines) |
| V-TEST-05 | Meaningful assertions (not existence checks) | WARN | reviewer.md §2 (TDD & Testing Baselines) |
| V-TEST-09 | Coverage regression on changed files — line/function coverage vs. pre-change baseline must not drop | BLOCK | implementer.md § Refactoring & Implementation Workflow (Coverage-regression gate, step 6) |
| V-TEST-10 | Test integrity — a diff adds a test-skip marker, removes an assertion with no replacement, or loosens a validation rule with no stated reason; review-time diff-pattern judgment, distinct from V-TEST-09's measurable coverage-delta metric | BLOCK | reviewer.md §23 (Test Integrity Audit) |
| V-SEC-01/02 | No injection; no auth bypass | BLOCK | reviewer.md §4 (Security Checks) |
| V-SEC-03/04 | No hardcoded secrets; no XSS | BLOCK | reviewer.md §4 (Security Checks) |
| V-SEC-06 | Every security finding carries a concrete attack scenario | BLOCK | review-core.md § Security-mode review (exploitability gate) |
| V-SEC-07 | Adversarial re-verification — each security finding independently re-checked before it can block merge | WARN | review-core.md § Independent security verification (second, independent `reviewer` spawn — issue #439) |
| V-SEC-08 | Security findings artifact must structurally validate before merge when security_review_required: true | BLOCK | review-core.md § LGTM definition (merge-gate validator) |
| V-SEC-09 | Local-analyze confidence-boost scan may only raise security_review_required — a clean/absent scan must never lower an already-true value | BLOCK | router.md (local_analyze confidence-boost raise-only rule) |
| V-SEC-10 | Local-analyze grep matches must pass the one-line false-positive verification (comment/fixture/string-literal check) before counting toward a raise | WARN | router.md § Local-analyze confidence-boost mechanism (False-positive verification, steps 1-4) |
| V-SEC-11 | Sensitive-filename staged before commit — a path matching the shared file-write pattern set (owned by #447) reached `git add` without a refusal + ledger log; independent of `V-SEC-03`'s content scan | BLOCK | reviewer.md §4 (Security Checks — Sensitive-Filename Staging Audit) |
| V-INT-02 | NEVER reimplement an existing utility | BLOCK | reviewer.md §5 (Integration Coherence) |
| V-INT-01/03/04 | Follow conventions at touchpoints; no third variant of a solved concern | WARN | reviewer.md §5 (Integration Coherence) |
| V-FIX-01 | Fixes address the root cause, documented — never the symptom | BLOCK | reviewer.md §15 (Decision Record Audit — root-cause escalation) |
| V-PARETO-01 | No >3× complexity for marginal gain | WARN | reviewer.md §12 (Suggestion Proportionality Gate) |
| V-PARETO-02 | Pareto scoring & gating: Priority = Gain * (11 - Effort) must be >= 30 to create an issue, and ready issues are sorted by Priority descending — diverges from mercure's V-PARETO-02 (gold-plating / polish without user value, MEDIUM); kept per ADR-021 D5 because renumbering the 9-file SSOT heading is disproportionate; mercure's meaning, if ever adopted here, takes a fresh unused code | BLOCK | reviewer.md §6 (Improvement Discoveries & Pareto scoring) |
| V-DOCSYNC-01 | Public-API and design docs updates in the same PR | BLOCK | reviewer.md §9 (Public-API / Docs Currency) |
| V-DOCFACT-01 | Documentation prose asserts a factual or arithmetic claim contradicted by repo-checkable evidence (counts, ratios, file paths, issue/ADR states) | WARN | reviewer.md §18 (Documentation Prose Factual Accuracy) |
| V-RULE-01 | Diff violates a recorded active-status owner ruling in product-principles.md (documentation/reference/) | BLOCK | reviewer.md §19 (Owner-Ruling Violation Audit) |
| V-ADA-01 | `ARCHITECTURE.md` absent at project root/package (remedy: create from template) | BLOCK | reviewer.md §10 (Companion-File Audit) |
| V-ADA-02 | `documentation/decisions/INDEX.md` missing an Accepted ADR added in this diff (remedy: append INDEX row) | WARN | reviewer.md §10 (Companion-File Audit) |
| V-ADA-03 | `DESIGN.md` absent when diff touches a detected frontend/UI project (remedy: flag) | WARN | reviewer.md §10 (Companion-File Audit) |
| V-ADA-05/06/07 | `AGENTS.md` absent at root, new monorepo package missing `AGENTS.md`, or package `AGENTS.md` unindexed at root (remedy: flag) | WARN | reviewer.md §10 (Companion-File Audit) |
| V-UX-01 | Information overload on a UI-touching diff — flat field dumps, >~7-column dumps with no grouping/drill-down, everything-expanded-by-default, buried primary info, or deprecated data at equal prominence, instead of tiered at-a-glance/summary/detail/raw disclosure | WARN | reviewer.md §14 (Information-Hierarchy Audit) |
| V-DOC-GOV-01 | New doc created under `documentation/` without a search-before-write check (duplicate-concern risk) — kept at WARN, diverging from mercure's HIGH: no reviewer audit site exists for this code (procedural-only, enforced solely by the writing agent remembering to check, `doc-governance.md` § Search-Before-Write); raising the table default to BLOCK here with no audit behind it would reproduce #438's exact defect one row later — a campaign wanting stricter protection can escalate today via `docs_governance.severity_overrides`, no new issue required | WARN | doc-governance.md § Search-Before-Write |
| V-DOC-GOV-02 | Doc under `documentation/` missing lifecycle frontmatter (`type`, `status`) | WARN | doc-governance.md § Lifecycle Frontmatter |
| V-DOC-GOV-03 | Doc filename uses a date-stamp suffix instead of the canonical `{concern-slug}.md` naming (ADR files exempt) | WARN | doc-governance.md § Canonical Naming |
| V-DOC-GOV-04 | Doc content substantially replaced without `supersedes:` link or `status: deprecated` on the prior version | WARN | doc-governance.md § Supersede-on-Overwrite |
| V-DOC-04 | Doc-tree structural staleness — a `documentation/INDEX.md` (or per-folder index) row whose `path` resolves to no existing file, or a doc's `supersedes:` frontmatter value resolving to no file or to a file not marked `status: deprecated`; tree-wide, not diff-scoped (folder-reorg tracking deferred until the tree tiers) | BLOCK | hunt/docs.md (`docs` kaizen hunt kind) |
| V-DOC-05/06 | Rationale duplicated across a definition/interface/call-site/test (four copies drift four ways — the canonical site is where the concept is defined; other sites must reference it by symbol name, not restate it), or an issue/PR number, "found by review of X", or change-history prose embedded in a source comment (a regression test may carry its issue number in the **function name** only) | WARN | reviewer.md §26 (Comment Discipline Audit) |
| V-DOC-07 | Comment-to-code ratio advisory — added comment lines exceed ~40% of a diff's added lines; informational only, never escalates past WARN and never blocks | WARN | reviewer.md §26 (Comment Discipline Audit) |
| V-CONFIG-01 | New config/env keys follow established naming, registered | WARN | reviewer.md §5 (Integration Coherence — Config/env key naming) |
| V-SCOPE-01 | No refactoring untouched code | WARN | reviewer.md §12 (Suggestion Proportionality Gate) |
| V-SCOPE-02 | Touch-Paths violation — files modified outside plan scope | WARN | reviewer.md §1 (5-Field Contract & Plan Compliance) |
| V-SCOPE-03 | Missing/underestimated blast-radius — a Standard-track plan with 3+ affected consumers lacks a `## Dependency Blast-Radius` section | WARN | reviewer.md §1 (5-Field Contract & Plan Compliance) |
| V-API-01 | API contract drift — public interface diverges from plan | BLOCK | reviewer.md §1 (5-Field Contract & Plan Compliance) |
| V-THREAT-01 | Threat Model — a Quick-track change with `route.security_review_required` proceeded without the plan-time threat escalation check / track escalation | BLOCK | reviewer.md §16 (Threat Model Audit) |
| V-THREAT-02 | Threat Model — every HIGH/CRITICAL-severity threat has mitigation status 'Mitigated' | BLOCK | reviewer.md §16 (Threat Model Audit) |
| V-THREAT-03 | Threat Model — all six STRIDE categories evaluated (Spoofing, Tampering, Repudiation, Info Disclosure, DoS, Elevation of Privilege) | WARN | reviewer.md §16 (Threat Model Audit) |
| V-UI-01 | UI Interpretation Gate — a `route.ui: true`, non-`size:xs` issue merged with `ui_gate` absent or `pending` (not `approved`) in the plan frontmatter | BLOCK | reviewer.md §21 (UI Interpretation Gate Audit) |
| V-PERF-01 | Performance Budget — no N+1 queries, unindexed sorts, sync I/O in hot path, full-table scans, or unbounded pagination for a budgeted component | BLOCK | reviewer.md §17 (Performance Budget Audit) |
| V-PERF-02 | Performance Budget — diff touching a budgeted component does not regress against its documented threshold | WARN | reviewer.md §17 (Performance Budget Audit) |
| V-BRANCH-01 | Force-push to protected branches (main, master, release/*) | BLOCK | phase-review.md (pre-merge gate) |
| V-BRANCH-02 | Direct commit to main/master without review and approval | BLOCK | reviewer.md §7 (PR & Git Hygiene) |
| V-BRANCH-03 | Branch name does not match blackhole/issue-N convention | WARN | phase-implement.md (worktree/branch creation checklist) |
| V-WORKTREE-01 | Worktree leak — failed to clean up temporary directories | BLOCK | orchestrator.md (turn-start prune step) |
| V-GIT-01 | PR created without Closes #N issue linkage in description | BLOCK | reviewer.md §7 (PR & Git Hygiene) |
| V-MERGE-01 | drift-reconciled merge with merged_by:blackhole present — step 0 bypassed | BLOCK | merge-gate.md §3 |
| V-MERGE-02 | drift-reconciled merge with merged_by absent — external bypass of hold/merge_after | WARN | merge-gate.md §3 |
| V-HUNT-01 | Kaizen issue filed from a finding without a `CONFIRMED` verification pass | BLOCK | hunter.md (CONFIRMED verification gate) |
| V-HUNT-02 | Hunt wave filed more than `max_issues_per_wave` issues, or filed below `min_priority` | WARN | hunter.md (filing caps) |
| V-AUTO-01 | Autonomous design proceeds without a `design-aggregate.ts` verdict artifact | BLOCK | scripts/design-aggregate.ts + planner.md §4.8 |
| V-AUTO-02 | Thinking-route artifact staged but not carried into the PR — route declared an artifact and none reached the PR; a route that declared nothing is unaffected | BLOCK | reviewer.md §25 (Staged Artifact Carry Audit) |
| V-VIS-01 | UI-affecting diff with display_targets configured but no visual_evidence declared — silent skip | BLOCK | reviewer.md §22 (Visual Evidence Audit) |
| V-VIS-02 | visual_evidence[] present with a declared capture_status: unavailable entry — non-blocking, never silent | WARN | reviewer.md §22 (Visual Evidence Audit) |
| V-HOOK-01 | PreToolUse hook denied a destructive/unsafe Bash or Write/Edit call; the `.blackhole/hook-events/` record must be ingested into findings-ledger.json before the issue advances past implement | BLOCK | orchestrator-runtime.md § Triage step 1b |
| V-HOOK-02 | PreToolUse hook flagged a risky-but-allowed call for review — sensitive-file write, force push, registry publish, destructive SQL | WARN | orchestrator-runtime.md § Triage step 1b |
| V-BRIEF-01 | A worker return — direct, transcript-recovered, or resend-recovered — was applied to `queue.json`/`findings-ledger.json` without first passing `scripts/validate-worker-json.ts`, across any arrival path | BLOCK | orchestrator-runtime.md § Triage |
| V-BRIEF-02 | A spawn-brief-adjacent doc (`src/agents/*.md`, `src/references/*.md`, excluding `worker-schemas.md`) inlines a literal `"status": "<value>"` skeleton in a fenced JSON block whose value is outside the resolved role's status enum | WARN | scripts/checks/inline-schema-drift.check.ts |

**BLOCK** = must fix before merge (or escalate to user with justification).
**WARN** = fix or document deferral in PR and ledger.
Reviewers return findings as V-codes with file:line.
<!-- GENERATED by scripts/build.ts from src/references/blackhole-vcodes.md — do not hand-edit -->

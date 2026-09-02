# Documentation Index

| path | summary | type | status | review_trigger |
|------|---------|------|--------|----------------|
| architecture.md | Architecture entry point pointing to the durable ARCHITECTURE.md narrative | reference | current | on build target change |
| architecture/adaptive-routing.md | Adaptive phase routing architecture — router-agent flag contract and re-route checkpoints | architecture | current | on ADR-004 amendment |
| architecture/retrospective-blackhole.md | Architectural retrospective of blackhole (v0.21.0) — governance measured in lines while the system accretes in concerns; 14-metric dashboard, verified findings, remediation blueprint | retrospective | draft | on major version release |
| audits/analysis-blackhole-adaptive-phase-routing.md | Comparative analysis of blackhole's fixed pipeline against mercure's x-auto router | analysis | draft | on ADR acceptance |
| audits/analysis-blackhole-mercure-synergy.md | Synergy analysis identifying mercure parity gaps blackhole should close | analysis | draft | on ADR acceptance |
| audits/analysis-blackhole-routing-reuse-visibility.md | Routing visibility and Reuse Check gate analysis feeding ADR-008 | analysis | draft | on ADR acceptance |
| audits/analysis-ci-pipeline.md | CI pipeline analysis for the blackhole build and verify toolchain | analysis | draft | on ADR acceptance |
| audits/analysis-cloudflare-ci-free-tier.md | Cloudflare @cloudflare/ci free-tier viability for blackhole CI | research | current | on release |
| audits/analysis-issue-450.md | Pre-plan architecture analysis mapping the merge-conflict gap to phase-loop/merge-gate module boundaries and existing blocker/ledger conventions | analysis | current | on file change |
| audits/architecture-coherence.md | Architecture coherence audit across agents, skills, and reference files | analysis | current | on release |
| audits/autonomous-workflow-parity.md | Autonomous workflow parity audit against mercure's thinking-route coverage | analysis | draft | on ADR acceptance |
| audits/build-tree-install-resolution.md | Build-tree install resolution audit for the multi-target build pipeline | analysis | current | on release |
| audits/documentation-framework-alignment.md | Documentation-framework alignment audit that identified the gaps this issue closes | analysis | draft | on mercure release |
| audits/mercure-companion-files-gap-analysis.md | Gap analysis of mercure companion-file (V-ADA) protocol coverage in blackhole | analysis | current | on protocol change |
| audits/mercure-parity-matrix.md | Mechanism-by-mechanism parity matrix between mercure and blackhole | reference | current | on release |
| audits/mercure-parity-surface.md | Survey of the mercure surface blackhole parity work targets | research | current | on ADR acceptance |
| audits/mercure-sync.md | Mercure sync audit tracking upstream skill/agent drift | analysis | current | on mercure release |
| audits/platform-build-verification.md | Platform build verification audit for generated distribution targets | audit | current | on release |
| brainstorms/implement-side-quality-parity.md | Early exploration of implement-side quality parity with mercure, superseded by later ADRs | brainstorm | deprecated | on ADR acceptance |
| brainstorms/mercure-parity-program.md | Brainstorm scoping the multi-milestone mercure parity program | brainstorm | current | on ADR acceptance |
| plans/adr-004-adaptive-routing-campaign.md | Implementation campaign plan for ADR-004 adaptive phase routing | plan | current | on ADR acceptance |
| plans/adr-006-kaizen-hunt-campaign.md | Implementation campaign plan for ADR-006 kaizen hunt | plan | current | on ADR acceptance |
| plans/plan-adr-007-drift-proof-toolchain-reseating.md | Implementation plan for ADR-007's drift-proof toolchain re-seating blueprint | plan | current | on ADR acceptance |
| plans/plan-campaign-config-confirmation-gate.md | Plan for the campaign config confirmation gate at bootstrap preflight | plan | current | on ADR acceptance or Bootstrap preflight change |
| plans/plan-fix-scaffold-phase-0-journeys-md-companion-scaffold-creates-an-unindexed-doc-v-d.md | Implementation plan for closing the Phase-0 journeys.md companion-scaffold INDEX gap and correcting its documented target path (issue #728) | plan | current | on file change |
| plans/plan-retrospective-v0.21.0-remediation.md | Work breakdown and dependency graph for the v0.21.0 retrospective's 22 remediation items (one issue each) | plan | current | on ADR acceptance |
| plans/plan-pr-merge-gate-dependency-ordering.md | Implementation plan for ADR-005's PR merge-gate and dependency ordering | plan | current | on file change |
| plans/plan-refactor-facts-retire-expected-check-count-derived-counter-and-its-string-litera.md | Implementation plan for issue #704 (R-01) — retire the derived `EXPECTED_CHECK_COUNT` counter and its new-check-module Touch-Paths trigger | plan | current | on file change |
| plans/plan-routing-visibility-reuse-gate.md | Implementation plan for dashboard routing visibility and the implementer Reuse Check gate | plan | current | on ADR acceptance |
| plans/story-driven-conformance.md | Plan for story-driven conformance across the campaign's issue lifecycle | plan | current | on ADR acceptance or kaizen hunt-kind change |
| plans/plan-docs-architecture-fix-stale-committed-trees-table-and-five-agents-in-the-archite.md | Plan — fix stale committed-target-trees table and "five agents" claim in the architecture maps (issue #706, R-03) | plan | current | on release |
| plans/plan-fix-hooks-validate-file-changes-js-510-512-tests-fail-on-macos-os-tmpdir-under-p.md | Bugfix plan fixing hook-event-log.js's symlink-unaware `BARE_TEMP_DIRS` broad-root check (issue #714, R-21) — closes #510/#512 macOS test failures without weakening the guard | plan | current | on file change |
| plans/plan-docs-review-core-per-dispatch-mode-reviewer-prompt-requirements-verification-mod.md | Plan for issue #709 (R-06): per-dispatch-mode reviewer prompt requirements table reconciling review-core.md's universal checklist claim with reviewer.md §13/§24's narrower scopes | plan | current | on file change |
| plans/plan-fix-config-registration-parent-key-coverage-for-nested-config-blocks-router-conf.md | Bugfix plan for V-CONFIG-02 nested-block leaf coverage — parent-row `(sub-keys: ...)` marker convention for `router_confidence_thresholds` | plan | current | on file change |
| reference/check-utils-blast-radius.md | Blast-radius reference for shared check-utils.ts consumers across scripts/checks | reference | current | on check-utils.ts or scripts/checks/*.check.ts import change |
| reference/decision-log.md | Running decision log of Hard Choice / Bugfix / Refactoring decision records | reference | current | on file change |
| reference/product-principles.md | Owner-rulings ledger of durable product preferences binding on future diffs | reference | current | on new ruling |
| reviews/release-v0.13.1-to-head-audit.md | Release audit covering all changes from v0.13.1 to HEAD | review | current | on release |
| reviews/review-campaign-config-confirmation-gate.md | Review of the campaign config confirmation gate implementation | review | current | on ADR-015 change |
| reviews/review-docs-architecture-fix-stale-committed-trees-table-and-five-agents-in-the-archite.md | Review artifact for issue #706 (LGTM) | review | current | on file change |
| reviews/review-docs-review-core-per-dispatch-mode-reviewer-prompt-requirements-verification-mod.md | Review artifact for issue #709 (LGTM) | review | current | on file change |
| reviews/review-fix-hooks-validate-file-changes-js-510-512-tests-fail-on-macos-os-tmpdir-under-p.md | Review artifact for issue #714 (LGTM, one deferred WARN) | review | current | on file change |
| reviews/review-marketplace-json-path-fix.md | Review of the marketplace.json path fix | review | final | on release |
| reviews/review-refactor-facts-retire-expected-check-count-derived-counter-and-its-string-litera.md | Review artifact for issue #704 (LGTM) | review | current | on file change |
| reviews/review-fix-scaffold-phase-0-journeys-md-companion-scaffold-creates-an-unindexed-doc-v-d.md | Review artifact for issue #728 (LGTM, 2 deferred WARN) | review | current | on file change |
| reviews/review-fix-config-registration-parent-key-coverage-for-nested-config-blocks-router-conf.md | Review artifact for issue #707 (LGTM, 1 deferred WARN) | review | current | on file change |
| plans/plan-test-build-harness-integration-test-for-the-skills-sh-branch-of-model-routing-md.md | skills.sh-target integration test for model-routing.md's per-role tier resolution, closing the self-declared Unverified note | plan | current | on ADR acceptance |
| reviews/review-test-build-harness-integration-test-for-the-skills-sh-branch-of-model-routing-md.md | Review artifact for issue #713 (LGTM) | review | current | on file change |
| plans/plan-chore-content-gates-budget-orchestrator-runtime-dispatch-delegation-md-split-off.md | Content-gate budget rows for the three orchestrator split-off files, seeded at measured × 1.2 | plan | current | on ADR acceptance |
| reviews/review-chore-content-gates-budget-orchestrator-runtime-dispatch-delegation-md-split-off.md | Review artifact for issue #705 (LGTM) | review | current | on file change |

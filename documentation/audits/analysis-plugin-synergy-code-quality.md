---
type: analysis
summary: "Does running mercure and blackhole together deliver the best code quality efficiently? Evidence-based answer: same contract forked twice, double hooks, opposite gate policies — with a three-step convergence path"
skill: x-analyze
status: draft
review_trigger: "on ADR acceptance"
created: 2026-09-05
last_updated: 2026-09-05
target: "mercure v9.15.0 ↔ blackhole v0.21.2 — enforcement contract, hooks, rules, agents, review pipeline"
related:
  - documentation/audits/analysis-blackhole-mercure-synergy.md
  - documentation/audits/mercure-parity-matrix.md
  - documentation/audits/mercure-parity-surface.md
  - documentation/decisions/ADR-013-mercure-parity-program.md
  - documentation/audits/full-audit.md
---

# Plugin Synergy — mercure × blackhole for code quality

**Question**: when a developer installs both plugins, do they together produce the best achievable code quality, efficiently? The earlier synergy note (`analysis-blackhole-mercure-synergy.md`, 2026-07-22) answered a different question — whether blackhole can be "mercure, autonomously". This note takes the quality-and-efficiency angle and does not restate that note's findings; its F1/F2 (autonomy unverified and switched off) are still open as of this audit — mercure's own `.blackhole/config.template.json` has no `autonomy` block.

## Verdict

**Quality: yes, with a caveat. Efficiency: no, not yet.**

- **Quality** — the two plugins enforce the same core contract (72 shared V-codes) and blackhole matches or exceeds mercure on autonomous review mechanics (V-TEST-10/11 test-integrity, V-SEC-08..12, V-UNFALSIFIABLE-01, deterministic `review-aggregate.ts`). Mercure retains dimensions blackhole lacks (V-TEST-03/04/06/07/08 test taxonomy, V-UX-02..08, V-ARCH-01/02, V-CHOICE-01 hard-choice records, V-DELEG-01..03). The caveat: the contract is a **fork**, so the two reviewers silently disagree on three codes and three severities.
- **Efficiency** — installing both today runs **two** PreToolUse validators on every Bash / Write / Edit call, loads roughly **176 KB** of always-on rules whose approval-gate, merge, branch-naming and forge policies point in opposite directions, and maintains two 100 KB+ copies of the same knowledge with a manual, maintainer-only sync (`prj-mercure-sync`) that ADR-013 itself says "never invoked → parity decays silently".

## Evidence

### 1. Integration surface is one-way copy

| Direction | What | Class | Source |
|---|---|---|---|
| blackhole → mercure | confidence model, per-skill weight profiles | verbatim copy | `src/references/confidence-gates.md:3-4,36-40` |
| blackhole → mercure | V-code table, reviewer audit heuristics ("mirrors mercure `x-review`") | copy + divergence notes | `src/references/blackhole-vcodes.md:17,49,62`; `src/agents/reviewer.md:83,150,346` |
| blackhole → mercure | `ci-diagnosis.md` reimplements the mercure MCP `list_failing_jobs` tool over `gh` | reimplementation | `src/references/ci-diagnosis.md:28-29` |
| mercure → blackhole | 0 hits in `mercure-plugin/**`; ADR-110 (status Proposed) names blackhole as the execution/enforcement host | aspirational | mercure `documentation/decisions/ADR-110-feedback-driven-intent-layer.md:107-120` |
| runtime | no `Skill()`, `Agent(subagent_type: "mercure:…")`, or MCP call in either direction | none by design | ADR-013 "zero runtime mercure dependency" |

### 2. V-code contract: shared IDs, independent tables

Programmatic ID diff of mercure `rules/references/v-codes-*.md` (110 codes) against `src/references/blackhole-vcodes.md` (115 codes):

| Set | Count | Notes |
|---|---|---|
| Shared IDs | 72 | SOLID, DRY, KISS, YAGNI, PAT, PARETO, TEST-01/02/05/09, SEC-01..04/06/07, THREAT, INT, API-01, PERF, CONFIG, FIX, SCOPE, BRANCH-01..03, WORKTREE-01, GIT-01, DOC-01/03..07, DOC-GOV, ADA-01..08, UX-01 |
| Severity disagrees | 3 | V-ADA-05 (mercure HIGH → WARN), V-DOC-07 (LOW → WARN), V-DOC-GOV-01 (HIGH → WARN, documented) |
| **Same ID, different meaning** | 3 | **V-PARETO-02**: gold-plating (mercure) vs Priority-formula SSOT (blackhole, ADR-021 D5); **V-BRANCH-03**: `feature-branch.N` vs `blackhole/issue-N`; **V-ADA-05**: broken AGENTS.md→CLAUDE.md symlink vs AGENTS.md absent |
| Mercure-only | 38 | incl. V-TEST-03/04/06/07/08, V-UX-01a..e/02..08, V-ARCH-01/02, V-CHOICE-01, V-DELEG-01..03, V-ASSET-01..03 |
| Blackhole-only | 43 | incl. V-TEST-10/11, V-SEC-08..12, V-UNFALSIFIABLE-01, V-MERGE, V-HUNT, V-HOOK, V-ADR, V-PLUGIN-01 |

Neither repo has a check that the shared 72 agree. Blackhole's `V-SEVSYNC-01/02` checks internal consistency only; mercure's Check 44 aligns its own tables with `x-reviewer`. The same-ID collisions are a correctness problem for any reviewer prompt that restates "the V-code table" — a finding tagged V-PARETO-02 means two different things depending on which plugin filed it.

### 3. Hooks double-run

| Event | mercure `hooks/hooks.json` | blackhole `plugins/blackhole-claude/hooks/hooks.json` | Effect when both installed |
|---|---|---|---|
| PreToolUse Bash | `validate-bash-command` | `validate-bash-command.js` | Two validators per call; 194 differing lines of code, 122 differing lines in `bash-patterns.json`; either deny blocks |
| PreToolUse Write\|Edit | `validate-file-changes` | `validate-file-changes.js` | Two validators; blackhole's adds worktree containment (`V-HOOK-01`), mercure's adds the ask→review flow; 441 differing lines |
| SessionStart / PostToolUse / Stop / SubagentStop / PostCompact / PermissionDenied | mercure only | — | no conflict |

Blackhole's hook layer is a fork of mercure's (parity matrix PM-086, "covered" since #447/#448). Both forks are security gates; the blackhole audit in `full-audit.md` finds five copies of the quote-skip rule inside blackhole's fork alone.

### 4. Rules: ~176 KB always-on, with contradictory demands

`setup-core-docs.js:5-9` copies all 18 mercure rules (107,472 B) plus `CLAUDE.md` into `~/.claude/rules/` on every SessionStart — **user-global**, so they load in blackhole campaign sessions too. Blackhole's bundle ships 4 rules (64,872 B). Whether Claude Code loads a plugin bundle's `rules/` directory is asserted only for `.claude/rules/` at source root (ADR-009); this note does not verify it.

| Topic | mercure | blackhole |
|---|---|---|
| Approval gates | human approval at every workflow boundary; every multi-option interaction via `AskUserQuestion` (`mercure-workflow-protocol.md:11,53`) | two-band confidence kernel, proceed at ≥ 80 with an async veto comment (`confidence-gates.md:55-64`) |
| Merge | Fix→Commit is a human gate | orchestrator squash-merges on LGTM (`phase-loop.md:68`, `merge-gate.md:254`) |
| Branch name | `feature-branch.N` | `blackhole/issue-N` — each flags the other as V-BRANCH-03 |
| Worktree | registry in `.claude/worktree-registry.json` | `<scratchpad>/wt-<issue>` |
| Forge | Gitea via `tea` + mercure-context MCP | `gh` first, ADR-027 adapters for gitea/gitlab |
| Output style | 10-rule always-on (`mercure-output-style.md`) | none |

ADR-110 D4 (mercure, Proposed) frames these as intentional per-host policies. Nothing today scopes which rule set governs a given session; the mercure rules win by being global.

### 5. Agent and review-pipeline overlap

| blackhole | closest mercure | relationship |
|---|---|---|
| `reviewer` (893 lines, 32 audits) → `review-aggregate.ts` | `x-review` 3-wave swarm + `x-reviewer` + `x-synthesizer` | reimplements; deterministic aggregation instead of an LLM synthesizer |
| `implementer` | `x-implement` / `x-fix` + `x-tester` | reimplements; testing folded in |
| `planner` | `x-plan` + `x-planner` | reimplements |
| `hunter` | `x-improve-hunt` + `x-architect` retrospective | reimplements, campaign-scoped |
| `investigator` | `x-troubleshoot` / `x-research` | reimplements with copied confidence weights |
| `router`, `orchestrator`, `coordinator` | — | unique to blackhole |
| — | `x-designer`, `x-explorer`, `x-debugger`, `x-deployer`, `x-doc-writer`, `x-refactorer` | no counterpart |

### 6. Gaps neither plugin enforces mechanically

Mutation testing, dependency-vulnerability gating (parity PM-094 still `gap`), performance-regression benchmarks (V-PERF is reviewer judgment against a plan section), type-coverage thresholds, SBOM/licence, and a CI-enforced coverage floor (mercure V-TEST-03 exists; blackhole has no equivalent and V-TEST-09 is audited from worker claims).

## Where the synergy already works

Mercure is configured as a blackhole consumer (`.blackhole/config.template.json`: Gitea forge, `merge_mode: never`, PR done = ActionMan `ai-review:LGTM`). That is the right shape: **mercure for interactive design/plan/implement and the release channel, blackhole for draining the backlog under the same V-codes without a human clicking Recommended**. The confidence model, doc-governance schema and repo-convention-precedence detector (`scripts/detect-doc-schema.sh`) let blackhole produce artifacts a mercure repo accepts as native. Nothing in this note argues for a runtime dependency; ADR-013's standalone stance holds.

## Recommendations (Pareto)

1. **One machine-readable V-code source** (gain: high, effort: M). Emit the mercure table as a JSON/CSV artifact from `rule-inliner.js` (it already parses `v-codes-*.md`), vendor it via `prj-mercure-sync`, and add a blackhole `verify` check that fails on any shared-ID severity or meaning drift. Resolve the three collisions by giving blackhole's meanings fresh IDs — ADR-021 D5 declined this as "disproportionate", but the cost was measured against a 9-file heading rename, not against reviewers misreading a shared code; challenge it. Correct the stale parity row PM-090 while there.
2. **One hook owner** (gain: high, effort: M). Blackhole's PreToolUse validators are a superset (worktree containment, hook-event ledger). Either mercure's `validate-*` hooks detect a sibling blackhole install and exit 0, or the two pattern JSONs converge into one file both forks load. Until then, a user with both plugins pays two spawns per tool call and gets two divergent deny lists.
3. **Scope the always-on rules** (gain: medium, effort: S). Make `setup-core-docs.js` skip the global sync when the session is a blackhole campaign (`.blackhole/config.json` present and `entry_mode` set), or move the workflow-gate rules (`mercure-workflow-protocol.md`, `mercure-output-style.md`) into skill-scoped references. This removes the approval-gate / merge contradiction from campaign sessions without touching either plugin's design.

Deferred, out of scope for this note: closing the mechanical gaps in § 6 (each is its own feature), and the still-open T3 autonomy verification from the July note.

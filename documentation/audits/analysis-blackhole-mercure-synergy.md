---
type: analysis
skill: x-analyze
created: 2026-07-22
target: "blackhole ↔ mercure autonomous-parity synergy"
status: draft
related:
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
  - documentation/decisions/ADR-013-mercure-parity-program.md
  - documentation/audits/autonomous-workflow-parity.md
  - documentation/audits/mercure-parity-matrix.md
---

# Blackhole ↔ Mercure Synergy Assessment

**Question analyzed**: Can blackhole be "the autonomous way to implement a git issue as
mercure" — replacing a human who loops `git-implement-issue` and always clicks the
*Recommended* AskUserQuestion option — while both plugins stay standalone, sharing a common
foundation, and asking the user *only* when the answer is genuinely required (design choices,
destructive ops)?

**Headline finding**: The architecture the user is describing **is already built** (ADR-010 +
ADR-011/012, shipped in v0.15.0). The gap is **not design — it is verification and
enablement.** The autonomous-recommended-path kernel is (a) currently **switched off** in the
live campaign config, and (b) has **never been observed running end-to-end** on a real
campaign (T3 verification outstanding, green-campaign gate was waived at M5).

---

## Executive Summary

| Severity | Count | Top issue |
|----------|-------|-----------|
| CRITICAL | 1 | Autonomy machinery unverified on any real campaign (T3 owed since v0.15.0) |
| HIGH     | 1 | `autonomy.enabled` defaults `false` **and** is absent from the live `.blackhole/config.json` — kernel inert right now |
| MEDIUM   | 3 | Parity decay (~65 mercure domains unswept); "recommended path" is not literally portable; async veto surface is the only safety net and is unverified |
| LOW      | 1 | Agent-roster consolidation leaves docs-update (V-DOC-02/04, BLOCK) with no dedicated owner |

**The synergy is real and correctly scoped**: it lives at the *enforcement + artifact* layer
(V-codes, confidence model ported verbatim from mercure's `interview` skill, doc-governance
schema, repo-convention precedence), **not** at the workflow-chain layer. Blackhole does not
and should not literally replay mercure's skill chain — it replaces "click Recommended six
times" with `route{}` classification + a confidence kernel + a deterministic
`design-aggregate.ts` verdict. That is the right call and matches the binding constraints in
[[autonomous-thinking-routes-initiative]] (no named workflow chains — they break the frozen
phase enum).

---

## How the two map today

The user's manual loop and blackhole's autonomous loop are **conceptual twins with different
control planes**:

| Mercure (human-driven) | Blackhole (autonomous) | Source |
|------------------------|------------------------|--------|
| `git-implement-issue` → `git-issue implement` → `x-auto` → APEX chain | `coordinator` → `orchestrator` → 5 phases (Handle→Plan→Implement→Review→Loop) | mercure `git-issue/references/mode-implement.md:66,92`; bh `blackhole-protocol.md` |
| User clicks *Recommended* at each `## After Completion` gate | `route{}` classification (router, ADR-004) decides which phases run | mercure `WORKFLOWS.md:26`; bh `router.md:8-9` |
| Interview skill (5-dimension confidence gate) fires when the model is unsure | `confidence-gates.md` — **the same 5 dimensions, ported verbatim** from mercure `interview`, mapped to 5 async routes | bh `confidence-gates.md:3-8,17-39` |
| "Recommended" dynamically points to remediation when CRITICAL/HIGH findings exist | Review loop: BLOCK → loop to implement; iter ≥ 4 → escalate to user | mercure `mercure-workflow-protocol.md:38`; bh `phase-review.md:17-18` |
| Design→Plan / Plan→Implement / Fix→Commit = hard human approval | Design track = **always** AskQuestion, *unless* `design-aggregate.ts` returns `ready` | mercure `mercure-workflow-protocol.md:53`; bh `phase-plan.md:42-44`, `orchestrator.md:429-442` |
| — (no equivalent) | `coordinator`/`orchestrator`/`router` — the structurally new background-campaign layer | bh `src/agents/` (no mercure counterpart) |

**"Ask only when absolutely needed" is already precisely implemented.** The confidence kernel
(`confidence-gates.md:56-88`) gives exactly the behavior the user asked for:

- `composite ≥ autonomy.confidence_threshold` (default 80) → **proceed autonomously**, post a
  reformulated-understanding comment as the async audit/veto surface, do **not** wait.
- `composite < threshold` → up to 2 `[NEEDS CLARIFICATION]` markers (deferrable) or
  `status: blocked` + `AskQuestion`.
- **Never-bypass list** (`destructive`, `credentials`, `epic-go-no-go`) → always asks,
  regardless of score. This is exactly "design choices and destructive stuff" from the request.

---

## Findings

### CRITICAL — F1: The autonomous path has never been verified on a real campaign

Per the archived initiative, M5 (the BREAKING `autonomy.enabled` flip) **landed with the
"green campaign" Entry-Gate row explicitly WAIVED** by maintainer go-ahead; no pre-flip
campaign ran. **T3 live-campaign verification (4 criteria in `milestone-5.md`) is still
outstanding** and is owed on the first real campaign run of v0.15.0
([[companion-substrate-closure-initiative]], lines 20-25).

Everything in this assessment — the confidence math, the async veto comment, the
`design-aggregate.ts` verdict promoting an ADR inside a PR, the never-bypass escalation — is
**unobserved in production**. The single highest-value action is to run one real, low-risk
campaign with autonomy enabled and confirm the four T3 criteria.

*Failure scenario*: the user enables autonomy expecting mercure-quality unattended runs; a
latent wiring bug (e.g. the M2 `awaiting-design-approval` class of defect the initiative already
caught at `coordinator.md`/`queue-dag.md`) silently blocks or silently over-proceeds, and the
first evidence is a bad merged PR rather than a caught gate.

### HIGH — F2: Autonomy is off by default and absent from the live config

`autonomy.enabled` defaults to **`false`** — "opt-in like `kaizen`, unlike `docs_governance`"
(`config-template.md:66`). The current live `.blackhole/config.json` **has no `autonomy` block
at all**, so the entire kernel is a documented no-op right now: no confidence math, no
`design-aggregate.ts`, no async-comment proceed path (`config-template.md:107-112`).

Consequence: today, a user looping the campaign gets the **old categorical `clarify-gates.md`
behavior** — which asks on *every* product/UX/approach/ambiguity signal (`clarify-gates.md:16-24`),
i.e. far more interruption than the "only when truly needed" target. The feature the user is
asking for is built but not turned on.

*Remedy*: add the `autonomy` block to the campaign config (start conservative:
`enabled: true`, `confidence_threshold: 80`, `design_autonomy: true`, `analyze_routing: true`,
`brainstorm_routing: false` — matching the M5 landing posture). This is the concrete lever that
converts the manual loop into the autonomous loop.

### MEDIUM — F3: The "recommended path" is not literally portable — and shouldn't be

A naive reading of the request ("follow the recommended path mercure does") would string-match
mercure's `(Recommended)` labels. That does not work:

- Mercure's **x-design standard-scope Recommended is "Done"** (terminal), not "Start planning"
  (`x-design/SKILL.md:146`). A literal recommended-follower would *stop* at design.
- The Recommended label is **dynamic** — it points to the *fix* path when CRITICAL/HIGH
  findings exist, and is "NOT programmatic enforcement" (`mercure-workflow-protocol.md:38,47`).

Blackhole correctly does **not** replicate the click-chain. It substitutes `route{}` +
confidence + `design-aggregate.ts`. This finding is a **scoping clarification, not a defect**:
the synergy target is behavioral parity of *outcomes and quality gates*, not mechanical replay
of mercure's UI options. Document this explicitly so the goal isn't mis-set.

### MEDIUM — F4: Parity coverage decays silently (~65 mercure domains unswept)

The sharing model is deliberately **concept-level, one-way, manual** — nothing is vendored as
code; `prj-mercure-sync` (maintainer-only, no scheduling) diffs blackhole `src/` against the
mercure cache, classifies via Adoption Lens v2, and files gated GitHub issues
(ADR-013 D1-D3). Risk stated in ADR-013 itself: *"Sync never invoked → parity decays
silently… Accepted limitation."*

Mercure V-codes **absent** from blackhole today include several that matter for *autonomous*
code quality: `V-CHOICE-01` (hard-choice protocol — already a mercure behavioral rule),
`V-PAT-01..04` (design-pattern misuse/God-object), `V-SOLID-02/04/05`, `V-DELEG`, `V-EXT`,
`V-ARCH-01/02`. When a human is in the loop these are caught by eye; an autonomous implementer
has only the ported V-codes as its guardrails, so the unswept set is exactly where autonomous
quality can drift below mercure's.

*Remedy*: run `prj-mercure-sync` backlog mode against the pinned cache; prioritize porting the
quality-guardrail codes above (they are the ones a human reviewer would otherwise supply).

### MEDIUM — F5: The async veto comment is the only safety net and is unverified

Because high-confidence work proceeds without waiting (`confidence-gates.md:61-64`), the
reformulated-understanding **issue comment is the user's sole asynchronous intervention
surface**. If that comment is not reliably posted (or is posted to the wrong thread), the user
loses the ability to veto an autonomous decision before it merges. This must be an explicit T3
criterion, not an assumed side effect.

### LOW — F6: No dedicated docs-update owner after roster consolidation

Blackhole folded mercure's `x-tester`, `x-refactorer`, `x-doc-writer`, and `x-synthesizer`
into `implementer`/`reviewer`/`orchestrator`. Consolidation is fine, but `V-DOC-02/04`
(public-API + design-doc updates in the *same* PR) is **BLOCK** severity and now has no
dedicated agent — it relies on `implementer` doing it inline. Confirm the implementer contract
actually enforces same-PR doc updates, or autonomous PRs will trip a BLOCK code that no agent
owns end-to-end.

---

## Top 3 Recommendations

1. **Verify before trusting (F1+F2+F5)** — enable a conservative `autonomy` block on a
   low-risk campaign and run it end-to-end, confirming all four T3 criteria *and* the async
   veto comment. Effort: 1 campaign run + observation. This is the gate between "built" and
   "usable".
2. **Turn it on, conservatively (F2)** — add the `autonomy` block to the live campaign config
   with `brainstorm_routing: false`. Effort: config edit. Without this the manual→autonomous
   conversion the user wants does not happen at all.
3. **Close the guardrail-parity gap (F4)** — run `prj-mercure-sync` backlog mode and port the
   autonomous-quality-relevant codes first (`V-CHOICE-01`, `V-PAT`, `V-DELEG`). Effort: 1 sync
   run + N port issues. This is what keeps autonomous output at mercure quality.

## What to (optionally) copy from mercure — and what not to

- **Keep zero runtime dependency.** The one-way concept port + repo-convention-precedence
  detector (ADR-012 E1, `doc-governance.md:46-69`) is the correct standalone-but-synergistic
  design. Do not introduce a mercure package dependency.
- **Copy next (via sync, into blackhole's own `src/`)**: the missing quality-guardrail V-codes
  (F4) and the `hard-choice-protocol` behavioral rule that backs `V-CHOICE-01`.
- **Already copied — no action**: the interview/confidence model (`confidence-gates.md` is
  verbatim from mercure `interview`), doc-governance schema, and the core V-code families.
- **Do not copy**: mercure's named workflow chains / `## After Completion` click-gates — they
  conflict with blackhole's frozen phase enum and its async control plane (binding constraint,
  [[autonomous-thinking-routes-initiative]]).

## Note on related prior audits

`autonomous-workflow-parity.md` and `mercure-companion-files-gap-analysis.md` predate ADR-010
and are substantially stale (ADR-010 closed most of R1/R2/R4b/R5). This assessment supersedes
their current-state conclusions; the live parity ledger is `mercure-parity-matrix.md`.

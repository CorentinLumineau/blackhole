---
type: research
status: current
created: 2026-09-04
last_updated: 2026-09-04
review_trigger: "on file change"
issue: 469
confidence: 86
computed_at_revision: 1
---

## Executive Summary

Issue #469 asks blackhole to route **reasoning effort** (thinking budget / inference-depth parameter) at spawn time alongside the existing **model tier** spine in `src/references/model-routing.md`. Turn-10 research confirms the issue body's core diagnosis and recommended **tier-folding** design:

1. **Gap is real and repo-wide.** `model-routing.md` governs exactly one spawn dimension (`model` / tier). A targeted grep of `src/` for `reasoning`, `reasoning_effort`, `thinking.effort`, and `thinking budget` finds zero routing logic — only unrelated prose (`review-core.md`, `reviewer.md`) and the Pareto `effort` scoring field in `worker-schemas.md` (lines 113, 136, 508, 666 — **not** this issue's concern).

2. **"Provider default" is not an implementable acceptance target.** Nothing in `src/` or `documentation/` records any provider's default reasoning-effort value. Blackhole's closest analogue — `worker_model_policy: inherit` — explicitly means *parent-session* inheritance via parameter omission (`model-routing.md:11-15`), not a provider baseline. The PR must resolve open question 1 as either **(a)** an explicit, documented per-harness/tier baseline, or **(b)** parameter omission labelled *session inheritance* — never the unqualified phrase "provider default."

3. **Unpinned-spawn effort behavior is harness-dependent and largely unverified in-repo** — but external harness docs now supply enough evidence to partially resolve open question 2. The model dimension's non-inheritance on background Workflow `agent()` calls (`model-routing.md:139-144`) is stated in-repo; effort has **no equivalent statement**. External evidence shows: Claude Code subagents overwhelmingly inherit the parent session's effort/thinking state; Cursor encodes effort inside the `model` string (slug suffix or bracket syntax); Codex exposes a separate `reasoning_effort` spawn field but hides it from default tool schemas and couples it to `fork_turns` semantics. **No harness documents a stable, tier-independent "default effort" table blackhole could cite verbatim.**

4. **Tier-folding remains the winning design** (`V-INT-03`, `V-YAGNI-01`). Cursor already couples effort to tier slugs (`grok-4.5-fast-xhigh`, `claude-sonnet-5-thinking-high` at `model-routing.md:78-79`). A parallel effort axis would roughly double the 9-row base + 6-row bump surface already restated at six citation sites. Implementation should extend § Harness tier ladders with three effort defaults (`economy`/`standard`/`premium`), reuse the existing resolution algorithm unchanged, and extend the single spawn-footer log line.

5. **Per-harness effort control surfaces differ materially** — a single abstract `EFFORT: low` directive cannot map 1:1 without harness-specific translation tables. Cursor: bracket syntax on `model` (`claude-opus-5[effort=high]`, per [Cursor subagents docs](https://cursor.com/docs/subagents.md#model-parameters)) or effort baked into slug strings. Claude Code: documented `effort:` frontmatter on subagent files, but `agent()` / Workflow `agent()` opts lack `effort` (GitHub #68042, #67647); session settings often override frontmatter (#64706). Codex CLI: runtime `reasoning_effort` on `spawn_agent` works but is schema-hidden by default (#26948, #32031); TOML config uses `model_reasoning_effort`. Antigravity/Gemini and skills.sh-generic: no effort parameter documented in blackhole's ladder; skills.sh row already falls back to `inherit` semantics for model (`model-routing.md:113-118`) — same fallback likely applies to effort but is untested.

6. **Blackhole's `V-AGENT-01` frontmatter ban** (`scripts/checks/agents.check.ts:87`) and non-portable frontmatter across build targets (`scripts/lib/build/content.ts:168-176`, skills.sh strips frontmatter) reinforce that routing stays spawn-time in `model-routing.md`, not per-agent frontmatter — consistent with the issue's proposed direction.

7. **Live drift note:** issue body cites `VCODE_TABLE_ROW_COUNT = 62`; current tree has `72` (`scripts/lib/build/facts.ts:31`). No new V-code is required unless a genuinely new enforceable obligation emerges; tier-folding is primarily documentation + spawn-checklist surface.

**Confidence 86:** codebase claims are verified against the working tree; harness behavior claims cite primary harness docs and recent GitHub issues but acknowledge active bugs and schema-visibility regressions that make runtime behavior non-deterministic across harness versions.

## Findings

### F1 — Current routing surface is model-only (confirmed)

| Surface | Location | Finding |
|---------|----------|---------|
| Policy knob | `model-routing.md:8-15` | `worker_model_policy` has two values (`cost-optimized`, `inherit`); absent ⇒ `cost-optimized`. No effort-shaped policy field. |
| Resolution algorithm | `model-routing.md:17-27` | Three steps: read policy → resolve tier → pick cheapest slug. No effort step. |
| Base tier matrix | `model-routing.md:39-49` | 9 role rows — reusable signal input for tier (not a separate effort axis). |
| Route bumps | `model-routing.md:51-62` | 6 bump rows, max-wins. All express "more capable tier," none "same model, more thinking." |
| Tier ladders | `model-routing.md:68-119` | Per-harness slug tables; Cursor rows already embed effort qualifiers in slug strings (`:78-79`). |
| Spawn footer | `model-routing.md:131-136` | Single line: `MODEL_TIER: … \| slug: …`. No effort field. |
| Workflow pin table | `model-routing.md:139-162` | Pins `agentType` + `model` only. Background non-inheritance stated for **model** only (`:142-144`). |
| Spawn checklist | `model-routing.md:164-173` | 6 items, all model-only. |
| Config template | `config-template.md:26,72` | `worker_model_policy` is a flat top-level string — precedent for any future effort policy knob. |
| Agent frontmatter | `agents.check.ts:87` | `model:` blocked (`V-AGENT-01`). No check exists for effort keys under `scripts/checks/`. |
| Build portability | `content.ts:41-60,168-176` | Codex serializer has dead `model:` branch; Claude/Gemini/Cursor preserve frontmatter; skills.sh strips it. |
| Citation sync tax | 6 sites per issue body | `orchestrator-delegation.md:25-43`, `orchestrator-dispatch.md:153+`, `campaign-prompt.md:81-92`, `multitask-mode.md:53`, `claude-code-native.md:74`, `config-template.md:72`, `review-core.md:178+`. Condensed tables at `orchestrator-delegation.md:36-40` need SSOT-pointer treatment or coordinated update. |

### F2 — Terminology collision with V-PARETO-02 `effort` (confirmed)

`worker-schemas.md` uses `effort` as a 1–10 integer in `Priority = gain * (11 - effort)` for issue filing and hunt findings (`:113-136`, `:508-512`, `:666-702`). `config-template.md:58` documents `kaizen.min_priority` against this same field. Any `model-routing.md` addition must include an explicit one-sentence disambiguation per acceptance criterion — grepping `effort` alone returns ~40 Pareto hits, zero reasoning-effort routing hits.

### F3 — Open question 1: "Provider default" is refuted as an implementable target

**Evidence for refutation:**

- No file under `src/` or `documentation/` states a provider's default reasoning-effort for any model, tier, or harness.
- `worker_model_policy: inherit` (`model-routing.md:11-15`) defines omission semantics as inheriting the **parent session** model — a deliberate, documented behavior that is *not* "provider baseline."
- Issue comment (filed 2026-08-06) records independent verifier refutation of the original "match provider default" framing.

**Implementable alternatives (issue body AC already requires picking one):**

| Option | Mechanism | Precedent in repo |
|--------|-----------|-------------------|
| **(a) Explicit documented baseline** | Per-harness/tier effort value in § Harness tier ladders | Mirrors how tier slugs are already enumerated per harness |
| **(b) Session inheritance via omission** | Do not set effort parameter; document as inheriting parent session | Mirrors `worker_model_policy: inherit` semantics for model |

**Uncertainty:** even option (a) requires the implementer to *choose* values — no external "provider default" table exists to copy. Calibration with one-line tier rationale is a plan/implementation task, not a research gap.

### F4 — Open question 2: Unpinned spawn effort behavior (partially resolved with citations)

#### In-repo evidence

- **Model on background Workflow spawns:** explicitly does **not** inherit session model (`model-routing.md:142-144`). Orchestrator must pin `model` on every `agent()` call.
- **Effort on any spawn:** **no in-repo statement.** The inference "subagents inherit session effort" is unverified within `src/`.

#### Harness-primary-source evidence

| Harness | Effort control surface | Unpinned / inherit behavior | Stability |
|---------|----------------------|----------------------------|-----------|
| **Cursor** | Encoded in `model` field: slug suffix (`-thinking-high`, `-xhigh`) or bracket params `model: claude-opus-5[effort=high]` ([subagents docs § Model parameters](https://cursor.com/docs/subagents.md#model-parameters)) | `model: inherit` is documented default for subagents — subagent uses parent model (and implicitly parent's effort encoding). Parent `Task` `model` param can override frontmatter; known bugs where parent overrides subagent `model`/`fast` settings ([forum #160840](https://forum.cursor.com/t/sub-agent-model-being-ignored-and-premium-models-being-erroniously-used-for-subagents/160840), [#163645](https://forum.cursor.com/t/subagent-model-choice-not-respected/163645)). CLI `--model` flag does not parse bracket params per forum #163645. | Effort is not a separate parameter — it travels with slug/brackets. Tier-folded design aligns naturally. |
| **Claude Code** | Documented `effort:` in subagent `.md` frontmatter (`low`/`medium`/`high`/`xhigh`/`max` per #43083); **not** in `agent()` opts (#68042: opts are `label`, `phase`, `schema`, `model`, `isolation`, `agentType` only) | Subagents inherit parent session thinking on/off and effort level (#67647, #64706). Frontmatter `effort:` frequently ignored — session `effortLevel` / `MAX_THINKING_TOKENS` wins (#64706). Workaround: empty custom agent files pinning model+effort (#68042). | **Unstable across versions** — open bugs on frontmatter honor, thinking/effort coupling (#67647: `effort: xhigh` + inherited `thinking: disabled` → API 400). |
| **Codex CLI** | Runtime `reasoning_effort` on `spawn_agent` (#26948); config/TOML field `model_reasoning_effort` for custom agent roles | Default v2 schema hides `model` and `reasoning_effort` (`hide_spawn_agent_metadata` defaults true, #32031). Omitted `fork_turns` defaults to full-history fork which **rejects** overrides (#32031, #32674). `fork_turns: "none"` required for fresh specialist with explicit effort. Custom `agent_type` can discard explicit overrides (#32831, partially fixed). | Runtime capability exists but discoverability and fork-semantics make unpinned behavior non-obvious. |
| **Antigravity / Gemini** | Blackhole ladder lists model families only (`model-routing.md:104-112`); premium row mentions "highest thinking tier" but no effort parameter | No spawn-API documentation in `src/`. | Unknown — out of scope for numeric calibration in this research pass. |
| **skills.sh / generic** | No fixed slug list; maps tiers to harness-documented reasoning tiers (`model-routing.md:116-117`) | When harness exposes no model override, `inherit` applies automatically (`:117-118`). Effort likely follows same fallback but **untested**. | Inherit-by-default is the only defensible doc statement. |

**Conclusion for AC open question 2:** blackhole can satisfy the AC by citing harness-primary sources above and recording that effort inheritance is **harness-specific, version-sensitive, and in several cases buggy** — not a single uniform "inherits session effort" rule. The Workflow-tool pin table should treat effort consistently with model: **pin explicitly on background `agent()` calls** wherever the harness exposes a controllable surface; on Cursor that means the resolved slug/bracket string, not a separate field.

### F5 — Open question 3: Provider default stability across tiers/harnesses (resolved: no)

Reasoning-effort defaults are **not stable** across tiers or harnesses:

- Cursor expresses effort as part of the model identifier, not a global default.
- Claude Code couples effort to thinking on/off state at the session level (#67647).
- Codex separates `reasoning_effort` (spawn) from `model_reasoning_effort` (TOML) with fork-context inheritance rules (#26948, #32031).
- Allowed value vocabularies differ: Claude `low|medium|high|xhigh|max`; Cursor bracket `effort=high` (model-dependent); Codex `low|medium|high|xhigh` (per issues).

Blackhole should document per-harness applicability and allowed values in § Harness tier ladders rather than assuming a portable enum.

### F6 — Open question 4: skills.sh / generic harness scope

`model-routing.md:113-118` already defers to installing-harness tiers with `inherit` fallback for model. Research finds no counter-evidence that effort would behave differently — but also no positive test. **Recommendation:** document effort as `inherit` (session) on skills.sh-generic, same as model, with an explicit "unverified" flag until a harness test exists. No numeric calibration for this ladder row.

### F7 — Tier-folding design validation (confirmed)

| Criterion | Evidence |
|-----------|----------|
| Existing precedent couples effort to tier slug | `model-routing.md:78-79` — Cursor slugs embed effort |
| Parallel axis doubles sync surface | 9 base + 6 bump rows + 6 citation sites + `orchestrator-delegation.md` condensed table |
| No signal asks for decoupling | All 6 bump rows are tier bumps; none request "same tier, more thinking" |
| V-INT-03 (no third variant) | Separate effort resolution pass would be a third variant of solved tier-routing concern |

**Proposed doc shape (for planner consumption, not implementation):**

```
| Tier | Model slug | Default effort (harness-native) | Rationale |
```

Three effort defaults total across tiers; resolved effort follows tier from existing algorithm. Spawn footer becomes:

```
MODEL_TIER: standard | slug: claude-sonnet-5-thinking-high | effort: high
```

(where `effort` on Cursor may be implicit in `slug` — footer should record the logical effort value even when encoded in slug, for cost audit).

### F8 — Workflow-tool enforcement extension

`model-routing.md:139-144` establishes that background `agent()` calls must pin `model` because session model is not inherited. By analogy, wherever a harness exposes effort as a separately settable spawn parameter (Codex `reasoning_effort`), it should be pinned too. On Cursor, pinning the correct slug/bracket string *is* pinning effort. On Claude Code, until `agent()` gains `effort` (#68042), the only reliable pin may be a custom subagent stub — **blackhole should document this limitation** rather than pretend spawn-time effort routing is enforceable on Claude Code Workflow fan-out today.

### F9 — Config knob (optional)

If added, mirror flat `worker_model_policy` pattern (`config-template.md:26,72`) — e.g. `worker_effort_policy: cost-optimized | inherit` — with absent field preserving today's behavior (no effort routing). Nested-block precedent (`docs_governance`, `kaizen`) exists but issue body prefers flat field for consistency with model policy.

### F10 — Implementation surface constraints (confirmed)

| Constraint | Source |
|------------|--------|
| Hand-edit `src/` only; regenerate build outputs | Issue body; `content.ts:128-133` generated markers |
| `VCODE_TABLE_ROW_COUNT` currently `72` | `facts.ts:31` (issue body stale at 62) |
| No new check for effort today | `scripts/checks/` grep: zero matches |
| 6 citation sites must be re-read on change | See F1 table |
| Security review required on route | `queue.json` issue 469 `route.security_review_required: true` |

### F11 — Suggested per-tier effort calibration axes (for planner — not prescriptive values)

Planner should calibrate three tier defaults using these axes (one-line rationale each, per AC):

| Tier | Task character | Cost posture |
|------|---------------|--------------|
| `economy` | Classification, read-only scan (`router`, `investigator`) | Minimize thinking tokens; errors are cheap to retry |
| `standard` | Structured planning, TDD, review | Balanced; default workhorse |
| `premium` | Security review, design, XL implementation | Maximize correctness over token cost |

Concrete harness-native values (e.g. Cursor `effort=low` vs slug without `-thinking-high`) remain an implementation calibration task — research deliberately does not invent numbers where harness applicability differs.

## Sources

### In-repo (verified against working tree 2026-08-12)

| ID | Location | Claim |
|----|----------|-------|
| R1 | `src/references/model-routing.md` | Full model-routing SSOT — no reasoning-effort dimension |
| R2 | `src/references/config-template.md:26,72` | `worker_model_policy` flat field pattern |
| R3 | `scripts/checks/agents.check.ts:87` | `V-AGENT-01` blocks `model:` in agent frontmatter |
| R4 | `scripts/lib/build/content.ts:41-60,168-176` | Build target frontmatter portability |
| R5 | `scripts/lib/build/facts.ts:31` | `VCODE_TABLE_ROW_COUNT = 72` (live) |
| R6 | `src/references/worker-schemas.md:113-136` | Pareto `effort` scoring field (distinct from reasoning effort) |
| R7 | `src/references/orchestrator-delegation.md:22-43` | Condensed tier table citing model-routing SSOT |
| R8 | `src/references/campaign-prompt.md:81-92` | Spawn `model` resolution from model-routing |
| R9 | `.blackhole/queue.json` issue 469 `route.revision: 1` | `needs_research: true`, `plan_mode: full`, `security_review_required: true` |
| R10 | GitHub issue #469 body + comment | Problem statement, adversarial verification, acceptance criteria |

### External — harness primary sources

| ID | Source | Claim |
|----|--------|-------|
| E1 | [Cursor subagents docs — Model parameters](https://cursor.com/docs/subagents.md#model-parameters) | Effort set via `model` bracket syntax `claude-opus-5[effort=high]`; `inherit` default |
| E2 | [Cursor forum #163645](https://forum.cursor.com/t/subagent-model-choice-not-respected/163645) | `composer-2.5` without brackets may silently use fast variant; bracket syntax is workaround |
| E3 | [Cursor forum #160840](https://forum.cursor.com/t/sub-agent-model-being-ignored-and-premium-models-being-erroniously-used-for-subagents/160840) | Parent Task `model` can override subagent frontmatter |
| E4 | [Claude Code #68042](https://github.com/anthropics/claude-code/issues/68042) | Workflow `agent()` opts lack `effort`; custom subagent stubs are current workaround |
| E5 | [Claude Code #67647](https://github.com/anthropics/claude-code/issues/67647) | Subagents inherit parent thinking state; effort/thinking coupling causes API errors |
| E6 | [Claude Code #64706](https://github.com/anthropics/claude-code/issues/64706) | Frontmatter `effort:` ignored; session `effortLevel` wins |
| E7 | [Claude Code #43083](https://github.com/anthropics/claude-code/issues/43083) | Documented effort vocabulary `low\|medium\|high\|xhigh\|max`; CLI `--effort` workaround |
| E8 | [Codex #26948](https://github.com/openai/codex/issues/26948) | Runtime `reasoning_effort` on spawn works; distinct from TOML `model_reasoning_effort` |
| E9 | [Codex #32031](https://github.com/openai/codex/issues/32031) | Default schema hides overrides; `fork_turns` omission rejects overrides |
| E10 | [Codex #32831](https://github.com/openai/codex/issues/32831) | Custom `agent_type` can discard explicit spawn overrides |

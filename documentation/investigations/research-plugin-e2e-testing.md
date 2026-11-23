---
type: research
summary: "Research for #1244: how agent harnesses and eval frameworks (claude plugin eval, claude -p stream-json, Codex/Cursor CLIs, Inspect, SWE-bench, tau-bench pass^k) test LLM plugins end to end, a five-tier architecture for blackhole, a units-by-tiers coverage matrix measured from its own registries (V-codes, hook pattern ids, worker statuses, queue transitions, build trees), and hook replay/fuzz guidance"
status: current
created: 2026-11-17
last_updated: 2026-11-17
review_trigger: "on file change"
issue: 1244
confidence: 75
computed_at_revision: 0
---

# Research: end-to-end behaviour testing for the blackhole plugin (issue #1244)

`computed_at_revision: 0`: issue #1244 had no `route` entry in `.blackhole/queue.json` when this
note was written, so no `route.revision` could be read.

## Executive Summary

The field has settled on a layered answer. No single tool tests an LLM plugin end to end.

1. **Deterministic layers carry most of the coverage.** They cover scripts, state transitions,
   forge writes and hooks, and they run with no model.
2. **A thin, repeated, cost-capped live layer measures the model-dependent part.** It answers
   whether the prompts make the agent do the right thing reliably.

Anthropic's own guidance says to prefer code graders, then model graders, then humans, and to
grade outcomes rather than exact paths. It also says regression evals should sit near 100%,
capability evals should start low, and every trial should start from a clean environment
([Anthropic, Demystifying evals](https://anthropic.com/engineering/demystifying-evals-for-ai-agents)).

Claude Code now ships a first-party behaviour-test runner, `claude plugin eval`
([plugin evals docs](https://code.claude.com/docs/en/plugin-evals)). Its features:

- cases written as a prompt plus graders;
- 3 runs per case by default;
- a no-plugin baseline arm, so the score shows what the plugin itself adds;
- MCP mocks with recorded replay;
- a `--max-cost-usd` ceiling;
- an OS sandbox whenever Bash is granted.

That runner fits blackhole's **skill-triggering and single-agent** behaviour. It cannot replay a
multi-turn, multi-agent campaign against a forge. That part needs a home-grown deterministic
scenario harness.

**Recommended architecture: five tiers.** The issue body proposes three; tiers 3 and 5 below
split those further.

| Tier | Runs | LLM | What it proves |
|---|---|---|---|
| T0 Static | every PR | no | The existing `bun run verify` (64 `scripts/checks/*.check.ts`) |
| T1 Unit | every PR | no | The existing 213 `scripts/**/*.test.ts` files |
| T2 Scenario harness | every PR | no | The campaign chain end to end, with scripted worker returns, a fake forge and golden state |
| T3 Hook replay and fuzz | every PR | no | Every PreToolUse pattern has a positive and a near-miss case. A real-call corpus replays with no unexplained verdict flips. Metamorphic fuzz finds no deny-to-allow flips |
| T4 Harness load | every PR | no* | Each of the four build trees loads in its harness, and its agents, skills and hooks are discoverable |
| T5 Live agent evals | nightly or release | yes | `claude plugin eval` per agent and skill (pass^k, baseline Δ), plus one sandboxed headless mini-campaign with outcome-only assertions |

\*T4's Claude leg can check `system/init` → `plugins`/`plugin_errors` from a `claude -p
--plugin-dir` run ([headless docs](https://code.claude.com/docs/en/headless)). That run makes
one model call, unless the check is done offline from the build output, as
`verify.cursor-harness.test.ts` already does for Cursor.

## Findings

### 1. How harnesses and frameworks test agents and plugins

**Claude Code headless, `claude -p`** ([docs](https://code.claude.com/docs/en/headless))

- `--output-format stream-json` emits NDJSON events. The first is `system/init`, which lists
  `plugins` and `plugin_errors`. The last is a `result` message carrying cost and session
  metadata.
- Subagent messages carry `parent_tool_use_id`, so the full agent tree can be rebuilt from the
  stream. Passing `--forward-subagent-text` adds their text as well.
- `--bare` skips host hooks, plugins and CLAUDE.md, so a run behaves the same on every machine.
  The plugin under test is then loaded explicitly with `--plugin-dir`.
- `--json-schema` constrains the final output to a given schema.
- `--permission-prompts none` combined with stream-json reports each denial as a
  `permission_denied` event.
- The docs recommend `--bare` for CI.

All of this is enough to drive a sandboxed mini-campaign and assert on its tool-call stream.

**`claude plugin eval`** ([docs](https://code.claude.com/docs/en/plugin-evals))

- Each case is `evals/<case>/prompt.md` plus `graders/*.md`, or a `case.yaml`.
- Six grader types exist: `regex`, `tool_used`, `tool_order`, `file_exists` (all free), and
  `llm` and `baseline` (both judge calls). There are no custom-code graders.
- `--runs` defaults to 3. `--threshold` defaults to 1.0. `--model` pins the agent model, and
  `--judge-model` picks the judge.
- `--ablation with-without` runs the no-plugin baseline arm.
- `--max-cost-usd` caps spend: when it is exhausted the command exits 2.
- `context.scaffold_script` seeds a fixture git repo. `context.history_file` resumes a recorded
  transcript.
- MCP tools can be mocked, and agent-mock answers are recorded into `mocks/.replay/` for
  deterministic replay.
- Granting Bash runs every case under the OS sandbox.
- The docs warn that `llm` graders drift more on long text. Their advice is to grade long files
  with `regex` and to pair one outcome grader with one `tool_used` grader per case.
- Static manifest checking is a separate command, `claude plugin validate`
  ([plugins CLI reference](https://code.claude.com/docs/en/plugins-reference)).

**Agent SDK**

- The SDK exposes the same loop programmatically, adding tool-approval callbacks and native
  message objects ([headless docs](https://code.claude.com/docs/en/headless)).
- Hooks, PreToolUse included, can be registered in code
  ([Agent SDK hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)).
- This is the route to an in-process test harness that intercepts tool calls without a shell
  shim.

**Codex CLI** ([non-interactive docs](https://learn.chatgpt.com/docs/non-interactive-mode))

- `codex exec --json` emits JSONL events: `thread.started`, `turn.*`, `item.*` (command
  executions, file changes, MCP tool calls) and `error`.
- `--sandbox read-only|workspace-write|danger-full-access` sets the sandbox level.
- `--output-schema` constrains the final output to a schema.
- `--ephemeral`, `--ignore-user-config` and `--ignore-rules` give hermetic runs.

**Cursor CLI** ([output-format docs](https://cursor.com/docs/cli/reference/output-format))

- `--print --output-format stream-json` emits `system/init`, `assistant`,
  `tool_call` `started`/`completed` events paired by `call_id`, and a terminal `result`.
- All three CLIs therefore expose a tool-call event stream. One normaliser can turn each into a
  common trajectory record for T4 and T5. This is an inference from the three docs; no
  cross-harness tool is known to do it today.

**Inspect AI, from UK AISI** ([sandboxing](https://inspect.aisi.org.uk/sandboxing.html))

- Sandboxes run per sample, on Docker, Kubernetes or local.
- Tools and scorers run in the eval process; only the sandbox calls run in the container.
- This is the reference design for "clean environment per trial".

**SWE-bench harness** ([harness reference](https://www.swebench.com/SWE-bench/api/harness))

- Each task runs in its own Docker image.
- A task passes when its `FAIL_TO_PASS` tests now pass and its `PASS_TO_PASS` tests still pass.
- This is an outcome-only grading model. A blackhole live smoke can borrow it directly: the
  seeded issue's hidden test turns green and the repo's existing tests stay green.

**Terminal-Bench** ([about](https://www.tbench.ai/about), [paper](https://arxiv.org/abs/2601.11868))

- Each task is a container with a verifying test script.
- This is the same outcome-graded, containerised pattern.

**τ-bench** ([paper](https://arxiv.org/abs/2406.12045))

- τ-bench introduced pass^k, the probability that all k trials succeed.
- It reported state-of-the-art agents at pass^8 < 25% in retail.
- The lesson: a single green run says little about the reliability of a multi-step agent.

**promptfoo** ([assertions](https://promptfoo.dev/docs/configuration/expected-outputs/deterministic))

- Deterministic trajectory assertions: `trajectory:tool-used`, `trajectory:tool-args-match`,
  `trajectory:tool-sequence`, `trajectory:step-count`.
- Also `tool-call-f1` and `skill-used`.

**LangSmith trajectory evals** ([docs](https://docs.langchain.com/langsmith/trajectory-evals))

- Four match modes, `strict`, `unordered`, `subset` and `superset`, plus an LLM-judge mode.
- `superset` means "at least these calls", and `subset` means "nothing outside the allowed
  set". Together they express safety invariants without pinning the path.

**DeepEval** ([tool correctness](https://deepeval.com/docs/metrics-tool-correctness))

- Ships a Tool Correctness metric and an LLM-judged Task Completion metric.

**LangChain unit testing** ([unit testing](https://docs.langchain.com/oss/python/langchain/test/unit-testing),
[GenericFakeChatModel](https://reference.langchain.com/python/langchain-core/language_models/fake_chat_models/GenericFakeChatModel))

- Recommends a scripted fake chat model, which returns a fixed sequence of messages and tool
  calls, for deterministic unit tests of agent control flow.
- This is the direct analogue of blackhole's existing `fixtures/worker-json/*.json` scripted
  worker returns.

### 2. Techniques: fit for blackhole

| Technique | Fit | Why |
|---|---|---|
| **Scripted fake model or worker returns** ([LangChain](https://docs.langchain.com/oss/python/langchain/test/unit-testing)) | **Strong** (T2) | Blackhole's agents already return schema-validated JSON (`scripts/validate-worker-json.ts`, `fixtures/worker-json/`). The orchestrator's scripted steps can be driven with these in place of live agents. That is exactly the deterministic seam the issue's tier 1 needs |
| **Fake forge through a PATH shim** | **Strong** (T2) | Every forge CLI call funnels through `spawnSync` (`scripts/lib/forge-adapter/spawn.ts`, with `gh`/`tea`/`glab` adapters beside it). A shim `gh` on `PATH` that serves canned JSON and appends each write to a log needs no production-code change. A local bare git repo stands in for `origin` |
| **Real forge in Docker (Gitea)** ([Gitea docker docs](https://docs.gitea.com/installation/install-with-docker-rootless)) | **Medium** (T5, contract checks) | Blackhole supports `tea` (ADR-027), so a real Gitea container exercises a full forge with no GitHub account. Use it for a periodic contract test that the shim's canned responses still match a real forge. It is too heavy for every PR, and a cloud session may lack Docker |
| **Golden files** | **Strong for deterministic output only** | Good for `queue.json`, the ledger, status datasets and the forge-write log from T2, after normalising timestamps and ids. Bad for live LLM transcripts, which change on every run |
| **Record and replay of model HTTP (cassettes)** ([vcrpy](https://github.com/kevin1024/vcrpy)) | **Weak** | Blackhole has no model client of its own; the harness makes the model calls. Harness requests also embed volatile context (paths, reminders, versions), so request matching breaks. Replay belongs at the tool-return boundary instead: T2 scripted returns and plugin-eval `mocks/.replay/` ([docs](https://code.claude.com/docs/en/plugin-evals)) |
| **Trajectory or tool-call assertions** ([LangSmith](https://docs.langchain.com/langsmith/trajectory-evals), [promptfoo](https://promptfoo.dev/docs/configuration/expected-outputs/deterministic)) | **Strong for invariants, weak for paths** | Anthropic advises grading outcomes, not exact sequences ([source](https://anthropic.com/engineering/demystifying-evals-for-ai-agents)). Use `subset` and `superset`-style invariants for the safety rules: never push to `main`, a PR body contains `Closes #N`, nothing written outside the worktree, the reviewer never edits code. Avoid `strict` sequences |
| **LLM-as-judge with rubrics** ([MT-Bench paper](https://arxiv.org/abs/2306.05685)) | **Narrow** | The paper documents position, verbosity and self-enhancement biases. Use a judge only for prose quality (plan completeness, review-finding validity). Write the rubric as concrete PASS/FAIL conditions, give the judge an "unknown" exit, use one judge per dimension, and calibrate against hand labels ([Anthropic](https://anthropic.com/engineering/demystifying-evals-for-ai-agents), [plugin evals](https://code.claude.com/docs/en/plugin-evals)) |
| **pass@k / pass^k with a flakiness budget** ([τ-bench](https://arxiv.org/abs/2406.12045)) | **Strong** (T5) | Report pass^k for safety invariants, where every run must hold, and pass@k or a mean score for capability. A release gate states k and the threshold per case. A case with a known flake rate gets an explicit budget rather than silent retries |
| **Mutation testing of prompts** ([LLMorpheus](https://arxiv.org/abs/2404.09952), [Meta mutation-guided tests](https://arxiv.org/abs/2501.12862)) | **Medium, occasional** | The idea transfers: delete or invert one gate sentence in an agent prompt (for example `reviewer.md`'s proportionality gate), then check that some T5 case fails. This measures suite adequacy, not plugin correctness. It costs a full T5 run per mutant, so run it on a sample, quarterly. `V-GATE-01` is the existing static analogue. Applying mutation testing to prompts is an extrapolation; no source above evaluates it for agent prompts |
| **Prompt-format sensitivity** ([FormatSpread](https://arxiv.org/abs/2310.11324)) | **Medium** | Shows large swings in accuracy from formatting-only prompt changes. That argues for metamorphic checks (reworded issue text should give the same route) and against trusting a single phrasing |
| **Property-based and metamorphic tests** ([fast-check model-based testing](https://fast-check.dev/advanced/model-based-testing.md), [LLMorph, ASE 2025](https://conf.researchr.org/details/ase-2025/ase-2025-tool-demonstration-track/34/LLMorph-Automated-Metamorphic-Testing-of-Large-Language-Models)) | **Strong for code, medium for agents** | For T2, use fast-check model-based testing: random command sequences (ingest, route, merge, park, resume) against a reference model of the queue state machine. For T3, use metamorphic shell rewrites. For T5, use metamorphic issue rewordings with the same expected outcome |
| **Containers and sandboxes per trial** ([Inspect](https://inspect.aisi.org.uk/sandboxing.html)) | **Strong** (T5) | One fresh temp repo, bare remote and fake forge per scenario. `claude plugin eval` already sandboxes Bash |
| **Cost control** | **Required** | Use `--max-cost-usd`, pin `--model`, run `--ablation none` while iterating, and read cost from `total_cost_usd` in the JSON result ([plugin evals](https://code.claude.com/docs/en/plugin-evals), [headless](https://code.claude.com/docs/en/headless)). Keep T5 off the per-PR path |

### 3. What "full coverage" can mean, and how to measure it mechanically

No source above defines coverage for an LLM plugin. The definition below is synthesised from
blackhole's own registries; each unit has an SSOT that a check can enumerate. Coverage is a
**matrix of units × test tiers**, recorded in a generated `coverage-matrix.json`. A ratchet
baseline may only shrink, on the same model as the existing `coverage-regression.check.ts`.

| Unit | Enumerated from (SSOT) | Covered when | Measured by |
|---|---|---|---|
| Script line and function coverage | `scripts/**/*.ts` | Line coverage meets the floor, with no regression | Existing `coverage-regression.check.ts` (V-TEST-09) |
| V-code | `src/references/blackhole-vcodes.md` rows | At least one T2/T3/T5 case **triggers** it, and one near-miss case does not | Cases declare `covers: [V-…]`. The check diffs that against the table, the way `audit-modules.check.ts` diffs reviewer modules |
| Hook pattern | `templates/hooks/pretooluse/patterns/{bash,file}-patterns.json` ids (19 bash `id`s and 26 file `id`s at this commit) plus the guard modules in `utils/` | At least one deny and one allow near-miss case per id | The replay runner records the `pattern_id` from the hook-event output (records already carry `pattern_id`, e.g. `.blackhole/hook-events/*.json`) |
| Agent decision point | Status enums per role in `worker-schemas.md`, plus `route` flags (`route-shape.check.ts` already parses them) | Each (role, status) and each route-flag branch is exercised by a scripted return in T2. Each agent has at least one T5 case | The T2 runner logs which fixture statuses it consumed |
| Campaign transition | The `QUEUE_STATUSES`/`QUEUE_PHASES` state machine (`scripts/lib/campaign-status/queue.ts`) | Every legal edge is taken in some scenario, and illegal edges are rejected | Model-based fast-check plus an edge log |
| User-visible behaviour | A new scenario catalog, analogous to invest's user-story catalog | Each behaviour has one T2 scenario. Safety-critical ones also get a T5 case | Catalog-to-scenario id check |
| Harness target | `COMMITTED_TARGET_TREES` (`paths.ts`, V-TREE-01) | Each tree passes T4. Each harness the plugin claims has a T5 smoke | `tree-registry.check.ts`-style diff |
| Script CLI entrypoint | `scripts/*.ts` with `main` | Invoked at least once by T2 | Spawn log in the T2 runner |

"100%" should be claimed only per row, never as a single number. The LLM rows (T5) report
pass^k with a stated k and are never folded into the deterministic percentage.

### 4. Hook testing specifically

- **Existing assets.** About 8,300 lines of hook tests (`hooks-validate-bash.test.ts`, 5,363
  lines with about 324 cases; `hooks-validate-file.test.ts`, 2,111 lines). `verify.hooks.test.ts`
  checks that patterns compile and are wired. The per-pattern unit cases are already strong.
- **Gap.** No corpus of *real* calls is replayed, and there is no differential check between
  releases.
- **Real-call corpus.** Two sources exist:
  - `.blackhole/hook-events/*.json` (20 records at this commit), which carry `pattern_id`,
    `decision` and `detail`, the latter holding the command text;
  - Claude Code session transcripts (`~/.claude/projects/*.jsonl`), which hold every `Bash`,
    `Write` and `Edit` `tool_use` input.

  Mine both into a scrubbed, committed corpus. Paths and secrets need redacting, per
  `opportunistic-fix.md`'s secrets rule.
- **Replay.** Feed each record as PreToolUse stdin JSON to `validate-bash-command.js` and
  `validate-file-changes.js`. The input and output contract is in the
  [hooks reference](https://code.claude.com/docs/en/hooks).
- **Differential gate.** Compare verdicts between the base and head commits. Any flip must be
  listed in the PR as intended. This catches a "hook that denies a legitimate worker call",
  which the issue body names as a target.
- **Fuzzing.**
  - Generate shell commands from a grammar with fast-check: wrappers (`env`, `command`, `nohup`,
    `sudo -u`), subshells, brace groups, `eval`, quoting, redirects, `cd` chains.
  - Assert **metamorphic invariants**: wrapping or re-quoting a denied command never makes it
    allowed, and an allowed benign command stays allowed.
  - The documented F-00058..F-00065 bypass history in `blackhole-protocol.md` is exactly the
    bug class this finds.
  - Log any accepted residual (the known `xargs -I{}`/`find -exec` fail-open) as a fixture
    marked `expected: allow-knowingly`, so it stays visible.

### 5. Existing blackhole test assets and where each goes

| Asset | Count at `2c590fc6` | Tier |
|---|---|---|
| `scripts/checks/*.check.ts` run by `bun run verify` | 64 | T0 |
| `scripts/**/*.test.ts` (`bun test`) | 213 files, including `verify.*.test.ts` | T1 |
| `scripts/hooks-*.test.ts` and `verify.hooks.test.ts` | about 8,300 lines | T1, seeds T3 |
| `fixtures/worker-json/` (per-role, per-status worker returns) | many | Seeds T2 scripted agents |
| `fixtures/recovery/`, `fixtures/campaign-status/{empty,full}`, `fixtures/queue.example.json`, `fixtures/findings-ledger.example.json`, `fixtures/decision-parking`, `fixtures/staging` | multiple | Seed T2 initial states and goldens |
| `scripts/lib/forge-adapter/*` (github, gitea/tea, gitlab/glab, with tests) | 3 forges | T2 shim seam, T5 Gitea contract |
| `verify.cursor-harness.test.ts`, `agent-plugins-build.check.ts`, `claude-dist.check.ts`, `codex-build.check.ts` | present | T4 (partial) |
| `.blackhole/hook-events/*.json` | 20 | T3 corpus seed |

Nothing in the repo invokes `claude -p` or `--output-format` today (a grep of `scripts/` and
`src/` found no match), so T4's live leg and all of T5 are new.

## Main risks

1. **Non-determinism and flake (T5).** A single run is not evidence. Pin the model, set k
   explicitly, and give each case a stated flake budget; never retry silently.
2. **Cost.** The plugin-eval baseline doubles the runs, and judges add calls on top. Cap with
   `--max-cost-usd` and keep T5 off the per-PR path.
3. **Golden rot.** Goldens can get rubber-stamped on update. Normalise volatile fields, and
   require every golden diff to appear in the PR with a reason, the way the release-gate issue
   wants.
4. **Fake-forge drift.** The shim can drift from real `gh`/`tea` behaviour. Run a periodic
   contract test against a recorded real response set or a Gitea container.
5. **Model version vs plugin regression.** A model release can look like a plugin regression.
   Pin `--model`, and use the baseline Δ to tell them apart.
6. **Coverage gaming.** A declared `covers:` tag can be added without a meaningful assertion.
   Pair the tag with the existing V-TEST-10/11 integrity checks.
7. **Sandbox and credentials.** A live run needs a forge token. Use a throwaway sandbox repo or a
   local Gitea, never the real backlog.
8. **Upstream reconciliation.** Mercure's parallel effort (Gitea issue 981) cannot be reached
   from cloud sessions; reconcile the designs before the shared parts diverge.

## Sources

- https://anthropic.com/engineering/demystifying-evals-for-ai-agents
- https://code.claude.com/docs/en/plugin-evals
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/plugins-reference
- https://code.claude.com/docs/en/hooks
- https://platform.claude.com/docs/en/agent-sdk/hooks
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://cursor.com/docs/cli/reference/output-format
- https://inspect.aisi.org.uk/sandboxing.html
- https://www.swebench.com/SWE-bench/api/harness
- https://www.tbench.ai/about
- https://arxiv.org/abs/2601.11868
- https://arxiv.org/abs/2406.12045
- https://promptfoo.dev/docs/configuration/expected-outputs/deterministic
- https://docs.langchain.com/langsmith/trajectory-evals
- https://deepeval.com/docs/metrics-tool-correctness
- https://docs.langchain.com/oss/python/langchain/test/unit-testing
- https://reference.langchain.com/python/langchain-core/language_models/fake_chat_models/GenericFakeChatModel
- https://github.com/kevin1024/vcrpy
- https://arxiv.org/abs/2306.05685
- https://arxiv.org/abs/2404.09952
- https://arxiv.org/abs/2501.12862
- https://arxiv.org/abs/2310.11324
- https://fast-check.dev/advanced/model-based-testing.md
- https://conf.researchr.org/details/ase-2025/ase-2025-tool-demonstration-track/34/LLMorph-Automated-Metamorphic-Testing-of-Large-Language-Models
- https://docs.gitea.com/installation/install-with-docker-rootless
- Repo evidence: `/home/user/blackhole` at commit `2c590fc6` (paths cited inline)

Uncertainty, stated plainly:

- The cost and flake figures for a blackhole T5 run are unmeasured; no live run exists yet.
- The tree-wide counts are point-in-time and come from this checkout: 64 checks, 213 test
  files, 19 and 26 pattern ids, and 20 hook events.
- "Mutation testing of prompts" and the cross-harness trajectory normaliser are extrapolations
  from the cited techniques, not established practice.

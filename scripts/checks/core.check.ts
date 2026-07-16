import * as fs from 'fs';
import * as path from 'path';
import {
  AGENT_NAMES,
  PHASE_NAMES,
  PHASE_PLAYBOOK_FILES,
  REQUIRED_REFERENCES,
  VCODE_TABLE_ROW_COUNT,
} from '../build.ts';
import { walkFilesAbs } from '../lib/fs.ts';

// ADR-007 T5/R2' — core.check.ts is the catch-all domain: every check whose paired unit test
// already lived in verify.test.ts before this decomposition (the "catch-all taxonomy slot")
// moves here, including checkEpicRunbook (no dedicated verify.*.test.ts file exists for it —
// approved plan default: core).

const root = path.resolve(import.meta.dirname, '..', '..');
const srcDir = path.join(root, 'src');

export type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

export const listFiles = (dir: string, ext = '.md'): string[] => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith(ext));
};

// V-TOOLS-01: Deny-list tool policy — no tools: allowlist; correct disallowedTools per role
const checkAgentToolPolicy = (): CheckResult => {
  const agentsDir = path.join(srcDir, 'agents');
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  const errors: string[] = [];

  const denyMatrix: Record<string, string[] | null> = {
    'coordinator.md': ['Write', 'Edit', 'Delete'],
    'orchestrator.md': ['Write', 'Edit', 'Delete'],
    'planner.md': ['Delete'],
    'implementer.md': null,
    'reviewer.md': ['Write', 'Edit', 'Delete'],
    'router.md': ['Write', 'Edit', 'Delete'],
    'investigator.md': ['Write', 'Edit', 'Delete'],
    'hunter.md': ['Write', 'Edit', 'Delete'],
  };

  for (const file of files) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    const fmBody = fm ? fm[1] : '';

    if (/^tools:/m.test(fmBody)) {
      errors.push(`${file}: has tools: allowlist (use deny-list only)`);
    }

    const expected = denyMatrix[file];
    if (expected === null) {
      // implementer: disallowedTools must be absent (full access by design — this denyMatrix is the SSOT)
      if (/^disallowedTools:/m.test(fmBody)) {
        errors.push(`${file}: must NOT have disallowedTools (implementer requires full tool access)`);
      }
    } else if (expected) {
      if (!fmBody.includes('disallowedTools:')) {
        errors.push(`${file}: missing disallowedTools`);
      } else {
        for (const tool of expected) {
          if (!fmBody.includes(tool)) {
            errors.push(`${file}: disallowedTools missing ${tool}`);
          }
        }
      }
    }
  }

  if (errors.length) return { id: 'V-TOOLS-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-TOOLS-01', ok: true };
};

// V-AGENT-01: Agent frontmatter
const checkAgentFrontmatter = (): CheckResult => {
  const agentsDir = path.join(srcDir, 'agents');
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  const missing: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) {
      missing.push(`${file}: no frontmatter`);
      continue;
    }
    for (const key of ['name:', 'description:']) {
      if (!fm[1].includes(key)) missing.push(`${file}: missing ${key}`);
    }
    if (/\bmodel:/.test(fm[1])) missing.push(`${file}: model must be absent (inherit harness default)`);
  }

  if (missing.length) return { id: 'V-AGENT-01', ok: false, detail: missing.join('; ') };
  return { id: 'V-AGENT-01', ok: true };
};

// V-DELEG-01: Worker agents declare contract sections
const checkDelegationContracts = (): CheckResult => {
  const workers = ['planner.md', 'implementer.md'];
  const missing: string[] = [];

  for (const file of workers) {
    const content = read(`src/agents/${file}`);
    if (!/5-Field|5-field|Scope Boundaries|Touch-Paths/i.test(content)) {
      missing.push(file);
    }
  }

  const outputAgents = ['reviewer.md', 'planner.md', 'implementer.md', 'router.md', 'investigator.md'];
  for (const file of outputAgents) {
    const content = read(`src/agents/${file}`);
    if (!/worker-schemas|Output format|Return format/i.test(content)) {
      missing.push(`${file}: no output schema reference`);
    }
  }

  const orch = read('src/agents/orchestrator.md');
  if (!orch.includes('5-Field Delegation Contract')) {
    missing.push('orchestrator.md: no 5-field section');
  }

  if (missing.length) return { id: 'V-DELEG-01', ok: false, detail: missing.join('; ') };
  return { id: 'V-DELEG-01', ok: true };
};

// V-PHASE-01: Phase playbooks reference consistent phase names
const checkPhaseNames = (): CheckResult => {
  const missing: string[] = [];

  for (const pb of PHASE_PLAYBOOK_FILES) {
    const content = read(`src/references/${pb}`);
    const hits = PHASE_NAMES.filter((p) => content.includes(p));
    if (hits.length === 0) missing.push(`${pb}: no phase name references`);
  }

  const queueDag = read('src/references/queue-dag.md');
  for (const p of PHASE_NAMES) {
    if (!queueDag.includes(`\`${p}\``)) missing.push(`queue-dag.md: missing phase ${p}`);
  }

  if (missing.length) return { id: 'V-PHASE-01', ok: false, detail: missing.join('; ') };
  return { id: 'V-PHASE-01', ok: true };
};

// V-VCODE-01: V-codes referenced in agents or phases
const checkVcodeReferences = (): CheckResult => {
  const vcodesContent = read('src/references/blackhole-vcodes.md');
  const codeMatches = [...vcodesContent.matchAll(/\| (V-[A-Z]+-\d+)/g)];
  const codes = new Set(codeMatches.map((m) => m[1]));

  const refDir = path.join(srcDir, 'references');
  const agentDir = path.join(srcDir, 'agents');
  const corpus = [
    ...walkMdFilesAbs(refDir).map((f) => fs.readFileSync(f, 'utf-8')),
    ...walkMdFilesAbs(agentDir).map((f) => fs.readFileSync(f, 'utf-8')),
  ].join('\n');

  const unreferenced: string[] = [];
  for (const code of codes) {
    if (!corpus.includes(code)) unreferenced.push(code);
  }

  if (unreferenced.length > codes.size * 0.5) {
    return { id: 'V-VCODE-01', ok: false, detail: `Many unreferenced codes: ${unreferenced.slice(0, 5).join(', ')}...` };
  }
  return { id: 'V-VCODE-01', ok: true };
};

// V-GATE-01: implementer.md's 5-step verification-evidence gate and reviewer.md's §12
// Suggestion Proportionality Gate keep their required marker text — regression guard for #204/#211
// and #207/#212. The reviewer marker below uses a contiguous phrase from the actual file text
// rather than the "single current consumer" paraphrase, because that paraphrase wraps across a
// line break in reviewer.md and is not a literal substring (see issue #219 plan discussion).
export const IMPLEMENTER_GATE_REQUIRED_MARKERS = [
  '5-step gate',
  '**IDENTIFY**',
  '**RUN**',
  '**READ**',
  '**VERIFY**',
  '**CLAIM**',
  'should work" / "should pass" / "probably" / "likely"',
  'based on the code" / "based on my analysis"',
];

export const REVIEWER_PROPORTIONALITY_REQUIRED_MARKERS = [
  'Suggestion Proportionality Gate',
  'abstraction layer (interface, factory, strategy) for a single',
];

// Shared filter: which of `required` are absent from `content`. Used by core.check.ts's own
// V-GATE-01 check and re-exported (unchanged) by single-writer.check.ts for its V-WRITE-01 check
// — one definition, ADR-007 R6/V-INT-02 (no local reimplementation of an equivalently-shaped
// filter function).
export const findMissingGateMarkers = (content: string, required: string[]): string[] =>
  required.filter((marker) => !content.includes(marker));

const checkGateContentAssertions = (): CheckResult => {
  const implementerContent = read('src/agents/implementer.md');
  const reviewerContent = read('src/agents/reviewer.md');

  const implementerMissing = findMissingGateMarkers(implementerContent, IMPLEMENTER_GATE_REQUIRED_MARKERS);
  const reviewerMissing = findMissingGateMarkers(reviewerContent, REVIEWER_PROPORTIONALITY_REQUIRED_MARKERS);

  const errors = [
    ...implementerMissing.map((m) => `implementer.md missing "${m}"`),
    ...reviewerMissing.map((m) => `reviewer.md missing "${m}"`),
  ];

  if (errors.length) return { id: 'V-GATE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-GATE-01', ok: true };
};

// Per-fixture-type shape validators (V-SCHEMA-01), extracted for direct unit coverage (#279 —
// checkFixtures previously had ~74 lines of inline per-fixture branching with zero tests). Each
// takes the already-JSON.parsed fixture body plus its label (used verbatim in error messages, so
// output text is unchanged from the pre-extraction inline version) and returns the shape errors
// found — [] when valid. Pure, no I/O: checkFixtures alone owns read()/JSON.parse()/try-catch and
// just wires these into its errors array (behavior-preserving extraction, no message changed).
export const validateRefreshedAtFixture = (label: string, data: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  if (!data.refreshed_at) errors.push(`${label}: missing refreshed_at`);
  return errors;
};

export const validateGeminiPluginFixture = (label: string, data: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  for (const key of ['$schema', 'name', 'version', 'description']) {
    if (!data[key]) errors.push(`${label}: missing ${key}`);
  }
  return errors;
};

export const validateCodexPluginFixture = (label: string, data: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  for (const key of ['name', 'interface', 'skills']) {
    if (!data[key]) errors.push(`${label}: missing ${key}`);
  }
  const iface = data.interface as Record<string, unknown> | undefined;
  if (iface && !iface.displayName) {
    errors.push(`${label}: interface missing displayName`);
  }
  return errors;
};

export const validateCodexMarketplaceFixture = (label: string, data: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  const plugins = data.plugins as Array<Record<string, unknown>> | undefined;
  const source = plugins?.[0]?.source as Record<string, unknown> | undefined;
  if (!source?.source) {
    errors.push(`${label}: plugins[0].source.source missing`);
  }
  if (source?.source !== 'git') {
    errors.push(`${label}: plugins[0].source.source must be git`);
  }
  return errors;
};

export const validateQueueIssuesShape = (queue: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  if (!queue.issues || typeof queue.issues !== 'object') {
    errors.push('queue.example.json: missing issues object');
    return errors;
  }
  for (const [, issue] of Object.entries(queue.issues as Record<string, unknown>) as [string, Record<string, unknown>][]) {
    if (typeof issue.review_iteration !== 'number') {
      errors.push('queue.example.json: issue missing review_iteration');
      break;
    }
  }
  return errors;
};

export const validateConfigFixtureShape = (config: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  for (const key of ['repo', 'target_branch', 'forge'] as const) {
    if (!config[key] || typeof config[key] !== 'string') {
      errors.push(`config.example.json: missing or invalid ${key}`);
    }
  }
  if (config.scope_milestone !== undefined && typeof config.scope_milestone !== 'string') {
    errors.push('config.example.json: scope_milestone must be a string');
  }
  if (config.scope_labels !== undefined) {
    if (!Array.isArray(config.scope_labels) || !config.scope_labels.every((l: unknown) => typeof l === 'string')) {
      errors.push('config.example.json: scope_labels must be a string array');
    }
  }
  return errors;
};

// V-SCHEMA-01: Fixture JSON validates
const checkFixtures = (): CheckResult => {
  const errors: string[] = [];

  for (const fixture of [
    'fixtures/queue.example.json',
    'fixtures/findings-ledger.example.json',
    'fixtures/gemini-plugin.example.json',
    'fixtures/codex-plugin.example.json',
    'fixtures/codex-marketplace.example.json',
  ]) {
    try {
      const data = JSON.parse(read(fixture));
      if (fixture.includes('queue') || fixture.includes('findings-ledger')) {
        errors.push(...validateRefreshedAtFixture(fixture, data));
      }
      if (fixture.includes('gemini-plugin')) {
        errors.push(...validateGeminiPluginFixture(fixture, data));
      }
      if (fixture.includes('codex-plugin')) {
        errors.push(...validateCodexPluginFixture(fixture, data));
      }
      if (fixture.includes('codex-marketplace')) {
        errors.push(...validateCodexMarketplaceFixture(fixture, data));
      }
    } catch (e) {
      errors.push(`${fixture}: invalid JSON`);
    }
  }

  const queue = JSON.parse(read('fixtures/queue.example.json'));
  errors.push(...validateQueueIssuesShape(queue));

  try {
    const config = JSON.parse(read('fixtures/config.example.json'));
    errors.push(...validateConfigFixtureShape(config));
  } catch {
    errors.push('fixtures/config.example.json: invalid JSON');
  }

  if (errors.length) return { id: 'V-SCHEMA-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-SCHEMA-01', ok: true };
};

const PLAN_REQUIRED_PHASES = new Set(['plan', 'implement', 'review']);

const parseCampaignDirArg = (): string | null => {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--campaign-dir');
  if (idx === -1 || idx + 1 >= argv.length) return null;
  return argv[idx + 1];
};

const resolveCampaignPaths = () => {
  const campaignDirArg = parseCampaignDirArg();
  const campaignDir = campaignDirArg
    ? path.resolve(campaignDirArg)
    : path.join(root, 'fixtures');
  const queueFile = campaignDirArg
    ? path.join(campaignDir, 'queue.json')
    : path.join(campaignDir, 'queue.example.json');
  return { campaignDir, queueFile };
};

// V-PLAN-01: In-flight plan/implement/review entries require plans/issue-N.md
const checkPlanArtifacts = (): CheckResult => {
  const { campaignDir, queueFile } = resolveCampaignPaths();

  if (!fs.existsSync(queueFile)) {
    return { id: 'V-PLAN-01', ok: true };
  }

  let queue: { issues?: Record<string, { phase?: string; status?: string }> };
  try {
    queue = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
  } catch {
    return { id: 'V-PLAN-01', ok: false, detail: `${path.relative(root, queueFile)}: invalid JSON` };
  }

  if (!queue.issues || typeof queue.issues !== 'object') {
    return { id: 'V-PLAN-01', ok: true };
  }

  const errors: string[] = [];
  for (const [id, issue] of Object.entries(queue.issues)) {
    if (!issue || typeof issue !== 'object') continue;
    if (issue.status !== 'in-flight') continue;
    if (!issue.phase || !PLAN_REQUIRED_PHASES.has(issue.phase)) continue;

    const planPath = path.join(campaignDir, 'plans', `issue-${id}.md`);
    if (!fs.existsSync(planPath)) {
      errors.push(`issue #${id} (${issue.phase}): missing ${path.relative(root, planPath)}`);
    }
  }

  if (errors.length) return { id: 'V-PLAN-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-PLAN-01', ok: true };
};

// Thin .md-filtering wrapper over scripts/lib/fs.ts's shared, directory-safe walker
// (ADR-007 R6 — one tree-walker, no local reimplementation, V-INT-02). Export name kept as
// walkMdFilesAbs so existing importers (verify.test.ts, this file) are unaffected.
export const walkMdFilesAbs = (absDir: string): string[] =>
  walkFilesAbs(absDir).filter((f) => f.endsWith('.md'));

export const walkMdFiles = (dir: string): string[] =>
  walkMdFilesAbs(path.join(root, dir)).map((f) => path.relative(root, f));

// V-LINK-01 (ADR-007 T4/R7): markdown cross-reference integrity.
//
// Extracts `[text](target)` link targets from `content`, one-indexed by line. Skips targets
// inside fenced (```) code blocks, absolute http(s)/mailto links, and pure-anchor (`#fragment`)
// links — none of those are a same-repo cross-reference this check can validate.
export const extractMarkdownLinkTargets = (content: string): { line: number; target: string }[] => {
  const out: { line: number; target: string }[] = [];
  let inFence = false;
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;

  content.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    let m: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(line))) {
      const target = m[1].trim();
      if (/^https?:\/\//.test(target) || /^mailto:/.test(target) || target.startsWith('#')) continue;
      out.push({ line: i + 1, target });
    }
  });

  return out;
};

// Resolves every link target in `content` relative to `fileAbs`'s directory (stripping any
// `#fragment` suffix) and reports the ones that do not exist on disk. `fileLabel` (defaults to
// `fileAbs`) is the path used in the error message, so callers can report a repo-relative path.
export const findDeadMarkdownLinks = (fileAbs: string, content: string, fileLabel: string = fileAbs): string[] => {
  const errors: string[] = [];

  for (const { line, target } of extractMarkdownLinkTargets(content)) {
    const withoutFragment = target.split('#')[0];
    if (!withoutFragment) continue;
    const resolved = path.resolve(path.dirname(fileAbs), withoutFragment);
    if (!fs.existsSync(resolved)) {
      errors.push(`${fileLabel}:${line}: dead link -> ${target}`);
    }
  }

  return errors;
};

// Same "ADR-NNN" shorthand this repo uses for its own documentation/decisions/ADR-*.md files is
// also used in a few places to reference *another* repo's ADR numbering (mercure) — those can
// never resolve to a local file and are not doc drift. Each entry below carries the exact prose
// that scopes it externally, so the allowlist can be audited at a glance.
export const EXTERNAL_ADR_REFS: ReadonlySet<string> = new Set([
  '026', // ADR-002-synthesizer-extraction.md: "ADR-026 in mercure"
  '082', // ADR-006-kaizen-hunt.md: "x-analyze ADR-082 lesson" / "the mechanism ADR-082 exists"
]);

// Parses a `related:` key out of ADR frontmatter (the block already captured between the `---`
// delimiters), supporting both the block-list form (`related:\n  - a\n  - b`) and the inline
// array form (`related: [a, b]`) documented in `.claude/rules/doc-governance.md`.
const extractRelatedEntries = (frontmatter: string): string[] => {
  const lines = frontmatter.split('\n');
  const headerIdx = lines.findIndex((l) => /^related:/.test(l));
  if (headerIdx === -1) return [];

  const inlineMatch = lines[headerIdx].match(/^related:\s*\[(.*)\]\s*$/);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  const entries: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
    if (!itemMatch) break;
    entries.push(itemMatch[1].trim());
  }
  return entries;
};

// Validates documentation/decisions/*.md ADR cross-references: every `related:` frontmatter
// entry must resolve (relative to `repoRoot`) to a file on disk, and every inline `ADR-NNN`
// mention must resolve to a local `documentation/decisions/ADR-NNN-*.md` file unless it is in
// `externalAdrRefs`. Returns [] when `documentation/decisions/` does not exist (e.g. a fixture
// repo without ADRs) rather than treating that as an error — this check only validates
// cross-references that are present, it does not require the directory to exist.
export const findAdrCrossReferenceErrors = (
  repoRoot: string,
  externalAdrRefs: ReadonlySet<string> = EXTERNAL_ADR_REFS,
): string[] => {
  const decisionsDir = path.join(repoRoot, 'documentation', 'decisions');
  if (!fs.existsSync(decisionsDir)) return [];

  const adrFiles = fs.readdirSync(decisionsDir).filter((f) => /^ADR-\d+-.*\.md$/.test(f));
  const localAdrNumbers = new Set(adrFiles.map((f) => f.match(/^ADR-(\d+)-/)![1]));
  const errors: string[] = [];

  for (const file of adrFiles) {
    const abs = path.join(decisionsDir, file);
    const content = fs.readFileSync(abs, 'utf-8');
    const rel = path.relative(repoRoot, abs);

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      for (const entry of extractRelatedEntries(frontmatterMatch[1])) {
        const resolved = path.resolve(repoRoot, entry);
        if (!fs.existsSync(resolved)) {
          errors.push(`${rel}: related: entry does not exist -> ${entry}`);
        }
      }
    }

    for (const m of content.matchAll(/ADR-(\d+)/g)) {
      const num = m[1];
      if (externalAdrRefs.has(num) || localAdrNumbers.has(num)) continue;
      errors.push(`${rel}: inline mention of ADR-${num} does not resolve to a local documentation/decisions/ADR-${num}-*.md file`);
    }
  }

  return errors;
};

// V-LINK-01: src/**/*.md cross-references resolve on disk; documentation/decisions/*.md ADR
// cross-references (related: frontmatter + inline ADR-NNN mentions) resolve locally.
const checkLinkIntegrity = (): CheckResult => {
  const errors: string[] = [];

  for (const abs of walkMdFilesAbs(srcDir)) {
    const rel = path.relative(root, abs);
    const content = fs.readFileSync(abs, 'utf-8');
    errors.push(...findDeadMarkdownLinks(abs, content, rel));
  }

  errors.push(...findAdrCrossReferenceErrors(root));

  if (errors.length) return { id: 'V-LINK-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-LINK-01', ok: true };
};

// V-SKILL-01: SKILL.md modes match phase playbooks
const checkSkillModes = (): CheckResult => {
  const skill = read('src/SKILL.md');
  const required = ['run', 'status', 'handle', 'plan', 'implement', 'review', 'campaign-audit'];
  const missing = required.filter((m) => !skill.includes(m));

  const phaseFiles = ['phase-handle', 'phase-plan', 'phase-implement', 'phase-review', 'phase-loop'];
  const missingPhases = phaseFiles.filter((p) => !skill.includes(p));

  if (missing.length || missingPhases.length) {
    return {
      id: 'V-SKILL-01',
      ok: false,
      detail: `missing modes: ${missing.join(', ')}; missing phase refs: ${missingPhases.join(', ')}`,
    };
  }
  return { id: 'V-SKILL-01', ok: true };
};

// V-HARNESS-01: claude-code-native.md core stays harness-neutral (no tool tokens outside the
// per-harness mapping appendix). The appendix (marked by APPENDIX_MARKER) and everything after it
// are where harness-specific primitive names belong; the core sections above the marker must stay
// generic so non-Claude harnesses reading this doc aren't confronted with Claude-only vocabulary.
export const HARNESS_TOKENS = [
  'Workflow tool',
  'AskUserQuestion',
  'pipeline(',
  'parallel(',
  'resumeFromRunId',
  'subagentStop',
];

export const APPENDIX_MARKER = '## Per-harness mapping appendix';

export const findHarnessTokenLeaks = (content: string, tokens: string[] = HARNESS_TOKENS): string[] => {
  const markerIndex = content.indexOf(APPENDIX_MARKER);
  const core = markerIndex === -1 ? content : content.slice(0, markerIndex);

  const leaks: string[] = [];
  for (const line of core.split('\n')) {
    for (const token of tokens) {
      if (line.includes(token)) leaks.push(`${token}@${line.trim()}`);
    }
  }
  return leaks;
};

const checkClaudeCodeNativeNeutrality = (): CheckResult => {
  const content = read('src/references/claude-code-native.md');
  const leaks = findHarnessTokenLeaks(content);

  if (leaks.length) return { id: 'V-HARNESS-01', ok: false, detail: `harness token leak(s) before appendix: ${leaks.join('; ')}` };
  return { id: 'V-HARNESS-01', ok: true };
};

// V-GROUND-01 (ADR-007 T3/R1′): two-sided facts-conformance. Diffs an independently-scanned
// filename set against a declared filename set, order-insensitive, returning null on a match or
// a message naming the symmetric difference (missing/extra) on mismatch (never a boolean — the
// failing check must be able to name exactly what's wrong, ADR-007 Risk Assessment row 2
// mitigation). Reports only the symmetric difference rather than both full sets (PR #257 review
// rider) — on a large roster, a one-entry drift used to bury the signal in two long, mostly
// identical set dumps.
export const findRosterScanMismatch = (scanned: string[], declared: string[]): string | null => {
  const s = new Set(scanned);
  const d = new Set(declared);
  const missing = declared.filter((name) => !s.has(name)).sort();
  const extra = scanned.filter((name) => !d.has(name)).sort();
  if (missing.length === 0 && extra.length === 0) return null;

  const parts: string[] = [];
  if (missing.length) parts.push(`missing [${missing.join(', ')}]`);
  if (extra.length) parts.push(`extra [${extra.join(', ')}]`);
  return parts.join(', ');
};

// Same two-sided shape for a plain declared-count vs scanned-count comparison (e.g. a markdown
// table's row count) — names the label plus both numbers on mismatch.
export const findRowCountMismatch = (label: string, declared: number, actual: number): string | null =>
  declared === actual ? null : `${label}: declared ${declared}, found ${actual}`;

// V-GROUND-01: facts-conformance — independent filesystem scan of src/agents/,
// src/references/phase-*.md, and blackhole-vcodes.md's row count, compared against build.ts's
// § facts declaration. Never collapsed onto one derivation path (ADR-007 Rejected Alternatives:
// "Single-source derivation for both sides of the drift check").
const checkGroundTruth = (): CheckResult => {
  const errors: string[] = [];

  const scannedAgents = listFiles('src/agents');
  const declaredAgents = AGENT_NAMES.map((n) => `${n}.md`);
  const agentMismatch = findRosterScanMismatch(scannedAgents, declaredAgents);
  if (agentMismatch) errors.push(`agents: ${agentMismatch}`);

  const scannedPlaybooks = listFiles('src/references').filter((f) => f.startsWith('phase-'));
  const playbookMismatch = findRosterScanMismatch(scannedPlaybooks, [...PHASE_PLAYBOOK_FILES]);
  if (playbookMismatch) errors.push(`phase playbooks: ${playbookMismatch}`);

  const vcodes = read('src/references/blackhole-vcodes.md');
  const vcodeRows = (vcodes.match(/^\| V-/gm) || []).length;
  const rowCountMismatch = findRowCountMismatch('vcode table rows', VCODE_TABLE_ROW_COUNT, vcodeRows);
  if (rowCountMismatch) errors.push(rowCountMismatch);

  for (const ref of REQUIRED_REFERENCES) {
    if (!fs.existsSync(path.join(srcDir, 'references', ref))) errors.push(`missing reference: ${ref}`);
  }

  if (errors.length) return { id: 'V-GROUND-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-GROUND-01', ok: true };
};

// V-DOCTABLE-01 (ADR-007 T3/R1′): tolerant row-set parser — extracts backtick-quoted names from
// the `## Agent roster` section only (ignores prose mentions elsewhere and header/separator
// rows), so AGENTS.md stays fully hand-authored while still being checked against the § facts
// declaration (ADR-007 Rejected Alternatives: no generation-in-place / no `<!-- roster -->`
// markers).
export const extractAgentRosterTableNames = (agentsMdContent: string): string[] => {
  const section = agentsMdContent.split(/^## Agent roster$/m)[1]?.split(/^## /m)[0] ?? '';
  const names: string[] = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*`([\w-]+)`\s*\|/);
    if (m) names.push(m[1]);
  }
  return names;
};

// Lighter count-consistency check: README.md's agent-count prose mention against
// AGENT_NAMES.length — prints the expected value on failure.
export const findReadmeAgentCountMismatch = (readmeContent: string, expectedCount: number): string | null => {
  const pattern = new RegExp(`\\b${expectedCount}\\s+agent prompts\\b`);
  if (pattern.test(readmeContent)) return null;
  return `expected mention of "${expectedCount} agent prompts", not found`;
};

// V-DOCTABLE-01: AGENTS.md's roster table and README.md's agent-count mention, checked (not
// generated) against the § facts declaration.
const checkDocTables = (): CheckResult => {
  const errors: string[] = [];

  const agentsMd = read('AGENTS.md');
  const foundNames = extractAgentRosterTableNames(agentsMd).map((n) => `${n}.md`);
  const declaredNames = AGENT_NAMES.map((n) => `${n}.md`);
  const rosterMismatch = findRosterScanMismatch(foundNames, declaredNames);
  if (rosterMismatch) errors.push(`AGENTS.md roster: ${rosterMismatch}`);

  const readme = read('README.md');
  const readmeMismatch = findReadmeAgentCountMismatch(readme, AGENT_NAMES.length);
  if (readmeMismatch) errors.push(`README.md: ${readmeMismatch}`);

  if (errors.length) return { id: 'V-DOCTABLE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-DOCTABLE-01', ok: true };
};

// V-EPIC-01: epic-orchestration.md exists and phase-handle.md links to it
const checkEpicRunbook = (): CheckResult => {
  const errors: string[] = [];

  if (!fs.existsSync(path.join(srcDir, 'references', 'epic-orchestration.md'))) {
    errors.push('epic-orchestration.md does not exist');
  }

  const phaseHandle = read('src/references/phase-handle.md');
  if (!phaseHandle.includes('epic-orchestration.md')) {
    errors.push('phase-handle.md does not link to epic-orchestration.md');
  }

  const issueSplitting = read('src/references/issue-splitting.md');
  if (!issueSplitting.includes('epic-orchestration.md')) {
    errors.push('issue-splitting.md does not link to epic-orchestration.md');
  }

  if (errors.length) return { id: 'V-EPIC-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-EPIC-01', ok: true };
};

// V-CODEX-04 filter: identifies codexTreeErrors entries describing an agent-count mismatch
// (e.g. "Codex: expected 6 agent YAML files, got 5"). Exported for direct unit coverage (#234)
// since checkCodexAgentFiles (scripts/checks/build.check.ts) closes over the repo-root filesystem
// and can't be exercised in isolation otherwise. Its paired unit test lives in verify.test.ts
// (core's catch-all test file), which is why this filter lives in core.check.ts even though its
// only call site is build.check.ts's checkCodexAgentFiles (imported across domain files —
// implementation reuse, not a test import, ADR-007 R6/V-INT-02). Post-#199 the expected count is
// parameterized, so the message no longer contains a literal "5" — match the stable "agent YAML
// files" substring instead (fixes #234's dead filter, which never matched and silently swallowed
// agent-count mismatches).
export const isAgentCountError = (e: string): boolean => e.includes('agent YAML files');

// V-CONTENTGATE-01 (ADR-007 T6/R3′): section-budget content-gate for orchestrator.md. Parses
// only `##`-level section boundaries (matching the master plan's "parse orchestrator.md's `##`
// section boundaries" — nested `###` subsections, e.g. "Route-derived dispatch" inside "5-Field
// Delegation Contract", are not independently budgeted). Returns a header -> line-count map,
// where a section's line count spans from its header line up to (not including) the next
// `##`-level header, or EOF. A trailing empty string produced by splitting content that ends in
// a newline is dropped first so the final section's count matches `wc -l` exactly.
export const parseSectionLineCounts = (content: string): Record<string, number> => {
  let lines = content.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines = lines.slice(0, -1);

  const headerIdx: number[] = [];
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^(```|~~~)/.test(l)) inFence = !inFence;
    if (!inFence && /^## /.test(l)) headerIdx.push(i);
  });

  const sections: Record<string, number> = {};
  for (let k = 0; k < headerIdx.length; k++) {
    const start = headerIdx[k];
    const end = k + 1 < headerIdx.length ? headerIdx[k + 1] : lines.length;
    sections[lines[start]] = end - start;
  }
  return sections;
};

// Grow-never baseline snapshot, captured at this check's landing commit (ADR-007 T6). Every
// section that existed in orchestrator.md at this commit is grandfathered: it may shrink or stay
// the same size forever, but it must never GROW past the LOC recorded here — growth past the
// baseline is exactly the accretion this governance-only check exists to prevent. Any `##`
// section header not in this map is "new" (added after this commit) and is budget-checked
// against CONTENT_GATE_NEW_SECTION_BUDGET_LOC instead. Do not hand-edit these numbers to make a
// failing check pass — shrink the section, or accept that growing a baseline section is the
// violation being reported.
export const ORCHESTRATOR_CONTENT_GATE_BASELINE: Record<string, number> = {
  '## Role & Responsibilities': 9,
  '## 5-Field Delegation Contract': 131,
  '## Error Classification (Transient / Permanent / Partial-Corruption)': 19,
  '## Escalation dispatch (implementer → investigator)': 31,
  '## Review pipeline': 14,
  '## Wave scheduling': 8,
  '## Background worker barrier (Cursor / Pattern B)': 46,
  '## Checkpoint protocol': 15,
  '## Session resume & recovery': 20,
  '## Human-in-the-Loop (HITL) & Blocker Gating': 9,
  '## Incident Mode': 36,
  '## Continuous Discovery & Pareto Sorting': 12,
  '## Kaizen hunt dispatch': 38,
  '## Brainstorm dispatch precedence (ADR-010 D3)': 16,
  '## Brainstorm terminal handling (ADR-010 D3)': 33,
};

// New (non-baseline) `##` sections are capped at 50 LOC — the approved plan default, chosen to
// sit between the newest "thin pointer" precedent sections (Kaizen hunt dispatch, 38 LOC;
// Incident Mode, 36 LOC) and comfortably below the un-grandfathered core-loop sections (46-131
// LOC) that pre-date this governance rule.
export const CONTENT_GATE_NEW_SECTION_BUDGET_LOC = 50;

export const findContentGateViolations = (
  sections: Record<string, number>,
  baseline: Record<string, number>,
  newSectionBudgetLoc: number,
): string[] => {
  const errors: string[] = [];
  for (const [header, loc] of Object.entries(sections)) {
    const baselineLoc = baseline[header];
    if (baselineLoc !== undefined) {
      if (loc > baselineLoc) {
        errors.push(`${header}: grew to ${loc} LOC, exceeds grandfathered baseline of ${baselineLoc} LOC (grow-never)`);
      }
    } else if (loc > newSectionBudgetLoc) {
      errors.push(`${header}: new section is ${loc} LOC, exceeds ${newSectionBudgetLoc}-LOC budget`);
    }
  }
  return errors;
};

const checkContentGate = (): CheckResult => {
  const content = read('src/agents/orchestrator.md');
  const sections = parseSectionLineCounts(content);
  const errors = findContentGateViolations(sections, ORCHESTRATOR_CONTENT_GATE_BASELINE, CONTENT_GATE_NEW_SECTION_BUDGET_LOC);

  if (errors.length) return { id: 'V-CONTENTGATE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-CONTENTGATE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — a single pure function returning this domain's
// CheckResult[], no side effects (console.log stays in scripts/verify.ts, the thin runner).
// scripts/verify.ts glob-discovers scripts/checks/*.check.ts and calls each module's exported
// runChecks() — no central registry file (ADR-007 critics' binding rejection of a check-registry
// hub).
export const runChecks = (): CheckResult[] => [
  checkAgentToolPolicy(),
  checkAgentFrontmatter(),
  checkDelegationContracts(),
  checkPhaseNames(),
  checkVcodeReferences(),
  checkGateContentAssertions(),
  checkFixtures(),
  checkPlanArtifacts(),
  checkSkillModes(),
  checkClaudeCodeNativeNeutrality(),
  checkGroundTruth(),
  checkDocTables(),
  checkLinkIntegrity(),
  checkEpicRunbook(),
  checkContentGate(),
];

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { AGENTS_BUILD_ROOT, AGENTS_BUILD_AGENT_DIR, DISTRIBUTION_ROOT, AGENT_MD_FILES, AGENT_YAML_FILES, RULES_LIST } from './build.ts';
import { validatePluginTreeShape, distributionTreeErrors, codexTreeErrors, hasInstructionsBlock } from './tree-shape.ts';

const root = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'src');

type CheckResult = { id: string; ok: boolean; detail?: string };

const results: CheckResult[] = [];

const fail = (id: string, detail: string) => {
  results.push({ id, ok: false, detail });
};

const pass = (id: string) => {
  results.push({ id, ok: true });
};

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

const listFiles = (dir: string, ext = '.md'): string[] => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith(ext));
};

const parseGroundTruth = (): Record<string, number | string> => {
  const content = read('src/references/ground-truth.md');
  const out: Record<string, number | string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^\*\*([\w_]+):\*\*\s*(.+)$/);
    if (m) {
      const val = m[2].trim();
      out[m[1]] = /^\d+$/.test(val) ? Number(val) : val;
    }
  }
  return out;
};

// V-TOOLS-01: Deny-list tool policy — no tools: allowlist; correct disallowedTools per role
const checkAgentToolPolicy = () => {
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

  if (errors.length) fail('V-TOOLS-01', errors.join('; '));
  else pass('V-TOOLS-01');
};

// V-AGENT-01: Agent frontmatter
const checkAgentFrontmatter = () => {
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

  if (missing.length) fail('V-AGENT-01', missing.join('; '));
  else pass('V-AGENT-01');
};

// V-DELEG-01: Worker agents declare contract sections
const checkDelegationContracts = () => {
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

  if (missing.length) fail('V-DELEG-01', missing.join('; '));
  else pass('V-DELEG-01');
};

// V-DESIGN-01: Design Track template in planner.md declares all 8 required section headings
export const DESIGN_TRACK_REQUIRED_HEADINGS = [
  '## Requirements Framing',
  '## Options + Trade-off Matrix',
  '## Adversarial Evaluation',
  '## Component Decomposition',
  '## Design Principles Validation',
  '## Refactoring Impact Analysis',
  '## Assumption Audit',
  '## Gate',
];

export const findMissingDesignTrackHeadings = (
  content: string,
  required: string[] = DESIGN_TRACK_REQUIRED_HEADINGS,
): string[] => required.filter((heading) => !content.includes(heading));

const checkDesignTrackTemplate = () => {
  const content = read('src/agents/planner.md');
  const missing = findMissingDesignTrackHeadings(content);
  if (missing.length) {
    fail('V-DESIGN-01', `planner.md missing Design Track headings: ${missing.join(', ')}`);
  } else {
    pass('V-DESIGN-01');
  }
};

// V-ADADOC-01: blackhole-vcodes.md documents the V-ADA family; reviewer.md documents Companion-File Audit
export const COMPANION_FILE_REQUIRED_VCODES = ['V-ADA-01', 'V-ADA-02', 'V-ADA-03', 'V-ADA-05/06/07'];

export const findMissingCompanionVcodes = (
  content: string,
  required: string[] = COMPANION_FILE_REQUIRED_VCODES,
): string[] => required.filter((code) => !content.includes(code));

const checkCompanionFileDocs = () => {
  const vcodesMissing = findMissingCompanionVcodes(read('src/references/blackhole-vcodes.md'));
  const reviewerMissing = read('src/agents/reviewer.md').includes('Companion-File Audit')
    ? []
    : ['reviewer.md: no Companion-File Audit section'];
  const errors = [...vcodesMissing.map((c) => `blackhole-vcodes.md missing ${c}`), ...reviewerMissing];

  if (errors.length) fail('V-ADADOC-01', errors.join('; '));
  else pass('V-ADADOC-01');
};

// V-PHASE-01: Phase playbooks reference consistent phase names
const checkPhaseNames = () => {
  const phases = ['handle', 'plan', 'implement', 'review', 'done'];
  const playbooks = ['phase-handle.md', 'phase-plan.md', 'phase-implement.md', 'phase-review.md', 'phase-loop.md'];
  const missing: string[] = [];

  for (const pb of playbooks) {
    const content = read(`src/references/${pb}`);
    const hits = phases.filter((p) => content.includes(p));
    if (hits.length === 0) missing.push(`${pb}: no phase name references`);
  }

  const queueDag = read('src/references/queue-dag.md');
  for (const p of phases) {
    if (!queueDag.includes(`\`${p}\``)) missing.push(`queue-dag.md: missing phase ${p}`);
  }

  if (missing.length) fail('V-PHASE-01', missing.join('; '));
  else pass('V-PHASE-01');
};

// V-VCODE-01: V-codes referenced in agents or phases
const checkVcodeReferences = () => {
  const vcodesContent = read('src/references/blackhole-vcodes.md');
  const codeMatches = [...vcodesContent.matchAll(/\| (V-[A-Z]+-\d+)/g)];
  const codes = new Set(codeMatches.map((m) => m[1]));

  const refDir = path.join(srcDir, 'references');
  const agentDir = path.join(srcDir, 'agents');
  const corpus = [
    ...fs.readdirSync(refDir).map((f) => fs.readFileSync(path.join(refDir, f), 'utf-8')),
    ...fs.readdirSync(agentDir).map((f) => fs.readFileSync(path.join(agentDir, f), 'utf-8')),
  ].join('\n');

  const unreferenced: string[] = [];
  for (const code of codes) {
    if (!corpus.includes(code)) unreferenced.push(code);
  }

  if (unreferenced.length > codes.size * 0.5) {
    fail('V-VCODE-01', `Many unreferenced codes: ${unreferenced.slice(0, 5).join(', ')}...`);
  } else {
    pass('V-VCODE-01');
  }
};

// V-SCHEMA-01: Fixture JSON validates
const checkFixtures = () => {
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
        if (!data.refreshed_at) errors.push(`${fixture}: missing refreshed_at`);
      }
      if (fixture.includes('gemini-plugin')) {
        for (const key of ['$schema', 'name', 'version', 'description']) {
          if (!data[key]) errors.push(`${fixture}: missing ${key}`);
        }
      }
      if (fixture.includes('codex-plugin')) {
        for (const key of ['name', 'interface', 'skills']) {
          if (!data[key]) errors.push(`${fixture}: missing ${key}`);
        }
        if (data.interface && !data.interface.displayName) {
          errors.push(`${fixture}: interface missing displayName`);
        }
      }
      if (fixture.includes('codex-marketplace')) {
        if (!data.plugins?.[0]?.source?.source) {
          errors.push(`${fixture}: plugins[0].source.source missing`);
        }
        if (data.plugins?.[0]?.source?.source !== 'git') {
          errors.push(`${fixture}: plugins[0].source.source must be git`);
        }
      }
    } catch (e) {
      errors.push(`${fixture}: invalid JSON`);
    }
  }

  const queue = JSON.parse(read('fixtures/queue.example.json'));
  if (!queue.issues || typeof queue.issues !== 'object') {
    errors.push('queue.example.json: missing issues object');
  } else {
    for (const [, issue] of Object.entries(queue.issues) as [string, Record<string, unknown>][]) {
      if (typeof issue.review_iteration !== 'number') {
        errors.push('queue.example.json: issue missing review_iteration');
        break;
      }
    }
  }

  try {
    const config = JSON.parse(read('fixtures/config.example.json'));
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
  } catch {
    errors.push('fixtures/config.example.json: invalid JSON');
  }

  if (errors.length) fail('V-SCHEMA-01', errors.join('; '));
  else pass('V-SCHEMA-01');
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
const checkPlanArtifacts = () => {
  const { campaignDir, queueFile } = resolveCampaignPaths();

  if (!fs.existsSync(queueFile)) {
    pass('V-PLAN-01');
    return;
  }

  let queue: { issues?: Record<string, { phase?: string; status?: string }> };
  try {
    queue = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
  } catch {
    fail('V-PLAN-01', `${path.relative(root, queueFile)}: invalid JSON`);
    return;
  }

  if (!queue.issues || typeof queue.issues !== 'object') {
    pass('V-PLAN-01');
    return;
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

  if (errors.length) fail('V-PLAN-01', errors.join('; '));
  else pass('V-PLAN-01');
};

const walkMdFiles = (dir: string): string[] => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMdFiles(rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
};

// checkGeminiBuild, checkGeminiDistributionBundle, and checkBuild all need `bun run build
// --gemini` to have run before asserting file shape / diffing porcelain — memoize so a full
// `bun run verify` pass only builds once.
// Note: `--gemini` and `--all` produce byte-identical output under current build.ts flag
// semantics (buildCodex defaults to true regardless of either flag), so this call also covers
// the codex mirror; if buildCodex's default ever changes, revisit this equivalence.
let geminiBuildResult: { ok: boolean; output: string } | null = null;

const runGeminiBuild = (): { ok: boolean; output: string } => {
  if (!geminiBuildResult) {
    const build = spawnSync('bun', ['run', 'build', '--gemini'], { cwd: root, encoding: 'utf-8' });
    geminiBuildResult = { ok: build.status === 0, output: build.stderr || build.stdout || '' };
  }
  return geminiBuildResult;
};

// V-GEMINI-01: Gemini/Antigravity compile outputs are complete and platform-clean
const checkGeminiBuild = () => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runGeminiBuild();
    if (!build.ok) {
      fail('V-GEMINI-01', `build --gemini failed: ${build.output}`);
      return;
    }
  }

  const workspaceAgents = listFiles(path.join(AGENTS_BUILD_ROOT, 'agents'));
  const agentFiles = workspaceAgents.filter((f) => AGENT_MD_FILES.has(f));
  const errors: string[] = [];
  if (agentFiles.length !== 7) {
    errors.push(`${AGENTS_BUILD_AGENT_DIR}/agents: expected 7 agent .md files, got ${agentFiles.length}`);
  }

  errors.push(
    ...validatePluginTreeShape(
      path.join(root, AGENTS_BUILD_ROOT),
      path.join(root, '.gemini-plugin', 'plugin.json'),
      { treePrefix: `${AGENTS_BUILD_AGENT_DIR}/`, manifest: '.gemini-plugin/plugin.json' },
      RULES_LIST,
    ),
  );

  for (const rel of walkMdFiles(AGENTS_BUILD_ROOT)) {
    const content = read(rel);
    if (/\{\{#cursor\}\}/.test(content) || /\{\{#claude\}\}/.test(content)) {
      errors.push(`${rel}: contains raw platform conditional`);
    }
  }

  const protocol = read(path.join(AGENTS_BUILD_ROOT, 'rules', 'blackhole-protocol.md'));
  const entryMatch = protocol.match(/## Entry\n([\s\S]*?)\n## Five phases/);
  if (!entryMatch || !/Multitask|coordinator/i.test(entryMatch[1])) {
    errors.push('blackhole-protocol.md Entry section missing Multitask/gemini content');
  }

  if (errors.length) fail('V-GEMINI-01', errors.join('; '));
  else pass('V-GEMINI-01');
};

// V-GEMINI-02: Gemini/Antigravity distribution bundle (plugins/blackhole/) shape check —
// independent from V-GEMINI-01's workspace-tree assertions (see tree-shape.ts's
// geminiWorkspaceTreeErrors, which build.ts uses at build time for the opposite invariant).
export const evaluateDistributionBundle = (destRoot: string): string[] =>
  distributionTreeErrors(destRoot, path.join(destRoot, 'plugin.json'), RULES_LIST);

const checkGeminiDistributionBundle = () => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runGeminiBuild();
    if (!build.ok) {
      fail('V-GEMINI-02', `build --gemini failed: ${build.output}`);
      return;
    }
  }

  const errors = evaluateDistributionBundle(path.join(root, DISTRIBUTION_ROOT));
  if (errors.length) fail('V-GEMINI-02', errors.join('; '));
  else pass('V-GEMINI-02');
};

// V-CODEX-01: build succeeds (skip-env counts as success)
const checkCodexBuildExec = (): boolean => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runGeminiBuild();
    if (!build.ok) {
      fail('V-CODEX-01', `build failed: ${build.output}`);
      return false;
    }
  }
  pass('V-CODEX-01');
  return true;
};

// V-CODEX-02: .codex-plugin/plugin.json + codex-marketplace.json shape
const checkCodexManifest = () => {
  const manifestErrors: string[] = [];
  const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    manifestErrors.push('missing .codex-plugin/plugin.json');
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const key of ['name', 'interface', 'skills', 'version']) {
        if (!manifest[key]) manifestErrors.push(`plugin.json missing ${key}`);
      }
      if (manifest.interface && !manifest.interface.displayName) {
        manifestErrors.push('plugin.json interface missing displayName');
      }
    } catch {
      manifestErrors.push('plugin.json invalid JSON');
    }
  }
  const marketplacePath = path.join(root, 'codex-marketplace.json');
  if (fs.existsSync(marketplacePath)) {
    try {
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf-8'));
      if (marketplace.plugins?.[0]?.source?.source !== 'git') {
        manifestErrors.push('codex-marketplace.json must use git source format');
      }
      if (marketplace.owner) {
        manifestErrors.push('codex-marketplace.json must not use Claude owner shape');
      }
    } catch {
      manifestErrors.push('codex-marketplace.json invalid JSON');
    }
  } else {
    manifestErrors.push('missing codex-marketplace.json');
  }
  if (manifestErrors.length) fail('V-CODEX-02', manifestErrors.join('; '));
  else pass('V-CODEX-02');
};

const codexAgentFileList = (): string[] => {
  const agentsDir = path.join(root, 'codex-agents');
  return fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter((f) => AGENT_YAML_FILES.has(f))
    : [];
};

// V-CODEX-03: codex-skills/blackhole/SKILL.md shape. SKILL.md-existence and non-empty-references
// checks route through tree-shape.ts's codexTreeErrors (shared with build.ts's assertion);
// only the disable-model-invocation content check stays local to this file.
const checkCodexSkillFile = () => {
  const sharedErrors = codexTreeErrors(root, codexAgentFileList()).filter(
    (e) => e.includes('SKILL.md') || e.includes('references')
  );
  const errors = [...sharedErrors];

  const skillPath = path.join(root, 'codex-skills', 'blackhole', 'SKILL.md');
  if (fs.existsSync(skillPath)) {
    const skill = fs.readFileSync(skillPath, 'utf-8');
    if (!skill.includes('disable-model-invocation: true')) {
      errors.push('SKILL.md missing disable-model-invocation: true');
    }
  }

  if (errors.length) fail('V-CODEX-03', errors.join('; '));
  else pass('V-CODEX-03');
};

// V-CODEX-04: codex-agents/*.yaml shape + codex-skills conditional-leak check. The 5-agent-count
// check routes through tree-shape.ts's codexTreeErrors (shared with build.ts's assertion); the
// per-file instructions-block *presence* check reuses tree-shape.ts's hasInstructionsBlock
// predicate (no duplicated boolean logic), but the `continue`-based control flow around it
// stays local to this file — folding the control flow itself into codexTreeErrors would force
// that shared function to know about verify-only concerns (deliberate, scoped deviation).
const checkCodexAgentFiles = () => {
  const agentsDir = path.join(root, 'codex-agents');
  const agentFiles = codexAgentFileList();
  const agentErrors: string[] = codexTreeErrors(root, agentFiles).filter((e) => e.includes('5 agent'));
  const yamlScalar = (content: string, field: string): string | null => {
    const m = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  };

  for (const file of agentFiles) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
    if (!hasInstructionsBlock(content)) {
      agentErrors.push(`${file}: missing instructions block`);
      continue;
    }

    for (const field of ['name', 'description', 'permissionMode'] as const) {
      const val = yamlScalar(content, field);
      if (!val) agentErrors.push(`${file}: missing or empty ${field}`);
    }

    if (yamlScalar(content, 'model') !== null) {
      agentErrors.push(`${file}: model must be absent (inherit harness default)`);
    }

    const hasToolEntries = /^disallowedTools:\n(?:\s+-\s+\S+\n)+/m.test(content);
    const hasEmptyTools = /^disallowedTools:\s*\[\]\s*$/m.test(content);
    if (!hasToolEntries && !hasEmptyTools) {
      agentErrors.push(`${file}: missing disallowedTools entries`);
    }

    const instMatch = content.match(/^instructions:\s*\|\n([\s\S]*)$/m);
    if (instMatch) {
      const instructions = instMatch[1].replace(/^  /gm, '').trim();
      if (instructions.length <= 200) {
        agentErrors.push(`${file}: instructions too short (${instructions.length} chars)`);
      }
    } else {
      agentErrors.push(`${file}: could not parse instructions block`);
    }
  }
  for (const rel of walkMdFiles('codex-skills')) {
    const content = read(rel);
    if (/\{\{#cursor\}\}/.test(content) || /\{\{#claude\}\}/.test(content)) {
      agentErrors.push(`${rel}: contains raw platform conditional`);
    }
  }
  if (agentErrors.length) fail('V-CODEX-04', agentErrors.join('; '));
  else pass('V-CODEX-04');
};

// V-CODEX-01 through V-CODEX-04: Codex CLI compile outputs (default verify — #31)
const checkCodexBuild = () => {
  if (!checkCodexBuildExec()) {
    fail('V-CODEX-02', 'skipped — build failed');
    fail('V-CODEX-03', 'skipped — build failed');
    fail('V-CODEX-04', 'skipped — build failed');
    return;
  }
  checkCodexManifest();
  checkCodexSkillFile();
  checkCodexAgentFiles();
};

// V-SKILL-01: SKILL.md modes match phase playbooks
const checkSkillModes = () => {
  const skill = read('src/SKILL.md');
  const required = ['run', 'status', 'handle', 'plan', 'implement', 'review', 'campaign-audit'];
  const missing = required.filter((m) => !skill.includes(m));

  const phaseFiles = ['phase-handle', 'phase-plan', 'phase-implement', 'phase-review', 'phase-loop'];
  const missingPhases = phaseFiles.filter((p) => !skill.includes(p));

  if (missing.length || missingPhases.length) {
    fail('V-SKILL-01', `missing modes: ${missing.join(', ')}; missing phase refs: ${missingPhases.join(', ')}`);
  } else {
    pass('V-SKILL-01');
  }
};

// V-GROUND-01: Ground-truth counts match filesystem
const checkGroundTruth = () => {
  const gt = parseGroundTruth();
  const errors: string[] = [];

  const agentCount = listFiles('src/agents').length;
  if (gt.agent_count !== agentCount) errors.push(`agent_count: expected ${gt.agent_count}, got ${agentCount}`);

  const phaseCount = listFiles('src/references').filter((f) => f.startsWith('phase-')).length;
  if (gt.phase_playbook_count !== phaseCount) {
    errors.push(`phase_playbook_count: expected ${gt.phase_playbook_count}, got ${phaseCount}`);
  }

  const vcodes = read('src/references/blackhole-vcodes.md');
  const vcodeRows = (vcodes.match(/^\| V-/gm) || []).length;
  if (gt.vcode_table_rows !== vcodeRows) {
    errors.push(`vcode_table_rows: expected ${gt.vcode_table_rows}, got ${vcodeRows}`);
  }

  const requiredRefs = ['review-core.md', 'worker-schemas.md', 'checkpoint-protocol.md'];
  for (const ref of requiredRefs) {
    if (!fs.existsSync(path.join(srcDir, 'references', ref))) errors.push(`missing reference: ${ref}`);
  }

  if (errors.length) fail('V-GROUND-01', errors.join('; '));
  else pass('V-GROUND-01');
};

// V-EPIC-01: epic-orchestration.md exists and phase-handle.md links to it
const checkEpicRunbook = () => {
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

  if (errors.length) fail('V-EPIC-01', errors.join('; '));
  else pass('V-EPIC-01');
};

// V-CHECKPOINT-01: checkpoint-protocol template ↔ orchestrator/phase-loop alignment
export const extractCheckpointTemplateKeys = (content: string): string[] => {
  const templateMatch = content.match(/## Checkpoint template[\s\S]*?```markdown\n([\s\S]*?)```/);
  if (!templateMatch) return [];

  const frontmatterMatch = templateMatch[1].match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return [];

  return frontmatterMatch[1]
    .split('\n')
    .map((line) => line.match(/^([\w_]+):/)?.[1])
    .filter((key): key is string => Boolean(key));
};

const checkCheckpointAlignment = () => {
  const requiredKeys = ['refreshed_at', 'orchestrator_turn_id', 'last_completed_phase'];
  const protocol = read('src/references/checkpoint-protocol.md');
  const orchestrator = read('src/agents/orchestrator.md');
  const phaseLoop = read('src/references/phase-loop.md');
  const errors: string[] = [];

  const templateKeys = extractCheckpointTemplateKeys(protocol);
  for (const key of requiredKeys) {
    if (!templateKeys.includes(key)) errors.push(`checkpoint-protocol.md template missing ${key}`);
  }

  if (!orchestrator.includes('checkpoint-protocol.md')) {
    errors.push('orchestrator.md missing checkpoint-protocol.md reference');
  }
  if (!orchestrator.includes('orchestrator_turn_id')) {
    errors.push('orchestrator.md missing orchestrator_turn_id');
  }
  const writeOrder =
    orchestrator.includes('queue.json') &&
    orchestrator.includes('findings-ledger.json') &&
    orchestrator.includes('campaign-checkpoint.md');
  const orderedWrite =
    /queue\.json\s*→\s*findings-ledger\.json\s*→\s*campaign-checkpoint\.md/.test(orchestrator);
  if (!writeOrder || !orderedWrite) {
    errors.push('orchestrator.md missing ordered queue.json → findings-ledger.json → campaign-checkpoint.md');
  }

  const phaseWriteOrder =
    /queue\.json\s*→\s*findings-ledger\.json\s*→\s*campaign-checkpoint\.md/.test(phaseLoop);
  if (!phaseWriteOrder) {
    errors.push('phase-loop.md missing ordered queue.json → findings-ledger.json → campaign-checkpoint.md');
  }
  if (!phaseLoop.includes('checkpoint-protocol.md')) {
    errors.push('phase-loop.md missing checkpoint-protocol.md reference');
  }

  if (errors.length) fail('V-CHECKPOINT-01', errors.join('; '));
  else pass('V-CHECKPOINT-01');
};

// V-BUILD-01: Build produces clean git diff (optional skip with VERIFY_SKIP_BUILD=1)
export const BUILD_OUTPUT_PATTERNS = [
  'agents/',
  'rules/',
  'skills/',
  '.cursor/',
  '.claude/',
  '.claude-plugin/',
  '.gemini-plugin/',
  '.agents/build/',
  'plugins/',
  'SKILL.md',
  'marketplace.json',
  '.codex-plugin/',
  'codex-agents/',
  'codex-skills/',
  'codex-marketplace.json',
];

export const detectBuildOutputDrift = (porcelainStdout: string): string[] =>
  porcelainStdout
    .split('\n')
    .filter((line) => line.length > 0)
    .filter((line) => {
      // Porcelain lines are "XY path" — strip the 2-char status + space
      // so patterns only match root build-output paths, not nested src/ paths
      // that happen to share a directory name (e.g. src/agents/foo.md).
      const filePath = line.slice(3);
      return BUILD_OUTPUT_PATTERNS.some((pattern) => filePath.startsWith(pattern));
    });

export const evaluateBuildCheck = (input: {
  skip: boolean;
  buildOk: boolean;
  buildOutput: string;
  afterPorcelain: string;
}): CheckResult => {
  if (input.skip) return { id: 'V-BUILD-01', ok: true };

  if (!input.buildOk) {
    return { id: 'V-BUILD-01', ok: false, detail: `build failed: ${input.buildOutput}` };
  }

  const dirty = detectBuildOutputDrift(input.afterPorcelain);
  if (dirty.length > 0) {
    return {
      id: 'V-BUILD-01',
      ok: false,
      detail: `build left dirty output: ${dirty.join(', ')} — run 'bun run build' and commit the result`,
    };
  }

  return { id: 'V-BUILD-01', ok: true };
};

const checkBuild = () => {
  const skip = process.env.VERIFY_SKIP_BUILD === '1';
  let buildOk = true;
  let buildOutput = '';
  let afterPorcelain = '';

  if (!skip) {
    const build = runGeminiBuild();
    buildOk = build.ok;
    buildOutput = build.output;

    if (buildOk) {
      const after = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' });
      afterPorcelain = after.stdout || '';
    }
  }

  const result = evaluateBuildCheck({ skip, buildOk, buildOutput, afterPorcelain });
  if (result.ok) pass(result.id);
  else fail(result.id, result.detail ?? '');
};

const main = () => {
  console.log('blackhole verify\n');

  checkAgentToolPolicy();
  checkAgentFrontmatter();
  checkDelegationContracts();
  checkDesignTrackTemplate();
  checkPhaseNames();
  checkVcodeReferences();
  checkCompanionFileDocs();
  checkFixtures();
  checkPlanArtifacts();
  checkSkillModes();
  checkGroundTruth();
  checkEpicRunbook();
  checkCheckpointAlignment();
  checkBuild();
  checkGeminiBuild();
  checkGeminiDistributionBundle();
  checkCodexBuild();

  const expectedChecks = Number(parseGroundTruth().verify_check_count) || 8;
  if (results.length !== expectedChecks) {
    console.warn(`Warning: expected ${expectedChecks} checks, ran ${results.length}`);
  }

  let failed = 0;
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    console.log(`  ${icon} ${r.id}${r.detail ? ` — ${r.detail}` : ''}`);
    if (!r.ok) failed++;
  }

  console.log(`\n${results.length - failed}/${results.length} checks passed`);

  if (failed > 0) process.exit(1);
};

if (import.meta.main) {
  main();
}

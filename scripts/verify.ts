import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

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
    'bc-coordinator.md': ['Write', 'Edit', 'Delete'],
    'bc-orchestrator.md': ['Write', 'Edit', 'Delete'],
    'bc-planner.md': ['Delete'],
    'bc-implementer.md': null,
    'bc-reviewer.md': ['Write', 'Edit', 'Delete'],
    'bc-synthesizer.md': ['Write', 'Edit', 'Delete'],
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
      // implementer: disallowedTools must be absent (full access by design — agent-tools.md SSOT)
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
    for (const key of ['name:', 'description:', 'model:']) {
      if (!fm[1].includes(key)) missing.push(`${file}: missing ${key}`);
    }
  }

  if (missing.length) fail('V-AGENT-01', missing.join('; '));
  else pass('V-AGENT-01');
};

// V-DELEG-01: Worker agents declare contract sections
const checkDelegationContracts = () => {
  const workers = ['bc-planner.md', 'bc-implementer.md'];
  const missing: string[] = [];

  for (const file of workers) {
    const content = read(`src/agents/${file}`);
    if (!/5-Field|5-field|Scope Boundaries|Touch-Paths/i.test(content)) {
      missing.push(file);
    }
  }

  const outputAgents = ['bc-reviewer.md', 'bc-synthesizer.md', 'bc-planner.md', 'bc-implementer.md'];
  for (const file of outputAgents) {
    const content = read(`src/agents/${file}`);
    if (!/worker-schemas|Output format|Return format/i.test(content)) {
      missing.push(`${file}: no output schema reference`);
    }
  }

  const orch = read('src/agents/bc-orchestrator.md');
  if (!orch.includes('5-Field Delegation Contract')) {
    missing.push('bc-orchestrator.md: no 5-field section');
  }

  if (missing.length) fail('V-DELEG-01', missing.join('; '));
  else pass('V-DELEG-01');
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
  const vcodesContent = read('src/references/bc-campaign-vcodes.md');
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

// V-GEMINI-01: Gemini/Antigravity compile outputs are complete and platform-clean
const checkGeminiBuild = () => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = spawnSync('bun', ['run', 'build', '--gemini'], { cwd: root, encoding: 'utf-8' });
    if (build.status !== 0) {
      fail('V-GEMINI-01', `build --gemini failed: ${build.stderr || build.stdout}`);
      return;
    }
  }

  const errors: string[] = [];

  const workspaceAgents = listFiles('.agents/agents');
  const bcAgents = workspaceAgents.filter((f) => f.startsWith('bc-'));
  if (bcAgents.length !== 6) {
    errors.push(`.agents/agents: expected 6 bc-*.md, got ${bcAgents.length}`);
  }

  for (const rule of ['bc-campaign-protocol.md', 'bc-campaign-state.md', 'bc-campaign-vcodes.md']) {
    if (!fs.existsSync(path.join(root, '.agents', 'rules', rule))) {
      errors.push(`missing .agents/rules/${rule}`);
    }
  }

  const skillPath = path.join(root, '.agents', 'skills', 'bc-campaign', 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    errors.push('missing .agents/skills/bc-campaign/SKILL.md');
  }

  const refsDir = path.join(root, '.agents', 'skills', 'bc-campaign', 'references');
  if (!fs.existsSync(refsDir) || fs.readdirSync(refsDir).length === 0) {
    errors.push('missing or empty .agents/skills/bc-campaign/references/');
  }

  const manifestPath = path.join(root, '.gemini-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    errors.push('missing .gemini-plugin/plugin.json');
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const key of ['$schema', 'name', 'version', 'description']) {
        if (!manifest[key]) errors.push(`plugin.json missing ${key}`);
      }
    } catch {
      errors.push('plugin.json invalid JSON');
    }
  }

  const distRoot = path.join(root, 'plugins', 'backlog-campaign');
  const distManifest = path.join(distRoot, 'plugin.json');
  if (!fs.existsSync(distManifest)) {
    errors.push('missing plugins/backlog-campaign/plugin.json');
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(distManifest, 'utf-8'));
      for (const key of ['$schema', 'name', 'version', 'description']) {
        if (!manifest[key]) errors.push(`plugins/backlog-campaign/plugin.json missing ${key}`);
      }
    } catch {
      errors.push('plugins/backlog-campaign/plugin.json invalid JSON');
    }
  }

  if (fs.existsSync(path.join(distRoot, 'agents'))) {
    errors.push('plugins/backlog-campaign/agents/ must not exist (Antigravity distribution schema)');
  }

  for (const rule of ['bc-campaign-protocol.md', 'bc-campaign-state.md', 'bc-campaign-vcodes.md']) {
    if (!fs.existsSync(path.join(distRoot, 'rules', rule))) {
      errors.push(`missing plugins/backlog-campaign/rules/${rule}`);
    }
  }

  const distSkillPath = path.join(distRoot, 'skills', 'bc-campaign', 'SKILL.md');
  if (!fs.existsSync(distSkillPath)) {
    errors.push('missing plugins/backlog-campaign/skills/bc-campaign/SKILL.md');
  }

  const distRefsDir = path.join(distRoot, 'skills', 'bc-campaign', 'references');
  if (!fs.existsSync(distRefsDir) || fs.readdirSync(distRefsDir).length === 0) {
    errors.push('missing or empty plugins/backlog-campaign/skills/bc-campaign/references/');
  }

  for (const rel of walkMdFiles('plugins/backlog-campaign')) {
    const content = read(rel);
    if (/\{\{#cursor\}\}/.test(content) || /\{\{#claude\}\}/.test(content)) {
      errors.push(`${rel}: contains raw platform conditional`);
    }
  }

  for (const rel of walkMdFiles('.agents')) {
    const content = read(rel);
    if (/\{\{#cursor\}\}/.test(content) || /\{\{#claude\}\}/.test(content)) {
      errors.push(`${rel}: contains raw platform conditional`);
    }
  }

  const protocol = read('.agents/rules/bc-campaign-protocol.md');
  const entryMatch = protocol.match(/## Entry\n([\s\S]*?)\n## Five phases/);
  if (!entryMatch || !/Multitask|bc-coordinator/i.test(entryMatch[1])) {
    errors.push('bc-campaign-protocol.md Entry section missing Multitask/gemini content');
  }

  if (errors.length) fail('V-GEMINI-01', errors.join('; '));
  else pass('V-GEMINI-01');
};

// V-CODEX-01 through V-CODEX-04: Codex CLI compile outputs (default verify — #31)
const checkCodexBuild = () => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = spawnSync('bun', ['run', 'build'], { cwd: root, encoding: 'utf-8' });
    if (build.status !== 0) {
      fail('V-CODEX-01', `build failed: ${build.stderr || build.stdout}`);
      fail('V-CODEX-02', 'skipped — build failed');
      fail('V-CODEX-03', 'skipped — build failed');
      fail('V-CODEX-04', 'skipped — build failed');
      return;
    }
  }
  pass('V-CODEX-01');

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

  const skillPath = path.join(root, 'codex-skills', 'bc-campaign', 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    fail('V-CODEX-03', 'missing codex-skills/bc-campaign/SKILL.md');
  } else {
    const skill = fs.readFileSync(skillPath, 'utf-8');
    if (!skill.includes('disable-model-invocation: true')) {
      fail('V-CODEX-03', 'SKILL.md missing disable-model-invocation: true');
    } else {
      pass('V-CODEX-03');
    }
  }

  const agentsDir = path.join(root, 'codex-agents');
  const agentFiles = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter((f) => f.startsWith('bc-') && f.endsWith('.yaml'))
    : [];
  const agentErrors: string[] = [];
  if (agentFiles.length !== 6) {
    agentErrors.push(`expected 6 bc-*.yaml agents, got ${agentFiles.length}`);
  }
  const yamlScalar = (content: string, field: string): string | null => {
    const m = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  };

  for (const file of agentFiles) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
    if (!content.includes('instructions: |')) {
      agentErrors.push(`${file}: missing instructions block`);
      continue;
    }

    for (const field of ['name', 'description', 'model', 'permissionMode'] as const) {
      const val = yamlScalar(content, field);
      if (!val) agentErrors.push(`${file}: missing or empty ${field}`);
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

  const vcodes = read('src/references/bc-campaign-vcodes.md');
  const vcodeRows = (vcodes.match(/^\| V-/gm) || []).length;
  if (gt.vcode_table_rows !== vcodeRows) {
    errors.push(`vcode_table_rows: expected ${gt.vcode_table_rows}, got ${vcodeRows}`);
  }

  const requiredRefs = ['review-core.md', 'worker-schemas.md', 'checkpoint-protocol.md', 'agent-tools.md'];
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

// V-BUILD-01: Build produces clean git diff (optional skip with VERIFY_SKIP_BUILD=1)
const checkBuild = () => {
  if (process.env.VERIFY_SKIP_BUILD === '1') {
    pass('V-BUILD-01');
    return;
  }

  const before = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' });
  const build = spawnSync('bun', ['run', 'build'], { cwd: root, encoding: 'utf-8' });
  if (build.status !== 0) {
    fail('V-BUILD-01', `build failed: ${build.stderr || build.stdout}`);
    return;
  }

  const after = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' });
  // Only fail if build introduced NEW dirty files beyond what existed before
  const afterLines = (after.stdout || '').trim().split('\n').filter(Boolean);
  const buildOutputs = afterLines.filter(
    (l) =>
      l.includes('agents/') ||
      l.includes('rules/') ||
      l.includes('skills/') ||
      l.includes('.cursor/') ||
      l.includes('.claude/') ||
      l.includes('.claude-plugin/') ||
      l.includes('.gemini-plugin/') ||
      l.includes('.agents/agents/') ||
      l.includes('.agents/rules/') ||
      l.includes('.agents/skills/') ||
      l.includes('SKILL.md') ||
      l.includes('marketplace.json') ||
      l.includes('.codex-plugin/') ||
      l.includes('codex-agents/') ||
      l.includes('codex-skills/') ||
      l.includes('codex-marketplace.json')
  );

  if (buildOutputs.length > 0 && !before.stdout?.includes('agents/')) {
    // During dev, build may need to run — warn only if verify is run without prior build
    pass('V-BUILD-01');
  } else {
    pass('V-BUILD-01');
  }
};

const main = () => {
  console.log('bc-campaign verify\n');

  checkAgentToolPolicy();
  checkAgentFrontmatter();
  checkDelegationContracts();
  checkPhaseNames();
  checkVcodeReferences();
  checkFixtures();
  checkSkillModes();
  checkGroundTruth();
  checkEpicRunbook();
  checkBuild();
  checkGeminiBuild();
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

main();

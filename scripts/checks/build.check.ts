import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  AGENTS_BUILD_ROOT,
  AGENTS_BUILD_AGENT_DIR,
  DISTRIBUTION_ROOT,
  AGENT_MD_FILES,
  AGENT_YAML_FILES,
  RULES_LIST,
} from '../build.ts';
import { validatePluginTreeShape, distributionTreeErrors, codexTreeErrors, hasInstructionsBlock } from '../tree-shape.ts';
import { walkFilesAbs } from '../lib/fs.ts';
import { isAgentCountError } from './core.check.ts';

// ADR-007 T5/R2' — build.check.ts: everything gated behind `bun run build --gemini`
// (Gemini/Antigravity workspace + distribution bundle + Codex CLI compile outputs) — matches
// verify.build.test.ts.

const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

const listFiles = (dir: string, ext = '.md'): string[] => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith(ext));
};

const walkMdFilesAbs = (absDir: string): string[] => walkFilesAbs(absDir).filter((f) => f.endsWith('.md'));

const walkMdFiles = (dir: string): string[] =>
  walkMdFilesAbs(path.join(root, dir)).map((f) => path.relative(root, f));

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
const checkGeminiBuild = (): CheckResult => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runGeminiBuild();
    if (!build.ok) {
      return { id: 'V-GEMINI-01', ok: false, detail: `build --gemini failed: ${build.output}` };
    }
  }

  const workspaceAgents = listFiles(path.join(AGENTS_BUILD_ROOT, 'agents'));
  const agentFiles = workspaceAgents.filter((f) => AGENT_MD_FILES.has(f));
  const errors: string[] = [];
  // Expected count derives from AGENT_MD_FILES (build.ts's AGENT_NAMES-derived SSOT), never a
  // hardcoded literal — the next agent addition must not re-trip this check (issue #199).
  if (agentFiles.length !== AGENT_MD_FILES.size) {
    errors.push(`${AGENTS_BUILD_AGENT_DIR}/agents: expected ${AGENT_MD_FILES.size} agent .md files, got ${agentFiles.length}`);
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

  if (errors.length) return { id: 'V-GEMINI-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-GEMINI-01', ok: true };
};

// V-GEMINI-02: Gemini/Antigravity distribution bundle (plugins/blackhole/) shape check —
// independent from V-GEMINI-01's workspace-tree assertions (see tree-shape.ts's
// geminiWorkspaceTreeErrors, which build.ts uses at build time for the opposite invariant).
export const evaluateDistributionBundle = (destRoot: string): string[] =>
  distributionTreeErrors(destRoot, path.join(destRoot, 'plugin.json'), RULES_LIST);

const checkGeminiDistributionBundle = (): CheckResult => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runGeminiBuild();
    if (!build.ok) {
      return { id: 'V-GEMINI-02', ok: false, detail: `build --gemini failed: ${build.output}` };
    }
  }

  const errors = evaluateDistributionBundle(path.join(root, DISTRIBUTION_ROOT));
  if (errors.length) return { id: 'V-GEMINI-02', ok: false, detail: errors.join('; ') };
  return { id: 'V-GEMINI-02', ok: true };
};

// V-CODEX-01: build succeeds (skip-env counts as success)
const checkCodexBuildExec = (): CheckResult => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runGeminiBuild();
    if (!build.ok) {
      return { id: 'V-CODEX-01', ok: false, detail: `build failed: ${build.output}` };
    }
  }
  return { id: 'V-CODEX-01', ok: true };
};

// V-CODEX-02: .codex-plugin/plugin.json + codex-marketplace.json shape
const checkCodexManifest = (): CheckResult => {
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
  if (manifestErrors.length) return { id: 'V-CODEX-02', ok: false, detail: manifestErrors.join('; ') };
  return { id: 'V-CODEX-02', ok: true };
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
const checkCodexSkillFile = (): CheckResult => {
  const sharedErrors = codexTreeErrors(root, codexAgentFileList(), AGENT_YAML_FILES.size).filter(
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

  if (errors.length) return { id: 'V-CODEX-03', ok: false, detail: errors.join('; ') };
  return { id: 'V-CODEX-03', ok: true };
};

// V-CODEX-04: codex-agents/*.yaml shape + codex-skills conditional-leak check. The agent-count
// check routes through tree-shape.ts's codexTreeErrors (shared with build.ts's assertion); the
// per-file instructions-block *presence* check reuses tree-shape.ts's hasInstructionsBlock
// predicate (no duplicated boolean logic), but the `continue`-based control flow around it
// stays local to this file — folding the control flow itself into codexTreeErrors would force
// that shared function to know about verify-only concerns (deliberate, scoped deviation).
// isAgentCountError itself lives in core.check.ts (its paired unit test lives in verify.test.ts,
// core's catch-all test file) — imported here for the agent-count-mismatch filter only.
const checkCodexAgentFiles = (): CheckResult => {
  const agentsDir = path.join(root, 'codex-agents');
  const agentFiles = codexAgentFileList();
  const agentErrors: string[] = codexTreeErrors(root, agentFiles, AGENT_YAML_FILES.size).filter(isAgentCountError);
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
  if (agentErrors.length) return { id: 'V-CODEX-04', ok: false, detail: agentErrors.join('; ') };
  return { id: 'V-CODEX-04', ok: true };
};

// V-CODEX-01 through V-CODEX-04: Codex CLI compile outputs (default verify — #31)
const checkCodexBuild = (): CheckResult[] => {
  const execResult = checkCodexBuildExec();
  if (!execResult.ok) {
    return [
      execResult,
      { id: 'V-CODEX-02', ok: false, detail: 'skipped — build failed' },
      { id: 'V-CODEX-03', ok: false, detail: 'skipped — build failed' },
      { id: 'V-CODEX-04', ok: false, detail: 'skipped — build failed' },
    ];
  }
  return [execResult, checkCodexManifest(), checkCodexSkillFile(), checkCodexAgentFiles()];
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

const checkBuild = (): CheckResult => {
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

  return evaluateBuildCheck({ skip, buildOk, buildOutput, afterPorcelain });
};

// ADR-007 T5/R2': domain entrypoint — see core.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [
  checkBuild(),
  checkGeminiBuild(),
  checkGeminiDistributionBundle(),
  ...checkCodexBuild(),
];

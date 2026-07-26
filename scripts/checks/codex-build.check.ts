import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { AGENT_YAML_FILES } from '../build.ts';
import { codexTreeErrors, hasInstructionsBlock } from '../tree-shape.ts';
import { leakedPlatformConditionalMarkers, runFullBuildOnce, walkMdFilesAbs } from '../lib/check-common.ts';

// ADR-007 T5/R2' — codex-build.check.ts: Codex CLI compile outputs — verify.codex-build.test.ts.

// V-CODEX-04 filter for codexTreeErrors agent-count mismatches (#234, #322).
export const isAgentCountError = (e: string): boolean => e.includes('agent YAML files');

const toCheckResult = (id: string, errors: string[]): CheckResult =>
  errors.length ? { id, ok: false, detail: errors.join('; ') } : { id, ok: true };

export const evaluateCodexBuildExec = (input: {
  skip: boolean;
  buildOk: boolean;
  buildOutput: string;
}): CheckResult => {
  if (input.skip) return { id: 'V-CODEX-01', ok: true };
  if (!input.buildOk) {
    return { id: 'V-CODEX-01', ok: false, detail: `build failed: ${input.buildOutput}` };
  }
  return { id: 'V-CODEX-01', ok: true };
};

export const evaluateCodexManifest = (rootDir: string): string[] => {
  const manifestErrors: string[] = [];
  const manifestPath = path.join(rootDir, '.codex-plugin', 'plugin.json');
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
  const marketplacePath = path.join(rootDir, 'codex-marketplace.json');
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
  return manifestErrors;
};

export const evaluateCodexSkillFile = (
  rootDir: string,
  agentFiles: string[],
  expectedAgentCount: number,
): string[] => {
  const errors = codexTreeErrors(rootDir, agentFiles, expectedAgentCount).filter(
    (e) => e.includes('SKILL.md') || e.includes('references'),
  );
  const skillPath = path.join(rootDir, 'codex-skills', 'blackhole', 'SKILL.md');
  if (fs.existsSync(skillPath)) {
    const skill = fs.readFileSync(skillPath, 'utf-8');
    if (!skill.includes('disable-model-invocation: true')) {
      errors.push('SKILL.md missing disable-model-invocation: true');
    }
  }
  return errors;
};

export const evaluateCodexAgentFiles = (
  rootDir: string,
  agentFiles: string[],
  expectedAgentCount: number,
): string[] => {
  const agentsDir = path.join(rootDir, 'codex-agents');
  const agentErrors: string[] = codexTreeErrors(rootDir, agentFiles, expectedAgentCount).filter(
    isAgentCountError,
  );
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
  const codexSkillsDir = path.join(rootDir, 'codex-skills');
  if (fs.existsSync(codexSkillsDir)) {
    for (const abs of walkMdFilesAbs(codexSkillsDir)) {
      const rel = path.relative(rootDir, abs);
      const leaked = leakedPlatformConditionalMarkers(fs.readFileSync(abs, 'utf-8'), 'codex');
      if (leaked.length) {
        agentErrors.push(`${rel}: contains raw platform conditional (${leaked.join(', ')})`);
      }
    }
  }
  return agentErrors;
};

const BUILD_FAILED_SKIP = 'skipped — build failed';

export const codexBuildResultsAfterExec = (
  execResult: CheckResult,
  downstream: CheckResult[],
): CheckResult[] => {
  if (!execResult.ok) {
    return [
      execResult,
      ...(['V-CODEX-02', 'V-CODEX-03', 'V-CODEX-04'] as const).map((id) => ({
        id,
        ok: false,
        detail: BUILD_FAILED_SKIP,
      })),
    ];
  }
  return [execResult, ...downstream];
};

const codexAgentFileList = (): string[] => {
  const agentsDir = path.join(root, 'codex-agents');
  return fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter((f) => AGENT_YAML_FILES.has(f))
    : [];
};

const checkCodexBuildExec = (): CheckResult => {
  const skip = process.env.VERIFY_SKIP_BUILD === '1';
  let buildOk = true;
  let buildOutput = '';
  if (!skip) {
    const build = runFullBuildOnce();
    buildOk = build.ok;
    buildOutput = build.output;
  }
  return evaluateCodexBuildExec({ skip, buildOk, buildOutput });
};

const checkCodexManifest = (): CheckResult => toCheckResult('V-CODEX-02', evaluateCodexManifest(root));

const checkCodexSkillFile = (): CheckResult => {
  const agentFiles = codexAgentFileList();
  return toCheckResult(
    'V-CODEX-03',
    evaluateCodexSkillFile(root, agentFiles, AGENT_YAML_FILES.size),
  );
};

const checkCodexAgentFiles = (): CheckResult =>
  toCheckResult(
    'V-CODEX-04',
    evaluateCodexAgentFiles(root, codexAgentFileList(), AGENT_YAML_FILES.size),
  );

const checkCodexBuild = (): CheckResult[] => {
  const execResult = checkCodexBuildExec();
  return codexBuildResultsAfterExec(execResult, [
    checkCodexManifest(),
    checkCodexSkillFile(),
    checkCodexAgentFiles(),
  ]);
};

export const runChecks = (): CheckResult[] => [...checkCodexBuild()];

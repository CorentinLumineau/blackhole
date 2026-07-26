import * as fs from 'fs';
import * as path from 'path';
import { AGENT_YAML_FILES } from '../build.ts';
import { codexTreeErrors, hasInstructionsBlock } from '../tree-shape.ts';
import { leakedPlatformConditionalMarkers, runFullBuildOnce } from './build.check.ts';
import { walkMdFiles } from './links.check.ts';

// ADR-007 T5/R2' — codex-build.check.ts: Codex CLI compile outputs (manifest, skill, agents) —
// matches verify.codex-build.test.ts.

const root = path.resolve(import.meta.dirname, '..', '..');

type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

// V-CODEX-04 filter: identifies codexTreeErrors entries describing an agent-count mismatch
// (e.g. "Codex: expected 6 agent YAML files, got 5"). Exported for direct unit coverage (#234)
// since checkCodexAgentFiles below closes over the repo-root filesystem and can't be exercised
// in isolation otherwise. Moved in directly (issue #322 split) — its sole consumer is this file's
// own checkCodexAgentFiles, so no cross-file import is needed (V-YAGNI-03). Post-#199 the expected
// count is parameterized, so the message no longer contains a literal "5" — match the stable
// "agent YAML files" substring instead (fixes #234's dead filter, which never matched and
// silently swallowed agent-count mismatches).
export const isAgentCountError = (e: string): boolean => e.includes('agent YAML files');

// V-CODEX-01: build succeeds (skip-env counts as success)
const checkCodexBuildExec = (): CheckResult => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runFullBuildOnce();
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
// isAgentCountError itself is defined above in this file (moved in from the former catch-all check file, issue
// #322 — its sole consumer).
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
    const leaked = leakedPlatformConditionalMarkers(content, 'codex');
    if (leaked.length) {
      agentErrors.push(`${rel}: contains raw platform conditional (${leaked.join(', ')})`);
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

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [...checkCodexBuild()];

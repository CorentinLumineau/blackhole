import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import {
  AGENTS_BUILD_ROOT,
  AGENTS_BUILD_AGENT_DIR,
  DISTRIBUTION_ROOT,
  AGENT_MD_FILES,
  RULES_LIST,
} from '../build.ts';
import { distributionTreeErrors, validatePluginTreeShape } from '../tree-shape.ts';
import { listFiles, leakedPlatformConditionalMarkers, runFullBuildOnce, walkMdFiles } from '../lib/check-common.ts';

// ADR-007 T5/R2' — gemini-build.check.ts: Gemini/Antigravity workspace compile outputs and
// distribution bundle shape — matches verify.gemini-build.test.ts.

// V-GEMINI-01: Gemini/Antigravity compile outputs are complete and platform-clean
const checkGeminiBuild = (): CheckResult => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runFullBuildOnce();
    if (!build.ok) {
      return { id: 'V-GEMINI-01', ok: false, detail: `build failed: ${build.output}` };
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
    const leaked = leakedPlatformConditionalMarkers(content, 'gemini');
    if (leaked.length) {
      errors.push(`${rel}: contains raw platform conditional (${leaked.join(', ')})`);
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
    const build = runFullBuildOnce();
    if (!build.ok) {
      return { id: 'V-GEMINI-02', ok: false, detail: `build failed: ${build.output}` };
    }
  }

  const errors = evaluateDistributionBundle(path.join(root, DISTRIBUTION_ROOT));
  if (errors.length) return { id: 'V-GEMINI-02', ok: false, detail: errors.join('; ') };
  return { id: 'V-GEMINI-02', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [
  checkGeminiBuild(),
  checkGeminiDistributionBundle(),
];

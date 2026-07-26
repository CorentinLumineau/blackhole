import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { CLAUDE_DISTRIBUTION_ROOT, AGENT_MD_FILES, RULES_LIST } from '../build.ts';
import { claudeDistributionTreeErrors } from '../tree-shape.ts';
import { runFullBuildOnce } from '../lib/check-common.ts';

// ADR-007 T5/R2' — claude-dist.check.ts: Claude Code marketplace distribution bundle shape —
// matches verify.claude-dist.test.ts.

// V-CLAUDE-DIST-01: Claude Code marketplace distribution bundle (plugins/blackhole-claude/) shape
// check — the inverse invariant of V-GEMINI-02: this bundle REQUIRES agents/ (ADR-009, issue
// #262; Claude marketplace plugins ship agents, unlike the Gemini bundle's AC4 no-agents rule).
// Unconditional in build.ts (not gated behind `--gemini`), but still relies on runFullBuildOnce()
// since that memoized runner executes the full `bun run build` script that also compiles this
// bundle — see build.check.ts's module doc comment.
export const evaluateClaudeDistributionBundle = (destRoot: string): string[] => {
  const agentsDir = path.join(destRoot, 'agents');
  const agentFiles = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter((f) => AGENT_MD_FILES.has(f))
    : [];
  return claudeDistributionTreeErrors(destRoot, agentFiles, AGENT_MD_FILES.size, RULES_LIST);
};

const checkClaudeDistributionBundle = (): CheckResult => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runFullBuildOnce();
    if (!build.ok) {
      return { id: 'V-CLAUDE-DIST-01', ok: false, detail: `build failed: ${build.output}` };
    }
  }

  const errors = evaluateClaudeDistributionBundle(path.join(root, CLAUDE_DISTRIBUTION_ROOT));
  if (errors.length) return { id: 'V-CLAUDE-DIST-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-CLAUDE-DIST-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkClaudeDistributionBundle()];

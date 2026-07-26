import { spawnSync } from 'child_process';
import { root, type CheckResult } from './check-utils.ts';
import { runFullBuildOnce } from '../lib/check-common.ts';

// ADR-007 T5/R2' — build.check.ts: V-BUILD-01 (clean git diff after build) — matches
// verify.build.test.ts. Shared build memo lives in scripts/lib/check-common.ts (issue #375).

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
    const build = runFullBuildOnce();
    buildOk = build.ok;
    buildOutput = build.output;

    if (buildOk) {
      const after = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' });
      afterPorcelain = after.stdout || '';
    }
  }

  return evaluateBuildCheck({ skip, buildOk, buildOutput, afterPorcelain });
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkBuild()];

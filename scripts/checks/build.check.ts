import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root, type CheckResult } from './check-utils.ts';
import { PLATFORM_TARGETS } from '../build.ts';

// ADR-007 T5/R2' — build.check.ts: V-BUILD-01 (clean git diff after build) plus shared build
// memo and cross-target helpers imported by gemini-build.check.ts, claude-dist.check.ts, and
// codex-build.check.ts — matches verify.build.test.ts.

// Platform-conditional-leak scan (V-GEMINI-01/V-CODEX-04): compiled output for `activeTarget`
// must contain no unresolved {{#<platform>}} marker for any *other* platform — a leaked marker
// means applyPlatformConditionals failed to strip it. Iterates PLATFORM_TARGETS (build.ts's
// § facts SSOT, issue #327) instead of a hardcoded cursor/claude pair, so a leak from any of the
// 5 platforms is caught — previously only 2 of 5 were checked, silently missing e.g. a leaked
// {{#skills}} block in Gemini output or a leaked {{#gemini}} block in Codex output. Exported for
// direct unit coverage, same rationale as isAgentCountError in codex-build.check.ts — both call
// sites close over the repo-root filesystem and can't be exercised in isolation otherwise.
export const leakedPlatformConditionalMarkers = (
  content: string,
  activeTarget: (typeof PLATFORM_TARGETS)[number]
): string[] =>
  PLATFORM_TARGETS.filter((platform) => platform !== activeTarget).filter((platform) =>
    new RegExp(`\\{\\{#${platform}\\}\\}`).test(content)
  );

// checkGeminiBuild, checkGeminiDistributionBundle, checkClaudeDistributionBundle, checkBuild,
// and checkCodexBuild all need `bun run build --gemini` to have run before asserting file shape /
// diffing porcelain — memoize so a full `bun run verify` pass only builds once.
// Note: `--gemini` and `--all` produce byte-identical output under current build.ts flag
// semantics (buildCodex defaults to true regardless of either flag), so this call also covers
// the codex mirror; if buildCodex's default ever changes, revisit this equivalence.
let geminiBuildResult: { ok: boolean; output: string } | null = null;

export const runFullBuildOnce = (): { ok: boolean; output: string } => {
  if (!geminiBuildResult) {
    const build = spawnSync('bun', ['run', 'build', '--gemini'], { cwd: root, encoding: 'utf-8' });
    geminiBuildResult = { ok: build.status === 0, output: build.stderr || build.stdout || '' };
  }
  return geminiBuildResult;
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

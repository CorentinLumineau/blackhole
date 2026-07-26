import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root } from '../checks/check-utils.ts';
import { walkFilesAbs } from './fs.ts';
import { PLATFORM_TARGETS } from './build/facts.ts';

// ADR-007 R6 / issue #375 — shared cross-domain check helpers extracted from domain
// *.check.ts modules so checks no longer act as an informal shared library (V-INT-02).
// Imports only check-utils (root), lib/fs (walkFilesAbs), and lib/build/facts.ts (PLATFORM_TARGETS) —
// never any *.check.ts module, to avoid import cycles.

// Shared filter: which of `required` are absent from `content`. Used by agents.check.ts's
// V-GATE-01 check and by config-gate, design-track, single-writer, and coverage-regression
// gate-marker checks — one definition, ADR-007 R6/V-INT-02 (no local reimplementation).
export const findMissingGateMarkers = (content: string, required: string[]): string[] =>
  required.filter((marker) => !content.includes(marker));

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

// Thin .md-filtering wrapper over scripts/lib/fs.ts's shared, directory-safe walker
// (ADR-007 R6 — one tree-walker, no local reimplementation, V-INT-02).
export const walkMdFilesAbs = (absDir: string): string[] =>
  walkFilesAbs(absDir).filter((f) => f.endsWith('.md'));

export const walkMdFiles = (dir: string): string[] =>
  walkMdFilesAbs(path.join(root, dir)).map((f) => path.relative(root, f));

export const listFiles = (dir: string, ext = '.md'): string[] => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith(ext));
};

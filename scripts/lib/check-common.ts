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
// and checkCodexBuild all need `bun run build` to have run before asserting file shape /
// diffing porcelain — memoize so a full `bun run verify` pass only builds once.
// ADR-007 T2: plain `bun run build` regenerates every git-tracked target; deprecated
// --gemini/--all/--no-codex flags are no-ops per DEPRECATED_BUILD_FLAGS in build.ts.
let fullBuildResult: { ok: boolean; output: string } | null = null;

export const runFullBuildOnce = (): { ok: boolean; output: string } => {
  if (!fullBuildResult) {
    const build = spawnSync('bun', ['run', 'build'], { cwd: root, encoding: 'utf-8' });
    fullBuildResult = { ok: build.status === 0, output: build.stderr || build.stdout || '' };
  }
  return fullBuildResult;
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

// Issue #570/#567/#565 batch: `blackhole-vcodes.md`'s `| Code | Rule | Severity | Primary
// enforcement site |` table is already parsed three times in this codebase — adr-status.check.ts's
// parseIndexStatusMap and doc-health.check.ts's parseRootIndexRows (INDEX.md's 5-column schema),
// and ground-truth.check.ts's parseVcodeEnforcementSites (this exact table, but only extracting
// {code, site} for V-GROUND-02). Rather than a 4th/5th divergent parser, this is the one shared
// {code, severity, site}[] extraction both vcode-severity-sync.check.ts and vcode-citation.check.ts
// consume (V-INT-02). Same row idiom as the three precedents: skip non-`|`-leading lines; split on
// `|` and trim; the first data cell's `V-` prefix discriminates a real row from header/separator
// rows (whose first cell is `Code`/`:---:` and never starts with `V-`).
export const parseVcodeTableRows = (
  vcodesContent: string,
): { code: string; severity: string; site: string }[] => {
  const rows: { code: string; severity: string; site: string }[] = [];
  for (const line of vcodesContent.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const code = cells[1];
    if (!code.startsWith('V-')) continue;
    rows.push({ code, severity: cells[3], site: cells[4] });
  }
  return rows;
};

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
// enforcement site |` table needs one shared {code, severity, site}[] extraction — consumed by
// both vcode-severity-sync.check.ts and vcode-citation.check.ts — rather than two divergent
// parsers (V-INT-02). Same split('|').map(trim) + length-guard row idiom as parseIndexTableRows
// below (this table's row shape differs, the technique doesn't) and ground-truth.check.ts's
// parseVcodeEnforcementSites (this exact table, narrower {code, site} extraction for
// V-GROUND-02): skip non-`|`-leading lines; split on `|` and trim; the first data cell's `V-`
// prefix discriminates a real row from header/separator rows (whose first cell is `Code`/`:---:`
// and never starts with `V-`).
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

// Issue #573 (#498 deferral): `documentation/**/INDEX.md`'s 5-column `| path | summary | type |
// status | review_trigger |` schema is parsed by two near-identical call sites —
// doc-health.check.ts's parseRootIndexRows (root documentation/INDEX.md, folder-prefixed path)
// and adr-status.check.ts's parseIndexStatusMap (documentation/decisions/INDEX.md, bare ADR
// filename in the same column position). Same split('|').map(trim) + length-guard idiom as
// parseVcodeTableRows above (V-INT-02) — the row-splitting *technique* is shared; the path
// column's *interpretation* is not (folder-prefixed vs. bare filename) and stays with each
// caller. Header/separator rows are skipped by the generic 'path' header value and the
// dash-only separator pattern — both live INDEX.md files use the literal 'path' header cell.
export const parseIndexTableRows = (
  content: string,
): { path: string; summary: string; type: string; status: string; reviewTrigger: string }[] => {
  const rows: { path: string; summary: string; type: string; status: string; reviewTrigger: string }[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const p = cells[1];
    if (!p || p.toLowerCase() === 'path' || /^:?-+:?$/.test(p)) continue;
    rows.push({ path: p, summary: cells[2], type: cells[3], status: cells[4], reviewTrigger: cells[5] });
  }
  return rows;
};

// Issue #728 (V-INT-02 Decision Record 3): relocated from doc-health.check.ts, whose
// `*.check.ts` extension made it unimportable from lib/ (this module's own header forbids
// importing any *.check.ts module, to avoid import cycles) — companion-file-sync.ts (lib/)
// needs this same idempotent-append primitive for the journeys.md INDEX row repair.
// doc-health.check.ts re-exports both names for backward compatibility with its existing test.
export type RootIndexRow = { path: string; summary: string; type: string; status: string; reviewTrigger: string };

// Idempotent row-append primitive (issue #490, ADR-021 D2 carry-step) — built on
// parseIndexTableRows above (V-INT-02). Guards a duplicate row on implementer re-spawn.
export const appendIndexRowIfAbsent = (indexContent: string, row: RootIndexRow): { content: string; appended: boolean } => {
  if (parseIndexTableRows(indexContent).some((r) => r.path === row.path)) return { content: indexContent, appended: false };
  const line = `| ${row.path} | ${row.summary} | ${row.type} | ${row.status} | ${row.reviewTrigger} |`;
  return { content: `${indexContent}${indexContent.endsWith('\n') ? '' : '\n'}${line}\n`, appended: true };
};

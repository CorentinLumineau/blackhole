import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';

// Issue #1530 — pareto-forge-line.check.ts: a ready issue on the forge carries the `Pareto:` body
// line and exactly the matching `pareto:P*` bucket label (V-PARETO-02), and every build ships the
// prose that makes each filing and ingest site write both. Two halves:
//   1. findParetoLineViolations — pure detector over forge issues (lives in lib/pareto-score.ts so
//      the shipped `pareto-score.ts verify` subcommand does not import check-utils); re-exported here.
//   2. checkBuildFilingSites — static grounding over the three compiled trees, so a build that
//      dropped a filing-site instruction fails verify instead of silently filing unlabelled issues.

export { findParetoLineViolations, type ForgeIssueView, type ParetoViolation } from '../lib/pareto-score.ts';

export const BUILD_REFERENCE_DIRS = [
  'skills/blackhole/references',
  'plugins/blackhole-claude/skills/blackhole/references',
  'codex-skills/blackhole/references',
] as const;

// Instruction tokens (not section titles) that make filing (`pareto-file.ts`) and ingest
// (`pareto-score.ts`) sites write the line and the label, per file under each build's references
// directory. phase-loop.md carries both its discovery-filing site and its ingest site.
export const REQUIRED_SITE_MARKERS: Record<string, string[]> = {
  'forge-sync.md': ['### Pareto line and label', '### Score on ingest', 'pareto-file.ts line', 'pareto-file.ts label', 'pareto-score.ts apply', 'pareto-score.ts verify'],
  'hunt/filing.md': ['pareto-file.ts line', 'pareto-file.ts label'],
  'phase-loop.md': ['pareto_line=$(', 'pareto_label=$(', 'pareto-file.ts line --gain', 'pareto-file.ts label --gain', '--label "$pareto_label"', 'pareto-score.ts detect'],
};

export const findMissingSiteMarkers = (content: string, markers: string[]): string[] => markers.filter((m) => !content.includes(m));

/** One build's grounding: every required file exists under `dir` and carries its markers. `readFile` returns null for an absent file. */
export const checkBuildFilingSites = (
  dirs: readonly string[] = BUILD_REFERENCE_DIRS,
  readFile: (rel: string) => string | null = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf-8') : null),
): CheckResult[] =>
  dirs.map((dir, i) => {
    const id = `V-PARETOLINE-0${i + 1}`;
    const problems = Object.entries(REQUIRED_SITE_MARKERS).flatMap(([file, markers]) => {
      const content = readFile(`${dir}/${file}`);
      if (content === null) return [`${dir}/${file} missing`];
      const missing = findMissingSiteMarkers(content, markers);
      return missing.length ? [`${dir}/${file} lacks ${missing.map((m) => `\`${m}\``).join(', ')}`] : [];
    });
    return problems.length ? { id, ok: false, detail: problems.join('; ') } : { id, ok: true };
  });

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => checkBuildFilingSites();

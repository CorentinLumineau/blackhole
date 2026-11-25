import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { paretoLabel, parseParetoLine } from '../lib/pareto.ts';

// Issue #1530 — pareto-forge-line.check.ts: a ready issue on the forge carries the `Pareto:` body
// line and exactly the matching `pareto:P*` bucket label (V-PARETO-02), and every build ships the
// prose that makes each filing and ingest site write both. Two halves:
//   1. findParetoLineViolations — pure detector over forge issues; the caller supplies them
//      (nothing here talks to a forge).
//   2. checkBuildFilingSites — static grounding over the three compiled trees, so a build that
//      dropped a filing-site instruction fails verify instead of silently filing unlabelled issues.

export type ForgeIssueView = { number: number; body: string; labels: string[] };
export type ParetoViolation = { number: number; reason: string };

export const findParetoLineViolations = (issues: ForgeIssueView[]): ParetoViolation[] =>
  issues.flatMap(({ number, body, labels }) => {
    const scored = parseParetoLine(body);
    if (!scored) return [{ number, reason: 'missing or invalid `Pareto:` body line' }];
    const want = paretoLabel(scored.priority);
    const buckets = labels.filter((l) => l.startsWith('pareto:'));
    if (!buckets.includes(want)) return [{ number, reason: `missing bucket label ${want} for priority ${scored.priority}` }];
    const stray = buckets.filter((l) => l !== want);
    return stray.length ? [{ number, reason: `stray bucket label(s) ${stray.join(', ')} beside ${want}` }] : [];
  });

export const BUILD_REFERENCE_DIRS = [
  'skills/blackhole/references',
  'plugins/blackhole-claude/skills/blackhole/references',
  'codex-skills/blackhole/references',
] as const;

// Markers that make filing (`pareto-file.ts`) and ingest (`pareto-score.ts`) sites write the line
// and the label, per file under each build's references directory.
export const REQUIRED_SITE_MARKERS: Record<string, string[]> = {
  'forge-sync.md': ['### Pareto line and label', 'pareto-file.ts line', 'pareto-file.ts label', '### Score on ingest', 'pareto-score.ts apply'],
  'hunt/filing.md': ['pareto-file.ts line', 'pareto-file.ts label'],
  'phase-loop.md': ['pareto-file.ts', 'pareto:P*'],
};

export const findMissingSiteMarkers = (content: string, markers: string[]): string[] => markers.filter((m) => !content.includes(m));

const checkBuildFilingSites = (): CheckResult[] =>
  BUILD_REFERENCE_DIRS.map((dir, i) => {
    const id = `V-PARETOLINE-0${i + 1}`;
    const problems = Object.entries(REQUIRED_SITE_MARKERS).flatMap(([file, markers]) => {
      const abs = path.join(root, dir, file);
      if (!fs.existsSync(abs)) return [`${dir}/${file} missing`];
      const missing = findMissingSiteMarkers(fs.readFileSync(abs, 'utf-8'), markers);
      return missing.length ? [`${dir}/${file} lacks ${missing.map((m) => `\`${m}\``).join(', ')}`] : [];
    });
    return problems.length ? { id, ok: false, detail: problems.join('; ') } : { id, ok: true };
  });

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => checkBuildFilingSites();

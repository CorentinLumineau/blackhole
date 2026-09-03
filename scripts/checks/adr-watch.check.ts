import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { parseSectionLineCounts } from './content-gates.check.ts';
import { ADR_WATCH_ITEMS, type AdrWatchItem } from '../lib/build/facts.ts';

// Issue #710 — adr-watch.check.ts: measures each `ADR_WATCH_ITEMS` (facts.ts) row against the
// live file it names, giving ADR-007's rejected-alternatives revisit trigger and ADR-021 A3's
// Stop-condition density warning a machine-checkable home instead of tripping silently.
// Advisory (WARN) — `ok: true` always, same established shape as V-CONTENTGATE-02/V-QUEUE-0N:
// this reports "revisit this file", never blocks a merge on it.

// `metric: 'file_loc'` measures the whole file's line count; `metric: 'section_loc'` measures
// the worst-offending `##` section, reusing content-gates.check.ts's fence-aware parser
// (V-INT-02 — never re-implement markdown section splitting). `metric: 'section_count'` is
// declared in the type for schema completeness but has no measurement yet — returns `null`
// (unmeasured), same as an unresolvable metric would, rather than crashing.
export const measureAdrWatchItem = (item: AdrWatchItem, content: string): number | null => {
  if (item.metric === 'file_loc') {
    const lines = content.split('\n');
    return lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  }
  if (item.metric === 'section_loc') {
    const sections = Object.values(parseSectionLineCounts(content));
    return sections.length ? Math.max(...sections) : 0;
  }
  return null;
};

// Reads each item's target file relative to `baseDir` and reports items whose measured value
// exceeds their declared threshold. A missing target file is SKIPped (never crashes verify.ts —
// same file-absent discipline as queue-coherence.check.ts/parity-matrix.check.ts), and so is an
// item whose metric isn't measurable yet (`measureAdrWatchItem` returned `null`).
export const findAdrWatchViolations = (items: AdrWatchItem[], baseDir: string): string[] => {
  const warnings: string[] = [];
  for (const item of items) {
    const abs = path.join(baseDir, item.file);
    if (!fs.existsSync(abs)) continue;

    const value = measureAdrWatchItem(item, fs.readFileSync(abs, 'utf-8'));
    if (value === null) continue;
    if (value > item.threshold) {
      warnings.push(
        `${item.adr} — ${item.file}: measured ${value}, exceeds ${item.threshold}-LOC ${item.metric} watch threshold (${item.note})`,
      );
    }
  }
  return warnings;
};

// Exported (rather than only the default-path `runChecks` entrypoint below) so tests can point
// it at a temp-dir fixture without touching the live repo tree — same pattern as
// queue-coherence.check.ts's `checkQueueCoherence`.
export const checkAdrWatch = (items: AdrWatchItem[], baseDir: string): CheckResult[] => {
  const warnings = findAdrWatchViolations(items, baseDir);
  return [{ id: 'V-WATCH-01', ok: true, ...(warnings.length ? { detail: warnings.join('; ') } : {}) }];
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects beyond reading the repo tree, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => checkAdrWatch(ADR_WATCH_ITEMS, root);

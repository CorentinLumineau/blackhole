import * as fs from 'fs';
import * as path from 'path';

// ADR-007 T5/R2' — content-gates.check.ts: orchestrator.md section-budget grow-never gate
// (split from the former catch-all check file, issue #322). Canonical home for #323's V-CONTENTGATE-01 extension.

const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

// V-CONTENTGATE-01 (ADR-007 T6/R3′): section-budget content-gate for orchestrator.md. Parses
// only `##`-level section boundaries (matching the master plan's "parse orchestrator.md's `##`
// section boundaries" — nested `###` subsections, e.g. "Route-derived dispatch" inside "5-Field
// Delegation Contract", are not independently budgeted). Returns a header -> line-count map,
// where a section's line count spans from its header line up to (not including) the next
// `##`-level header, or EOF. A trailing empty string produced by splitting content that ends in
// a newline is dropped first so the final section's count matches `wc -l` exactly.
export const parseSectionLineCounts = (content: string): Record<string, number> => {
  let lines = content.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines = lines.slice(0, -1);

  const headerIdx: number[] = [];
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^(```|~~~)/.test(l)) inFence = !inFence;
    if (!inFence && /^## /.test(l)) headerIdx.push(i);
  });

  const sections: Record<string, number> = {};
  for (let k = 0; k < headerIdx.length; k++) {
    const start = headerIdx[k];
    const end = k + 1 < headerIdx.length ? headerIdx[k + 1] : lines.length;
    sections[lines[start]] = end - start;
  }
  return sections;
};

// Grow-never baseline snapshot, captured at this check's landing commit (ADR-007 T6). Every
// section that existed in orchestrator.md at this commit is grandfathered: it may shrink or stay
// the same size forever, but it must never GROW past the LOC recorded here — growth past the
// baseline is exactly the accretion this governance-only check exists to prevent. Any `##`
// section header not in this map is "new" (added after this commit) and is budget-checked
// against CONTENT_GATE_NEW_SECTION_BUDGET_LOC instead. Do not hand-edit these numbers to make a
// failing check pass — shrink the section, or accept that growing a baseline section is the
// violation being reported.
export const ORCHESTRATOR_CONTENT_GATE_BASELINE: Record<string, number> = {
  '## Role & Responsibilities': 9,
  '## 5-Field Delegation Contract': 131,
  '## Error Classification (Transient / Permanent / Partial-Corruption)': 19,
  '## Escalation dispatch (implementer → investigator)': 31,
  '## Review pipeline': 14,
  '## Wave scheduling': 8,
  '## Background worker barrier (Cursor / Pattern B)': 46,
  '## Checkpoint protocol': 15,
  '## Session resume & recovery': 20,
  '## Human-in-the-Loop (HITL) & Blocker Gating': 9,
  '## Incident Mode': 36,
  '## Continuous Discovery & Pareto Sorting': 12,
  '## Kaizen hunt dispatch': 38,
  '## Brainstorm dispatch precedence (ADR-010 D3)': 16,
  '## Brainstorm terminal handling (ADR-010 D3)': 33,
};

// New (non-baseline) `##` sections are capped at 50 LOC — the approved plan default, chosen to
// sit between the newest "thin pointer" precedent sections (Kaizen hunt dispatch, 38 LOC;
// Incident Mode, 36 LOC) and comfortably below the un-grandfathered core-loop sections (46-131
// LOC) that pre-date this governance rule.
export const CONTENT_GATE_NEW_SECTION_BUDGET_LOC = 50;

export const findContentGateViolations = (
  sections: Record<string, number>,
  baseline: Record<string, number>,
  newSectionBudgetLoc: number,
): string[] => {
  const errors: string[] = [];
  for (const [header, loc] of Object.entries(sections)) {
    const baselineLoc = baseline[header];
    if (baselineLoc !== undefined) {
      if (loc > baselineLoc) {
        errors.push(`${header}: grew to ${loc} LOC, exceeds grandfathered baseline of ${baselineLoc} LOC (grow-never)`);
      }
    } else if (loc > newSectionBudgetLoc) {
      errors.push(`${header}: new section is ${loc} LOC, exceeds ${newSectionBudgetLoc}-LOC budget`);
    }
  }
  return errors;
};

const checkContentGate = (): CheckResult => {
  const content = read('src/agents/orchestrator.md');
  const sections = parseSectionLineCounts(content);
  const errors = findContentGateViolations(sections, ORCHESTRATOR_CONTENT_GATE_BASELINE, CONTENT_GATE_NEW_SECTION_BUDGET_LOC);

  if (errors.length) return { id: 'V-CONTENTGATE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-CONTENTGATE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkContentGate()];

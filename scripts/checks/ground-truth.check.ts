import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import {
  AGENT_NAMES,
  PHASE_PLAYBOOK_FILES,
  REQUIRED_REFERENCES,
  VCODE_TABLE_ROW_COUNT,
} from '../lib/build/facts.ts';
import { listFiles } from '../lib/check-common.ts';

// ADR-007 T5/R2' — ground-truth.check.ts: two-sided facts-conformance (declared § facts vs.
// filesystem scan) + doc-table conformance (AGENTS.md roster, README.md count) — split from
// the former catch-all check file, issue #322. Canonical home for #320's V-GROUND-01 generalization.

const srcDir = path.join(root, 'src');

// V-GROUND-01 (ADR-007 T3/R1′): two-sided facts-conformance. Diffs an independently-scanned
// filename set against a declared filename set, order-insensitive, returning null on a match or
// a message naming the symmetric difference (missing/extra) on mismatch (never a boolean — the
// failing check must be able to name exactly what's wrong, ADR-007 Risk Assessment row 2
// mitigation). Reports only the symmetric difference rather than both full sets (PR #257 review
// rider) — on a large roster, a one-entry drift used to bury the signal in two long, mostly
// identical set dumps.
export const findRosterScanMismatch = (scanned: string[], declared: string[]): string | null => {
  const s = new Set(scanned);
  const d = new Set(declared);
  const missing = declared.filter((name) => !s.has(name)).sort();
  const extra = scanned.filter((name) => !d.has(name)).sort();
  if (missing.length === 0 && extra.length === 0) return null;

  const parts: string[] = [];
  if (missing.length) parts.push(`missing [${missing.join(', ')}]`);
  if (extra.length) parts.push(`extra [${extra.join(', ')}]`);
  return parts.join(', ');
};

// Same two-sided shape for a plain declared-count vs scanned-count comparison (e.g. a markdown
// table's row count) — names the label plus both numbers on mismatch.
export const findRowCountMismatch = (label: string, declared: number, actual: number): string | null =>
  declared === actual ? null : `${label}: declared ${declared}, found ${actual}`;

// V-GROUND-01: facts-conformance — independent filesystem scan of src/agents/,
// src/references/phase-*.md, and blackhole-vcodes.md's row count, compared against build.ts's
// § facts declaration. Never collapsed onto one derivation path (ADR-007 Rejected Alternatives:
// "Single-source derivation for both sides of the drift check").
const checkGroundTruth = (): CheckResult => {
  const errors: string[] = [];

  const scannedAgents = listFiles('src/agents');
  const declaredAgents = AGENT_NAMES.map((n) => `${n}.md`);
  const agentMismatch = findRosterScanMismatch(scannedAgents, declaredAgents);
  if (agentMismatch) errors.push(`agents: ${agentMismatch}`);

  const scannedPlaybooks = listFiles('src/references').filter((f) => f.startsWith('phase-'));
  const playbookMismatch = findRosterScanMismatch(scannedPlaybooks, [...PHASE_PLAYBOOK_FILES]);
  if (playbookMismatch) errors.push(`phase playbooks: ${playbookMismatch}`);

  const vcodes = read('src/references/blackhole-vcodes.md');
  const vcodeRows = (vcodes.match(/^\| V-/gm) || []).length;
  const rowCountMismatch = findRowCountMismatch('vcode table rows', VCODE_TABLE_ROW_COUNT, vcodeRows);
  if (rowCountMismatch) errors.push(rowCountMismatch);

  for (const ref of REQUIRED_REFERENCES) {
    if (!fs.existsSync(path.join(srcDir, 'references', ref))) errors.push(`missing reference: ${ref}`);
  }

  if (errors.length) return { id: 'V-GROUND-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-GROUND-01', ok: true };
};

// V-DOCTABLE-01 (ADR-007 T3/R1′): tolerant row-set parser — extracts backtick-quoted names from
// the `## Agent roster` section only (ignores prose mentions elsewhere and header/separator
// rows), so AGENTS.md stays fully hand-authored while still being checked against the § facts
// declaration (ADR-007 Rejected Alternatives: no generation-in-place / no `<!-- roster -->`
// markers).
export const extractAgentRosterTableNames = (agentsMdContent: string): string[] => {
  const section = agentsMdContent.split(/^## Agent roster$/m)[1]?.split(/^## /m)[0] ?? '';
  const names: string[] = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*`([\w-]+)`\s*\|/);
    if (m) names.push(m[1]);
  }
  return names;
};

// Lighter count-consistency check: README.md's agent-count prose mention against
// AGENT_NAMES.length — prints the expected value on failure.
export const findReadmeAgentCountMismatch = (readmeContent: string, expectedCount: number): string | null => {
  const pattern = new RegExp(`\\b${expectedCount}\\s+agent prompts\\b`);
  if (pattern.test(readmeContent)) return null;
  return `expected mention of "${expectedCount} agent prompts", not found`;
};

// V-DOCTABLE-01: AGENTS.md's roster table and README.md's agent-count mention, checked (not
// generated) against the § facts declaration.
const checkDocTables = (): CheckResult => {
  const errors: string[] = [];

  const agentsMd = read('AGENTS.md');
  const foundNames = extractAgentRosterTableNames(agentsMd).map((n) => `${n}.md`);
  const declaredNames = AGENT_NAMES.map((n) => `${n}.md`);
  const rosterMismatch = findRosterScanMismatch(foundNames, declaredNames);
  if (rosterMismatch) errors.push(`AGENTS.md roster: ${rosterMismatch}`);

  const readme = read('README.md');
  const readmeMismatch = findReadmeAgentCountMismatch(readme, AGENT_NAMES.length);
  if (readmeMismatch) errors.push(`README.md: ${readmeMismatch}`);

  if (errors.length) return { id: 'V-DOCTABLE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-DOCTABLE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkGroundTruth(), checkDocTables()];

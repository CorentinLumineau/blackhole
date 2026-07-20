import * as fs from 'fs';
import * as path from 'path';

// ADR-013 D1/T2 — parity-matrix.check.ts: validates the row schema of
// documentation/audits/mercure-parity-matrix.md (V-PMATRIX-01). Mirrors the paired-file shape
// of single-writer.check.ts/verify.single-writer.test.ts: pure `runChecks(): CheckResult[]`
// export, glob-discovered by scripts/verify.ts, no central registry.
//
// File-absent SKIP is binding (see milestone-1.md § T2): the matrix file is only created by M2
// (seed run). Until then this check must return ok:true immediately, no read/parse attempted —
// exact precedent: core.check.ts's checkPlanArtifacts / V-PLAN-01
// (`if (!fs.existsSync(queueFile)) return { id: 'V-PLAN-01', ok: true };`).

export type CheckResult = { id: string; ok: boolean; detail?: string };

const root = path.resolve(import.meta.dirname, '..', '..');
const MATRIX_PATH = path.join(root, 'documentation', 'audits', 'mercure-parity-matrix.md');

// D1 row schema (binding, ADR-013): | id | kind | mechanism | blackhole | status | priority | verified |
const HEADER_COLUMNS = ['id', 'kind', 'mechanism', 'blackhole', 'status', 'priority', 'verified'];

/** Splits a `| a | b | c |` line into trimmed cells, or null if the line isn't table-shaped. */
const splitRow = (line: string): string[] | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
};

const isHeaderRow = (line: string): boolean => {
  const cells = splitRow(line);
  if (!cells || cells.length !== HEADER_COLUMNS.length) return false;
  return cells.every((c, i) => c.toLowerCase() === HEADER_COLUMNS[i]);
};

const isSeparatorRow = (line: string): boolean => {
  const cells = splitRow(line);
  if (!cells || cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
};

type ParsedRow = { id: string; status: string; priority: string };
type ParseResult = { rows: ParsedRow[] } | { error: string };

/**
 * Finds the first markdown table whose header row matches the D1 row schema (case-insensitive,
 * order-sensitive), then parses its data rows. Returns a parse error — distinct from the
 * file-absent SKIP branch in checkParityMatrix — when no matching header is found before EOF,
 * or when a matching header isn't immediately followed by a valid `|---|` separator row.
 */
const parseMatrixTable = (content: string): ParseResult => {
  const lines = content.split('\n');

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isHeaderRow(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return { error: 'no parity-matrix header row (id | kind | mechanism | blackhole | status | priority | verified) found' };
  }

  const sepIdx = headerIdx + 1;
  if (sepIdx >= lines.length || !isSeparatorRow(lines[sepIdx])) {
    return { error: 'parity-matrix header row found but no |---| separator row follows it' };
  }

  const rows: ParsedRow[] = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (!cells || cells.length !== HEADER_COLUMNS.length) break; // table ends at first non-row line
    const [id, , , , status, priority] = cells;
    if (!id) continue;
    rows.push({ id, status, priority });
  }

  return { rows };
};

/** Checks row-id uniqueness across all parsed rows; pushes one aggregate-friendly error per duplicate id. */
const validateUniqueIds = (rows: ParsedRow[], errors: string[]): void => {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  for (const [id, count] of seen) {
    if (count > 1) errors.push(`duplicate id "${id}" (${count} occurrences)`);
  }
};

/** Checks status-enum validity, in-flight-requires-ref, gap-requires-priority, N/A-requires-reason. */
const validateRowStatus = (row: ParsedRow, errors: string[]): void => {
  const { id, status, priority } = row;

  if (status === 'covered' || status === 'adapted') return;

  if (status === 'gap') {
    if (!priority) errors.push(`row ${id}: gap status missing priority`);
    return;
  }

  if (status === 'in-flight' || status.startsWith('in-flight')) {
    if (status === 'in-flight') {
      errors.push(`row ${id}: in-flight status missing ref`);
      return;
    }
    const m = /^in-flight\(([^)]*)\)$/.exec(status);
    if (m && m[1].trim().length > 0) return;
    errors.push(`row ${id}: invalid status "${status}"`);
    return;
  }

  if (status === 'N/A' || status.startsWith('N/A')) {
    if (status === 'N/A') {
      errors.push(`row ${id}: N/A status missing reason`);
      return;
    }
    const m = /^N\/A\(([^)]*)\)$/.exec(status);
    if (m && m[1].trim().length > 0) return;
    errors.push(`row ${id}: invalid status "${status}"`);
    return;
  }

  errors.push(`row ${id}: invalid status "${status}"`);
};

/**
 * Pure content validator (no fs access) — exported for direct unit testing of all 11 non-skip
 * cases in the 12-case spec without touching the real matrix file's on-disk presence.
 */
export const validateParityMatrixContent = (content: string): CheckResult => {
  const parsed = parseMatrixTable(content);
  if ('error' in parsed) {
    return { id: 'V-PMATRIX-01', ok: false, detail: parsed.error };
  }

  const errors: string[] = [];
  validateUniqueIds(parsed.rows, errors);
  for (const row of parsed.rows) validateRowStatus(row, errors);

  if (errors.length) return { id: 'V-PMATRIX-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-PMATRIX-01', ok: true };
};

// V-PMATRIX-01: row-id uniqueness, status-enum validity, in-flight-requires-ref,
// gap-requires-priority (ADR-013 D1). Binding file-absent SKIP: the matrix is created by M2.
const checkParityMatrix = (): CheckResult => {
  if (!fs.existsSync(MATRIX_PATH)) {
    return { id: 'V-PMATRIX-01', ok: true };
  }
  const content = fs.readFileSync(MATRIX_PATH, 'utf-8');
  return validateParityMatrixContent(content);
};

// ADR-007 T5/R2': domain entrypoint — see core.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkParityMatrix()];

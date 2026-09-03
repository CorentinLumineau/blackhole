import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './lib/fs.ts';
import { validateStateWrite } from './lib/state-write-guard.ts';
import type { LedgerFinding } from './lib/promote-review-artifact.ts';

// Issue #754 (V-FIX-01) — one-shot normalization of the live findings-ledger.json's
// `issue_ref`/`pr_ref` schema drift (see the plan's Objective for the three documented
// shapes: string issue_ref, legacy `pr` key, string pr_ref). Idempotent: re-running against an
// already-clean ledger reports `changed: 0`. Not wired into `bun run verify` — see
// `ledger-schema.check.ts` for the recurring regression gate this migration is not.
//
// Deliberately out of scope (not touched, not thrown on): a row whose `issue_ref`/`pr_ref` key
// is entirely absent. 27 live rows — kaizen/hunt and plan/handle-phase freehand appends that
// never went through `review-aggregate.ts`'s stamping pipeline — carry no `pr_ref` key at all.
// That is a distinct, undocumented shape from the three this issue names, not a drifted value
// to coerce; treating "absent" as "already correct" keeps the migration scoped to the issue's
// own evidence instead of silently inventing a `pr_ref: null` the source data never asserted.

type RawFinding = Record<string, unknown>;

const NUMERIC_STRING = /^\d+$/;

/**
 * Coerces one `issue_ref`/`pr_ref` value per the plan's three-way rule: a numeric string
 * coerces to a number; an already-correct `number | null` passes through unchanged; anything
 * else (non-numeric string, boolean, object) throws, naming the row and the offending value —
 * fail loud rather than silently dropping or guessing. `undefined` (key absent) also passes
 * through unchanged, per the module header's out-of-scope note.
 */
function coerceRefValue(id: unknown, field: string, value: unknown): number | null | undefined {
  if (value === undefined || value === null || typeof value === 'number') {
    return value as number | null | undefined;
  }
  if (typeof value === 'string' && NUMERIC_STRING.test(value)) {
    return Number(value);
  }
  throw new Error(`row ${String(id)}: ${field} has an unrecognized value ${JSON.stringify(value)}`);
}

export function migrateFindings(findings: unknown[]): { migrated: LedgerFinding[]; changed: number } {
  let changed = 0;

  const migrated = findings.map((raw) => {
    const row = raw as RawFinding;
    let mutated = false;

    let prRefSource: unknown = row.pr_ref;
    if ('pr' in row) {
      if (row.pr_ref !== undefined) {
        throw new Error(
          `row ${String(row.id)}: carries both "pr" (${JSON.stringify(row.pr)}) and "pr_ref" (${JSON.stringify(row.pr_ref)}) — ambiguous, needs manual review`,
        );
      }
      prRefSource = row.pr;
      mutated = true;
    }

    const issueRefCoerced = coerceRefValue(row.id, 'issue_ref', row.issue_ref);
    if (issueRefCoerced !== row.issue_ref) mutated = true;

    const prRefCoerced = coerceRefValue(row.id, 'pr_ref', prRefSource);
    if (prRefCoerced !== row.pr_ref) mutated = true;

    if (mutated) changed++;

    // `rest` already carries issue_ref/pr_ref at their original (possibly absent) key
    // presence; only overwrite when coercion produced a defined value, so a row that never
    // had a pr_ref key keeps not having one — matches the module header's out-of-scope note
    // rather than manufacturing a `pr_ref: undefined` key the source data never asserted.
    const { pr: _legacyPr, ...rest } = row;
    const out: RawFinding = { ...rest };
    if (issueRefCoerced !== undefined) out.issue_ref = issueRefCoerced;
    if (prRefCoerced !== undefined) out.pr_ref = prRefCoerced;
    return out as LedgerFinding;
  });

  return { migrated, changed };
}

// Isolated from main() so the test suite can exercise the full archive-snapshot + .tmp +
// validateStateWrite + atomic-mv protocol (`blackhole-state.md` § Write protocol) against a
// temp-dir fixture, never the live `.blackhole/findings-ledger.json`.
export function runMigration(livePath: string, archiveDir: string): { before: number; changed: number } {
  const live = readJsonFile(livePath, livePath) as { findings: unknown[]; [key: string]: unknown };
  const before = live.findings.length;

  const { migrated, changed } = migrateFindings(live.findings);

  if (migrated.length !== before) {
    throw new Error(
      `migration row-count invariant violated: ${before} findings before, ${migrated.length} after — aborting, no write attempted`,
    );
  }

  fs.mkdirSync(archiveDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(archiveDir, `findings-ledger-${timestamp}.json`);
  fs.copyFileSync(livePath, snapshotPath);

  const tmpPath = `${livePath}.tmp`;
  const output = { ...live, findings: migrated };
  fs.writeFileSync(tmpPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');

  const result = validateStateWrite({ tmpPath, livePath, entityKey: 'findings' });
  if (!result.ok) {
    throw new Error(`state-write-guard refused the migrated ledger: ${result.reason}`);
  }

  fs.renameSync(tmpPath, livePath);

  return { before, changed };
}

if (import.meta.main) {
  try {
    const root = path.resolve(import.meta.dirname, '..');
    const livePath = path.join(root, '.blackhole', 'findings-ledger.json');
    const archiveDir = path.join(root, '.blackhole', 'archive');
    const { before, changed } = runMigration(livePath, archiveDir);
    console.log(`migrate-ledger-schema: ${changed}/${before} rows changed`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

import * as fs from 'fs';
import { parseMdFrontmatter, parseFrontmatterFields } from './lib/build/content.ts';
import { findTableBlock } from './lib/check-common.ts';
import { readJsonFile } from './lib/fs.ts';
import { root } from './checks/check-utils.ts';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';

// Issue #717 (R-12) — replaces the hand-append path documented in `orchestrator.md` § Decision
// Record Append, which never bumped `last_updated` (frozen at 2026-07-20 across 6+ hand-appended
// rows this turn — nothing noticed a silent log). This script is the sole write path: it appends
// rows, dedups, and bumps the frontmatter field itself so the two can no longer drift apart.
//
// Sorted insert (issue #874): the Records table below is rebuilt in id-sorted order on every
// insert, the same structural fix #743 gave the INDEX.md files' `appendIndexRowIfAbsent`
// (`scripts/lib/check-common.ts`) — see `merge-conflict-protocol.md` § Sorted insert for the
// canonical write-up of why this changes the merge outcome, not just row cosmetics.

export type DecisionRecordRow = {
  pr?: number;
  issue?: number;
  kind: 'root-cause' | 'approach' | 'refactor' | 'improvement' | 'reuse';
  touch_paths: string[];
  decision: string;
  why: string;
};

const escapeCell = (s: string): string => s.replace(/\|/g, '\\|');

type RecordsTableRow = { prIssueCell: string; kind: string };

// Row-splitting technique shared with parseIndexTableRows/parseVcodeTableRows
// (scripts/lib/check-common.ts, V-INT-02), applied to decision-log.md's own 5-column
// `PR/Issue | Kind | Touch Paths | Decision | Why` schema — a different schema than either of
// those, so the functions themselves aren't reused, only the row-splitting idiom.
const parseRecordsTableRows = (body: string): RecordsTableRow[] => {
  const rows: RecordsTableRow[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const prIssueCell = cells[1];
    if (!prIssueCell || prIssueCell.toLowerCase() === 'pr/issue' || /^:?-+:?$/.test(prIssueCell)) continue;
    rows.push({ prIssueCell, kind: cells[2] });
  }
  return rows;
};

// Numeric sort key for a Records row: the first digit run in its PR/Issue cell — `"745"` -> 745,
// the historical compound-id shape `"PR #428 / #421"` -> 428. New rows minted by this script
// always carry a single id, so the compound shape only ever appears in pre-#874 rows. Byte-order
// style comparator (plain numeric subtraction, no locale collation) for the same reason
// `byPathByteOrder` (`scripts/lib/check-common.ts`) avoids `localeCompare`: two machines must
// compute the same position for the same row.
const recordSortKey = (prIssueCell: string): number => Number(prIssueCell.match(/\d+/)?.[0] ?? 0);

// Rebuilds the Records row block in id-sorted order — `[...existingRowLines,
// ...newLines].sort(...)` — instead of appending `newLines` at the tail, mirroring
// `appendIndexRowIfAbsent`'s rebuild-the-block technique (`scripts/lib/check-common.ts`, issue
// #743). Row-block boundary detection is `findTableBlock` (`scripts/lib/check-common.ts`,
// V-DRY-01, issue #887 review) — shared, since locating the block is schema-agnostic even
// though this file's row schema (5-column Records table) differs from INDEX.md's. Operates on
// raw row-line text rather than re-rendering rows from parsed fields, so an existing row's exact
// formatting (including any `\|`-escaped cell content) survives untouched. Only called when
// `newLines` is non-empty — a dedup-only call leaves `body` untouched, same as before this
// change.
const insertRecordRowsSorted = (body: string, newLines: string[]): string => {
  const lines = body.split('\n');
  const { separatorIdx, blockEnd } = findTableBlock(lines);

  // No parseable table header (e.g. a fresh/malformed doc) — fall back to plain append-at-end,
  // same behavior as before this change. decision-log.md always ships with the Records table
  // header, so this path is defensive, not expected to run in production.
  if (separatorIdx === -1) {
    return `${body}${body.endsWith('\n') ? '' : '\n'}${newLines.join('\n')}\n`;
  }

  const existingRowLines = lines.slice(separatorIdx + 1, blockEnd);
  const sortedRowLines = [...existingRowLines, ...newLines].sort((a, b) => recordSortKey(a) - recordSortKey(b));

  return [...lines.slice(0, separatorIdx + 1), ...sortedRowLines, ...lines.slice(blockEnd)].join('\n');
};

// Exported for doc-health-signal.ts's `decision_log_silent_prs` computation (V-INT-02) — every
// `\d+` token in the PR/Issue cell counts, not just the first (Execution Strategy item 2, issue
// #717): a `PR #428 / #421`-shaped row must be recognized as covering both 428 and 421.
export const parseDecisionLogIds = (logContent: string): Set<number> => {
  const { body } = parseMdFrontmatter(logContent);
  const ids = new Set<number>();
  for (const row of parseRecordsTableRows(body)) {
    for (const m of row.prIssueCell.match(/\d+/g) ?? []) ids.add(Number(m));
  }
  return ids;
};

export const appendDecisionRecords = (
  logContent: string,
  records: DecisionRecordRow[],
  today: string = new Date().toISOString().slice(0, 10),
): { content: string; appended: number; skipped: number } => {
  const { frontmatter, body } = parseMdFrontmatter(logContent);
  const fm = parseFrontmatterFields(frontmatter);
  if (!('last_updated' in fm)) {
    throw new Error('decision-log-append: malformed decision-log.md — frontmatter has no last_updated field');
  }

  // Dedup identity is "already present in the log body when this call started" — never mutated
  // during the loop below. Two records sharing one (pr, kind) key can arrive in the same batch
  // (one worker completion legitimately emits several decisions for the same PR) and must both
  // land; only a key already committed to the log on a prior run is a duplicate. Mutating this
  // set mid-loop would silently drop the second same-batch record. Cross-run idempotency still
  // holds: a second pass over the same batch re-derives this set from the now-updated body,
  // which already contains every row the first pass appended.
  const existingKeys = new Set<string>();
  for (const row of parseRecordsTableRows(body)) {
    for (const m of row.prIssueCell.match(/\d+/g) ?? []) existingKeys.add(`${m}:${row.kind}`);
  }

  let appended = 0;
  let skipped = 0;
  const newLines: string[] = [];
  for (const r of records) {
    const id = r.pr ?? r.issue;
    const key = `${id}:${r.kind}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    appended++;
    const touchPaths = escapeCell(r.touch_paths.join(', '));
    newLines.push(`| ${id} | ${r.kind} | ${touchPaths} | ${escapeCell(r.decision)} | ${escapeCell(r.why)} |`);
  }

  const newFrontmatter = frontmatter.replace(/^last_updated:.*$/m, `last_updated: ${today}`);
  const bumpedBody = newLines.length ? insertRecordRowsSorted(body, newLines) : body;

  return { content: `---\n${newFrontmatter}\n---\n${bumpedBody}`, appended, skipped };
};

function usage(): never {
  console.error('Usage: bun scripts/decision-log-append.ts --records-file <path> [--log <path>]');
  process.exit(2);
}

// The original `for (i = 2; i += 2)` loop structurally rejected any token outside a clean
// --key/value alternation, including an unrecognized flag — restored explicitly here since
// parseFlags has no such structural check on its own.
const KNOWN_KEYS = ['records-file', 'log'];

function parseArgs(argv: string[]): { logPath: string; recordsFilePath: string } {
  const args = parseFlags(argv.slice(2));
  if (unknownFlagKeys(args, KNOWN_KEYS).length > 0) usage();
  if (typeof args['records-file'] !== 'string') usage();
  return {
    logPath: typeof args.log === 'string' ? args.log : `${root}/documentation/reference/decision-log.md`,
    recordsFilePath: args['records-file'] as string,
  };
}

function main(): void {
  const { logPath, recordsFilePath } = parseArgs(process.argv);
  const payload = readJsonFile(recordsFilePath, recordsFilePath) as { decision_records: DecisionRecordRow[] };
  const logContent = fs.readFileSync(logPath, 'utf-8');
  const { content, appended, skipped } = appendDecisionRecords(logContent, payload.decision_records);
  const tmp = `${logPath}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, logPath);
  console.log(`appended=${appended} skipped=${skipped}`);
}

if (import.meta.main) {
  main();
}

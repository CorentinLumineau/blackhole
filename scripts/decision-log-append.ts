import * as fs from 'fs';
import { parseMdFrontmatter, parseFrontmatterFields } from './lib/build/content.ts';
import { readJsonFile } from './lib/fs.ts';
import { root } from './checks/check-utils.ts';

// Issue #717 (R-12) — replaces the hand-append path documented in `orchestrator.md` § Decision
// Record Append, which never bumped `last_updated` (frozen at 2026-07-20 across 6+ hand-appended
// rows this turn — nothing noticed a silent log). This script is the sole write path: it appends
// rows, dedups, and bumps the frontmatter field itself so the two can no longer drift apart.

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

  const seen = new Set<string>();
  for (const row of parseRecordsTableRows(body)) {
    for (const m of row.prIssueCell.match(/\d+/g) ?? []) seen.add(`${m}:${row.kind}`);
  }

  let appended = 0;
  let skipped = 0;
  const newLines: string[] = [];
  for (const r of records) {
    const id = r.pr ?? r.issue;
    const key = `${id}:${r.kind}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    appended++;
    const touchPaths = escapeCell(r.touch_paths.join(', '));
    newLines.push(`| ${id} | ${r.kind} | ${touchPaths} | ${escapeCell(r.decision)} | ${escapeCell(r.why)} |`);
  }

  const newFrontmatter = frontmatter.replace(/^last_updated:.*$/m, `last_updated: ${today}`);
  const bumpedBody = newLines.length
    ? `${body}${body.endsWith('\n') ? '' : '\n'}${newLines.join('\n')}\n`
    : body;

  return { content: `---\n${newFrontmatter}\n---\n${bumpedBody}`, appended, skipped };
};

function usage(): never {
  console.error('Usage: bun scripts/decision-log-append.ts --records-file <path> [--log <path>]');
  process.exit(2);
}

function parseArgs(argv: string[]): { logPath: string; recordsFilePath: string } {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) usage();
    args[key.slice(2)] = value;
  }
  if (!args['records-file']) usage();
  return {
    logPath: args.log ?? `${root}/documentation/reference/decision-log.md`,
    recordsFilePath: args['records-file'],
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

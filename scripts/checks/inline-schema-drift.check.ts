import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { walkMdFilesAbs } from '../lib/check-common.ts';
import type { Role } from '../lib/worker-json/types.ts';
import {
  PLANNER_STATUSES,
  IMPLEMENTER_STATUSES,
  REVIEWER_STATUSES,
  ROUTE_STATUSES,
  INVESTIGATOR_STATUSES,
  HUNTER_STATUSES,
} from '../lib/worker-json/constants.ts';

// Issue #611 — inline-schema-drift.check.ts: advisory detector (V-BRIEF-02) for the exact
// failure shape that let 7 of 8 `router` spawns emit a schema-invalid `status: "complete"` in
// turn 8 — a spawn-brief-adjacent doc inlining a literal return-JSON status skeleton whose value
// sits outside the resolved role's status enum. `orchestrator-delegation.md`'s no-inline-schema
// rule is the prescriptive fix; this check is the detective backstop. Role enums are imported
// directly from constants.ts, never hand-copied (V-INT-02).

const AGENTS_DIR = path.join(root, 'src', 'agents');
const REFERENCES_DIR = path.join(root, 'src', 'references');

// worker-schemas.md IS the return-JSON SSOT the no-inline-schema rule tells every other doc to
// cite — every enum example inside it is definitionally not drift.
const EXCLUDED_REFERENCE_FILES = new Set(['worker-schemas.md']);

const ROLE_STATUS_MAP: Record<Role, readonly string[]> = {
  planner: PLANNER_STATUSES,
  implementer: IMPLEMENTER_STATUSES,
  reviewer: REVIEWER_STATUSES,
  router: ROUTE_STATUSES,
  investigator: INVESTIGATOR_STATUSES,
  hunter: HUNTER_STATUSES,
};

const ROLE_NAMES = Object.keys(ROLE_STATUS_MAP) as Role[];

export type InlineSchemaFinding = {
  file: string;
  line: number;
  role: string;
  found: string;
  expected: readonly string[];
};

// Heading-based role resolution (src/references/*.md): strip backticks and any trailing
// parenthetical, then match case-insensitively against the six role names — e.g. "## Router
// (`router`)" normalizes to "router".
export const normalizeHeadingRoleText = (headingText: string): string =>
  headingText.replace(/`/g, '').replace(/\(.*$/, '').trim().toLowerCase();

export const resolveRoleFromHeading = (headingText: string): Role | null => {
  const normalized = normalizeHeadingRoleText(headingText);
  return (ROLE_NAMES as string[]).includes(normalized) ? (normalized as Role) : null;
};

// Filename-based role resolution (src/agents/*.md): basename maps 1:1 to Role; coordinator.md
// and orchestrator.md (no status array) resolve to null — never guessed.
export const resolveRoleFromAgentFilename = (basename: string): Role | null => {
  const stem = basename.replace(/\.md$/, '');
  return (ROLE_NAMES as string[]).includes(stem) ? (stem as Role) : null;
};

export const collectRoleHeadings = (content: string): { line: number; role: Role }[] => {
  const headings: { line: number; role: Role }[] = [];
  content.split('\n').forEach((line, idx) => {
    const m = line.match(/^#{2,4}\s+(.*)$/);
    if (!m) return;
    const role = resolveRoleFromHeading(m[1]);
    if (role) headings.push({ line: idx + 1, role });
  });
  return headings;
};

// Nearest role heading at or before `targetLine`; headings arrive in ascending line order
// (single top-to-bottom pass in collectRoleHeadings).
export const nearestPrecedingRole = (
  headings: { line: number; role: Role }[],
  targetLine: number
): Role | null => {
  let found: Role | null = null;
  for (const h of headings) {
    if (h.line > targetLine) break;
    found = h.role;
  }
  return found;
};

// Fenced ```json blocks only — a `"status"` literal inside a ```bash example or a plain prose
// backtick is not a return-JSON skeleton (hook-schemas.md's CLI example is exactly this case).
export const findFencedJsonBlocks = (content: string): { startLine: number; body: string }[] => {
  const lines = content.split('\n');
  const blocks: { startLine: number; body: string }[] = [];
  let bodyLines: string[] | null = null;
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (bodyLines === null && trimmed.startsWith('```json')) {
      bodyLines = [];
      startLine = i + 2;
      continue;
    }
    if (bodyLines !== null && trimmed.startsWith('```')) {
      blocks.push({ startLine, body: bodyLines.join('\n') });
      bodyLines = null;
      continue;
    }
    if (bodyLines !== null) bodyLines.push(lines[i]);
  }
  return blocks;
};

const STATUS_LITERAL = /"status"\s*:\s*"([a-zA-Z_-]+)"/;

// Role-detection is filename-based for src/agents/*.md (isAgentFile: true, whole-file role) and
// heading-based for src/references/*.md (isAgentFile: false, nearest preceding role heading per
// block). A file/block with no resolvable role is skipped, never guessed.
export const scanFileForInlineSchemaDrift = (
  relPath: string,
  content: string,
  isAgentFile: boolean
): InlineSchemaFinding[] => {
  const basename = path.basename(relPath);
  if (!isAgentFile && EXCLUDED_REFERENCE_FILES.has(basename)) return [];

  const agentRole = isAgentFile ? resolveRoleFromAgentFilename(basename) : null;
  if (isAgentFile && !agentRole) return [];

  const headings = isAgentFile ? [] : collectRoleHeadings(content);
  const findings: InlineSchemaFinding[] = [];

  for (const block of findFencedJsonBlocks(content)) {
    const bodyLines = block.body.split('\n');
    bodyLines.forEach((line, offset) => {
      const match = line.match(STATUS_LITERAL);
      if (!match) return;
      const absLine = block.startLine + offset;
      const role = isAgentFile ? agentRole : nearestPrecedingRole(headings, absLine);
      if (!role) return;
      const expected = ROLE_STATUS_MAP[role];
      if (!expected.includes(match[1])) {
        findings.push({ file: relPath, line: absLine, role, found: match[1], expected });
      }
    });
  }
  return findings;
};

const formatFinding = (f: InlineSchemaFinding): string =>
  `${f.file}:${f.line} role="${f.role}" found="${f.found}" expected=[${f.expected.join(', ')}]`;

// `check\w+` naming matches CHECK_TS_SECTION_PATTERN (content-gates.check.ts), the same
// convention every other domain file's check*() wrapper follows — required for V-CONTENTGATE-01
// to enforce this file's own section-LOC budget (V-INT-01).
const checkInlineSchemaDrift = (): CheckResult => {
  const findings: InlineSchemaFinding[] = [];

  for (const abs of walkMdFilesAbs(AGENTS_DIR)) {
    const relPath = path.relative(root, abs).split(path.sep).join('/');
    findings.push(...scanFileForInlineSchemaDrift(relPath, fs.readFileSync(abs, 'utf-8'), true));
  }
  for (const abs of walkMdFilesAbs(REFERENCES_DIR)) {
    const relPath = path.relative(root, abs).split(path.sep).join('/');
    findings.push(...scanFileForInlineSchemaDrift(relPath, fs.readFileSync(abs, 'utf-8'), false));
  }

  return findings.length
    ? { id: 'V-BRIEF-02', ok: true, detail: findings.map(formatFinding).join('; ') }
    : { id: 'V-BRIEF-02', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see adr-status.check.ts's runChecks doc comment for the
// shared contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkInlineSchemaDrift()];

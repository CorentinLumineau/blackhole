import * as fs from 'fs';
import * as path from 'path';
import { read, root, type CheckResult } from './check-utils.ts';
import { markdownHeadings } from '../lib/markdown-headings.ts';

// V-SLEEP-01 — the decision-parking choke point (`decision-parking.md` § The choke point). A
// question the campaign raises reaches a question tool only when `askOrPark()` says `ask`; by
// default it is parked for `/blackhole decide` instead (ADR-059). That only holds if
// every playbook step that asks the owner routes through `askOrPark()`, directly or through
// `clarify-gates.md` (whose C3 adapter opens with it). A section that names `AskQuestion` or
// `AskUserQuestion` must therefore cite one of the routes below; the unit is the innermost
// heading section, so one citation never covers a whole file. Descriptive mentions (harness
// capability tables, the contracts themselves) are listed in `DESCRIPTIVE_MENTIONS` with a reason.

const PLAYBOOK_DIRS = ['src/agents', 'src/references'];
const ASK_TOOL = /\bAsk(?:User)?Question\b/;
const ROUTED = /askOrPark|C3 adapter|clarify-gates\.md|decision-parking\.md/;
const WHOLE_FILE = '*';

export type PlaybookFile = { path: string; content: string };
/** `section` is a heading's text, or `*` for every section of the file. */
export type DescriptiveMention = { file: string; section: string; why: string };

export const DESCRIPTIVE_MENTIONS: DescriptiveMention[] = [
  { file: 'src/references/clarify-gates.md', section: WHOLE_FILE, why: 'the C3 adapter itself; its first rule is askOrPark()' },
  { file: 'src/references/decision-parking.md', section: WHOLE_FILE, why: 'the parking contract; the decide round is the owner-initiated answer channel' },
  { file: 'src/references/claude-code-native.md', section: 'Claude Code', why: 'C1-C3 primitive table: names the host tool, asks nothing' },
  { file: 'src/references/claude-code-native.md', section: 'Cursor (desktop, Cloud, CLI)', why: 'C1-C3 primitive table: names the host tool, asks nothing' },
  { file: 'src/references/model-routing.md', section: 'Cursor', why: 'harness note: which model sessions lack the picker' },
  { file: 'src/references/multitask-mode.md', section: 'Roles', why: 'role table: says who approves, not when to ask' },
  { file: 'src/references/project-thread-mode.md', section: 'Cursor', why: 'harness note: Cursor keeps its own question tool mapping' },
  { file: 'src/references/queue-dag.md', section: '`route` object (optional — ADR-004)', why: 'field table: names the existing gate a flag triggers' },
  { file: 'src/references/run-context.md', section: 'Resolve it', why: 'tool-detection table: what the agent reports from its tool list' },
  { file: 'src/references/run-context.md', section: 'Routing table', why: 'routing table: which question channel a run context resolves to' },
];

/** Every `.md` file of the playbook directories, repo-relative, in sorted order. */
export const playbookFiles = (): PlaybookFile[] =>
  PLAYBOOK_DIRS.flatMap((dir) =>
    fs
      .readdirSync(path.join(root, dir))
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => ({ path: `${dir}/${name}`, content: read(`${dir}/${name}`) })),
  );

/** The file cut at every heading (any level, fences skipped): one `{name, text}` per section. */
const sections = (content: string): Array<{ name: string; text: string }> => {
  const lines = content.split('\n');
  const headings = markdownHeadings(lines);
  const cuts = [{ name: '(preamble)', line: 0 }, ...headings.map((h) => ({ name: h.text, line: h.line }))];
  return cuts.map((c, i) => ({ name: c.name, text: lines.slice(c.line, cuts[i + 1]?.line ?? lines.length).join('\n') }));
};

/**
 * One error per section that names a question tool without a route, and one per allowlist entry
 * that no longer matches a section naming a question tool (a stale entry would hide a future ask).
 */
export const findUnroutedAsks = (files: PlaybookFile[], allow: DescriptiveMention[]): string[] => {
  const used = new Set<DescriptiveMention>();
  const errors: string[] = [];
  for (const file of files) {
    for (const s of sections(file.content)) {
      if (!ASK_TOOL.test(s.text)) continue;
      const entry = allow.find((a) => a.file === file.path && (a.section === WHOLE_FILE || a.section === s.name));
      if (entry) used.add(entry);
      else if (!ROUTED.test(s.text)) errors.push(`${file.path} § ${s.name}: asks the owner without askOrPark() / clarify-gates.md § C3 adapter`);
    }
  }
  for (const a of allow) {
    if (!used.has(a)) errors.push(`allowlist entry ${a.file} § ${a.section} matches no section that mentions a question tool`);
  }
  return errors;
};

export const checkSleepChokePoint = (): CheckResult => {
  const errors = findUnroutedAsks(playbookFiles(), DESCRIPTIVE_MENTIONS);
  return errors.length ? { id: 'V-SLEEP-01', ok: false, detail: errors.join('; ') } : { id: 'V-SLEEP-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint, glob-discovered by scripts/verify.ts.
export const runChecks = (): CheckResult[] => [checkSleepChokePoint()];

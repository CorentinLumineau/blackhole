import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { parseVcodeTableRows, walkMdFilesAbs } from '../lib/check-common.ts';

// Issue #567 — vcode-severity-sync.check.ts: pins every agent-prose/reference-prose severity
// restatement of a `V-*` code in `src/agents/*.md`/`src/references/*.md` to
// `blackhole-vcodes.md`'s SSOT value (V-SEVSYNC-01), and separately fails any severity stated
// *by cross-reference* to a sibling code — the "same treatment as § N" idiom used for
// UNTRUSTED-data-handling notes, which is never itself a severity restatement (V-SEVSYNC-02).
// Reuses `parseVcodeTableRows` (check-common.ts, V-INT-02) for the SSOT side.

// A restatement "block" is scoped to one list item — bullet (`*   `/`-  `, any indentation, so
// nested sub-bullets get their own block) or numbered item — or a heading, never a whole
// multi-item section. Table rows (`| ... |`) are dropped: every genuine severity restatement in
// this corpus lives in prose bullets, never a table cell (tables here are illustrative examples,
// e.g. an "anti-rationalization" table showing several unrelated codes+severities together,
// which is not a restatement of any one code's SSOT severity).
const BLOCK_BOUNDARY = /^\s*(?:\*   |-\s|\d+\.\s|#{1,6} )/;

export const findBulletBlocks = (mdContent: string): { text: string; startLine: number }[] => {
  const lines = mdContent.split('\n');
  const blocks: { text: string; startLine: number }[] = [];
  let cur: string[] = [];
  let start = 1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) continue; // table rows never start or extend a block
    if (BLOCK_BOUNDARY.test(lines[i]) && cur.length) {
      blocks.push({ text: cur.join(' '), startLine: start });
      cur = [];
    }
    if (cur.length === 0) start = i + 1;
    cur.push(lines[i].trim());
  }
  if (cur.length) blocks.push({ text: cur.join(' '), startLine: start });
  return blocks;
};

// A block can span several unrelated sentences (e.g. an "Interaction with §11" bullet that
// mentions an unrelated bare `BLOCK` word in one sentence and a different code in another) —
// splitting further avoids pairing a stray severity word with a distant, unrelated code mention.
export const splitSentences = (blockText: string): string[] =>
  blockText.split(/(?<=[.:])\s+(?=[A-Z`"(*\d-])/);

const SEVERITY_TOKEN = /`(BLOCK|WARN)`|—\s*(?:severity\s*)?(BLOCK|WARN)\b/;
const CROSS_REFERENCE = /same (severity|treatment|classification) as/i;
const CODE_TOKEN = /`(V-[\w/-]+)`/g;

export type Classification =
  | { kind: 'none' }
  | { kind: 'cross-reference'; codes: string[] }
  | { kind: 'restatement'; codes: string[]; statedSeverity: string };

// One named, cited, removable exemption — not a structural carve-out. `V-PARETO-02` carries two
// contradictory rules under one code: `blackhole-vcodes.md:42` declares it a BLOCK filing gate
// (Priority = Gain × (11 − Effort) ≥ 30), while `reviewer.md` §6 instructs logging improvement
// discoveries under that code at WARN. The ledger's 35 `V-PARETO-02` occurrences are all
// NOTE/WARN — BLOCK has never fired. Severity is a property of the code, not of an instance
// (`mercure-enforcement-contract.md`), so this genuinely contradicts the table rather than
// describing a different kind of statement — no structural exclude-list for "logged as a
// finding" phrasing was added to hide it. Delete this entry when #586 resolves the split.
export const KNOWN_SEVERITY_EXEMPTIONS: string[] = [];

// The false-positive guard (issue #567's own AC): a cross-reference phrase only counts as a
// *severity* cross-reference when the sentence also carries a severity token — the
// UNTRUSTED-note shape ("same treatment as § 10's UNTRUSTED note") has no severity token at all,
// so it structurally cannot be a severity restatement. This falls out of what a severity
// restatement requires (a severity token), not a text-content exclude-list keyed on "UNTRUSTED".
export const classifySentence = (sentence: string): Classification => {
  const codes = [...sentence.matchAll(CODE_TOKEN)].map((m) => m[1]);
  if (!codes.length) return { kind: 'none' };

  const hasCrossRef = CROSS_REFERENCE.test(sentence);
  const severityMatch = sentence.match(SEVERITY_TOKEN);

  if (hasCrossRef && severityMatch) return { kind: 'cross-reference', codes };
  if (!severityMatch) return { kind: 'none' };
  // One of the two alternation branches always captures — SEVERITY_TOKEN only matches when
  // group 1 (backtick-quoted) or group 2 (dash-prefixed) is present.
  const statedSeverity = (severityMatch[1] ?? severityMatch[2]) as string;
  return { kind: 'restatement', codes, statedSeverity };
};

// Compares a restatement's stated severity against the SSOT map for each code token found. A
// code that isn't an exact key in the SSOT map (e.g. a bare sub-code like `V-SEC-01` mentioned
// in an illustrative example, where the table's real key is the combined `V-SEC-01/02`) is a
// lookup miss, not a mismatch — nothing to compare against, so it is never reported. A code in
// `KNOWN_SEVERITY_EXEMPTIONS` is skipped even on a real mismatch — named, cited, removable debt.
export const findSeverityMismatches = (
  sentences: string[],
  sevMap: Map<string, string>,
): { code: string; stated: string; ssot: string }[] => {
  const mismatches: { code: string; stated: string; ssot: string }[] = [];
  for (const sentence of sentences) {
    const c = classifySentence(sentence);
    if (c.kind !== 'restatement') continue;
    for (const code of c.codes) {
      if (KNOWN_SEVERITY_EXEMPTIONS.includes(code)) continue;
      const ssot = sevMap.get(code);
      if (ssot && ssot !== c.statedSeverity) mismatches.push({ code, stated: c.statedSeverity, ssot });
    }
  }
  return mismatches;
};

// A cross-reference sentence is never itself a valid severity source — it must point to a code
// that actually declares a severity somewhere else. `V-SEVSYNC-02` fires unconditionally for
// every cross-reference-with-severity-token sentence (see classifySentence): restating severity
// "by reference" to a sibling code, rather than the SSOT table, is itself the violation, whether
// or not the referenced code's severity happens to be correct today.
export const findCrossReferenceViolations = (sentences: string[]): { code: string }[] => {
  const violations: { code: string }[] = [];
  for (const sentence of sentences) {
    const c = classifySentence(sentence);
    if (c.kind === 'cross-reference') {
      for (const code of c.codes) violations.push({ code });
    }
  }
  return violations;
};

const scanFiles = (files: string[], sevMap: Map<string, string>) => {
  const mismatches: { file: string; line: number; code: string; stated: string; ssot: string }[] = [];
  const crossRefs: { file: string; line: number; code: string }[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const relFile = path.relative(root, file);
    for (const block of findBulletBlocks(content)) {
      const sentences = splitSentences(block.text);
      for (const m of findSeverityMismatches(sentences, sevMap)) {
        mismatches.push({ file: relFile, line: block.startLine, ...m });
      }
      for (const r of findCrossReferenceViolations(sentences)) {
        crossRefs.push({ file: relFile, line: block.startLine, ...r });
      }
    }
  }
  return { mismatches, crossRefs };
};

const checkVcodeSeverityLiteralSync = (mismatches: { file: string; line: number; code: string; stated: string; ssot: string }[]): CheckResult =>
  mismatches.length
    ? {
        id: 'V-SEVSYNC-01',
        ok: false,
        detail: mismatches.map((m) => `${m.file}:${m.line} ${m.code} stated ${m.stated}, SSOT says ${m.ssot}`).join('; '),
      }
    : { id: 'V-SEVSYNC-01', ok: true };

const checkVcodeSeverityCrossReference = (crossRefs: { file: string; line: number; code: string }[]): CheckResult =>
  crossRefs.length
    ? {
        id: 'V-SEVSYNC-02',
        ok: false,
        detail: crossRefs.map((r) => `${r.file}:${r.line} ${r.code} severity stated by cross-reference, not SSOT`).join('; '),
      }
    : { id: 'V-SEVSYNC-02', ok: true };

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => {
  const vcodesContent = fs.readFileSync(path.join(root, 'src/references/blackhole-vcodes.md'), 'utf-8');
  const sevMap = new Map(parseVcodeTableRows(vcodesContent).map((r) => [r.code, r.severity]));

  const files = [
    ...walkMdFilesAbs(path.join(root, 'src/agents')),
    ...walkMdFilesAbs(path.join(root, 'src/references')),
  ];
  const { mismatches, crossRefs } = scanFiles(files, sevMap);

  return [checkVcodeSeverityLiteralSync(mismatches), checkVcodeSeverityCrossReference(crossRefs)];
};

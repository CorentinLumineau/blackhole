import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import { parseVcodeTableRows, walkMdFilesAbs } from '../lib/check-common.ts';

// Issue #565 — vcode-citation.check.ts: resolves every `blackhole-vcodes.md` row's `Primary
// enforcement site` cell to an actual file + section, and asserts the row's code appears inside
// that section's body. Reuses `parseVcodeTableRows` (check-common.ts, V-INT-02) rather than a
// fourth divergent pipe-table parser — see that function's header comment for the other three
// precedents.

// #564/#587/#588 closed the three original section-resolves-fine, code-string-absent
// (V-CITE-02) near-misses this array once held (V-SEC-10, V-AUTO-01, V-TEST-09 respectively).
// The mechanism stays — a named, individually-cited, removable exemption list, never a blanket
// allow-list — for whichever genuine future case needs it.
export const KNOWN_CITATION_EXEMPTIONS: string[] = [];

type Segment = { file: string; sectionRef: string | null };

// Splits a multi-file citation cell on ` + ` (e.g. `scripts/design-aggregate.ts + planner.md
// §4.8`), then per segment extracts a trailing `§N` (single integer, e.g. `reviewer.md §10`) or
// `§ Name` (free text up to end-of-segment or an opening paren, e.g. `doc-governance.md §
// Search-Before-Write`). A segment with neither a `§`, or a multi-level ref like `§4.8`, gets
// `sectionRef: null` — no outline-numbering resolver for one row (V-YAGNI-01); see the file
// header for the two-level-number case.
export const parseCitationCell = (site: string): Segment[] =>
  site.split(' + ').map((raw) => {
    const seg = raw.trim();
    const numMatch = seg.match(/^(.*?)\s*§(\d+)(?:\s*\([^)]*\))?\s*$/);
    if (numMatch) return { file: numMatch[1].trim(), sectionRef: `§${numMatch[2]}` };

    const namedMatch = seg.match(/^(.*?)\s*§\s*([^(]+?)(?:\s*\([^)]*\))?\s*$/);
    if (namedMatch && !/^\d+(\.\d+)+$/.test(namedMatch[2].trim())) {
      return { file: namedMatch[1].trim(), sectionRef: namedMatch[2].trim() };
    }

    const multiLevel = seg.match(/^(.*?)\s*§[\d.]+\s*$/);
    if (multiLevel) return { file: multiLevel[1].trim(), sectionRef: null };

    const bare = seg.match(/^([^(]+)/);
    return { file: (bare ? bare[1] : seg).trim(), sectionRef: null };
  });

// Filename -> absolute path index over src/agents/ and src/references/ (recursive), keyed both
// by the path relative to that root (e.g. `hunt/docs.md`) and by bare basename (e.g. `docs.md`
// would collide across subfolders, but every citation in the live table names either a bare
// top-level file or a `dir/file.md` relative path — never an ambiguous bare basename that also
// exists nested elsewhere).
export const buildCitationFileIndex = (agentsDir: string, referencesDir: string): Map<string, string> => {
  const idx = new Map<string, string>();
  for (const base of [agentsDir, referencesDir]) {
    for (const abs of walkMdFilesAbs(base)) {
      idx.set(path.relative(base, abs).split(path.sep).join('/'), abs);
      idx.set(path.basename(abs), abs);
    }
  }
  return idx;
};

const resolveFile = (fileRef: string, idx: Map<string, string>): string | null =>
  fileRef.endsWith('.ts') ? (fs.existsSync(path.join(root, fileRef)) ? path.join(root, fileRef) : null) : (idx.get(fileRef) ?? null);

// Numeric `§N` → a `^#{2,4} N. ` heading; named `§ Name` → a heading whose text (stripped of
// `#`/backticks) equals or starts with `Name`; `null` → no resolution attempted (immediate
// whole-file fallback). Body spans to the next heading of equal-or-higher level, or EOF. Returns
// `null` when a *given* section ref fails to resolve — the caller (scanVcodeCitations) treats
// that the same as a `null` ref: whole-file fallback, never `V-CITE-01` by itself. See that
// caller for the rationale (the `orchestrator-runtime.md § Triage step 1b` case).
export const resolveSection = (fileContent: string, sectionRef: string | null): { body: string } | null => {
  if (sectionRef === null) return { body: fileContent };
  const lines = fileContent.split('\n');
  const isNumeric = /^§\d+$/.test(sectionRef);
  const headingRe = isNumeric ? new RegExp(`^#{2,4}\\s*${sectionRef.slice(1)}\\.\\s`) : null;

  let startIdx = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (!hm) continue;
    const matches = isNumeric ? headingRe!.test(lines[i]) : (() => {
      const text = hm[2].replace(/`/g, '').trim();
      return text === sectionRef || text.startsWith(sectionRef as string);
    })();
    if (matches) {
      startIdx = i;
      level = hm[1].length;
      break;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const hm = lines[i].match(/^(#+)\s/);
    if (hm && hm[1].length <= level) {
      endIdx = i;
      break;
    }
  }
  return { body: lines.slice(startIdx, endIdx).join('\n') };
};

// Combined-code keys (`V-ADA-05/06/07`) split into sub-codes; satisfied if at least one
// sub-code's literal string appears — permissive by design, see the plan's rationale in the
// issue: the AC's core intent is "the site binds the code," not "every combined sub-code is
// individually pinned at the same citation."
export const codeAppearsIn = (searchText: string, code: string): boolean =>
  code.split(/[/,\s]+/).filter(Boolean).some((c) => searchText.includes(c));

type ScanResult = { unresolved: string[]; codeAbsent: string[] };

// One row-scan pass shared by both check functions below (V-DRY-01) — resolving citations is
// the expensive part (file reads); V-CITE-01/V-CITE-02 are two different judgments over the
// same resolved data, not two independent scans.
//
// Fallback generalization (ADR-review ruling on the `orchestrator-runtime.md § Triage step 1b`
// case): a section ref that fails to resolve to a heading degrades to the whole-file body —
// the same treatment `parseCitationCell` already gives a `null` sectionRef (e.g. `planner.md
// §4.8`'s two-level ref). `V-CITE-01` fires only when the *file itself* is missing; a citation
// naming a section that doesn't exist silently weakens to "the code appears somewhere in the
// cited file" rather than "in the cited section" — a known, declared limitation of the fallback
// tier, not a bug. Only the file-missing case is a real V-CITE-01.
export const scanVcodeCitations = (
  rows: { code: string; site: string }[],
  idx: Map<string, string>,
): ScanResult => {
  const unresolved: string[] = [];
  const codeAbsent: string[] = [];

  for (const row of rows) {
    const bodies: string[] = [];
    let fileMissing = false;

    for (const seg of parseCitationCell(row.site)) {
      const filePath = resolveFile(seg.file, idx);
      if (!filePath) {
        unresolved.push(`${row.code}: file not found (${seg.file})`);
        fileMissing = true;
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const resolved = resolveSection(content, seg.sectionRef);
      bodies.push(resolved ? resolved.body : content);
    }

    if (fileMissing || !bodies.length) continue;
    if (!bodies.some((b) => codeAppearsIn(b, row.code)) && !KNOWN_CITATION_EXEMPTIONS.includes(row.code)) {
      codeAbsent.push(row.code);
    }
  }

  return { unresolved, codeAbsent };
};

const buildScan = (): ScanResult => {
  const idx = buildCitationFileIndex(path.join(root, 'src/agents'), path.join(root, 'src/references'));
  const rows = parseVcodeTableRows(read('src/references/blackhole-vcodes.md'));
  return scanVcodeCitations(rows, idx);
};

// V-CITE-01: every citation segment's file exists. A `§`-section that fails to resolve to a
// real heading is not a failure here — it degrades to the whole-file fallback (see
// scanVcodeCitations) — only a missing file is.
const checkVcodeCitationResolution = (scan: ScanResult): CheckResult =>
  scan.unresolved.length
    ? { id: 'V-CITE-01', ok: false, detail: scan.unresolved.join('; ') }
    : { id: 'V-CITE-01', ok: true };

// V-CITE-02: the row's code string is findable in the resolved site body, unless named-exempted.
const checkVcodeCitationCoverage = (scan: ScanResult): CheckResult =>
  scan.codeAbsent.length
    ? { id: 'V-CITE-02', ok: false, detail: `code string absent at cited site: ${scan.codeAbsent.join(', ')}` }
    : { id: 'V-CITE-02', ok: true };

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => {
  const scan = buildScan();
  return [checkVcodeCitationResolution(scan), checkVcodeCitationCoverage(scan)];
};

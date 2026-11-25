import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root, read } from '../checks/check-utils.ts';
import { walkFilesAbs } from './fs.ts';
import { expandIncludes } from './build/content.ts';
import { BUILD_INPUT_ONLY_DIRS, PLATFORM_TARGETS } from './build/facts.ts';

// ADR-007 R6 / issue #375 — shared cross-domain check helpers extracted from domain
// *.check.ts modules so checks no longer act as an informal shared library (V-INT-02).
// Imports only check-utils (root), lib/fs (walkFilesAbs), and lib/build/facts.ts (PLATFORM_TARGETS) —
// never any *.check.ts module, to avoid import cycles.

// Shared filter: which of `required` are absent from `content`. Used by agents.check.ts's
// V-GATE-01 check and by config-gate, design-track, single-writer, and coverage-regression
// gate-marker checks — one definition, ADR-007 R6/V-INT-02 (no local reimplementation).
export const findMissingGateMarkers = (content: string, required: string[]): string[] =>
  required.filter((marker) => !content.includes(marker));

// ADR-034: an agent shell composes its body from `{{INCLUDE:<dir>/*}}` modules at build time, so
// a marker-presence scan that reads the shell alone sees only the shell and passes vacuously the
// moment a gate moves into a module. Returns what the compiled agent actually contains — the
// same expansion `processFile` performs — so every such scan keeps its pre-seam surface. A file
// with no marker is returned unchanged, so this is safe for any agent doc.
// ADR-039 (issue #882): `read(rel)` already expands any marker at a declared site, so the
// `expandIncludes` call below is a provable no-op for a declared site (its expanded output has
// no `{{INCLUDE:...}}` substring left to match) and an equally-inert no-op for a non-declared one
// (the site gate itself returns the input unchanged). Do not delete either call on the strength
// of this duplication alone — which of the two helpers should own composition is a separate,
// deliberately deferred question (a rejected ADR-039 alternative's territory).
export const readComposedAgentDoc = (rel: string): string =>
  expandIncludes(read(rel), path.join(root, rel));

// Slice 6 of #1387: `planner.md` keeps one stub per track and the track bodies live in
// `PLANNER_TRACK_MODULE_DIR`, read on demand. A content scan of "what the planner instructs"
// reads the shell plus every track module (directory order = track order), each through
// `read()` so a fixture override of a single module still takes effect.
export const PLANNER_TRACK_MODULE_DIR = 'src/references/planner-tracks';

export const readPlannerTrackModules = (): string[] =>
  fs
    .readdirSync(path.join(root, PLANNER_TRACK_MODULE_DIR))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => read(`${PLANNER_TRACK_MODULE_DIR}/${f}`));

export const readPlannerWithTracks = (): string =>
  [readComposedAgentDoc('src/agents/planner.md'), ...readPlannerTrackModules()].join('\n');

// ADR-034: the repo-relative form (`src/<dir>`) of every declared build-input-only module
// directory, for a prose sweep whose declared scope is "agent instruction text". A sweep over
// `src/agents`/`src/references` alone stops covering a gate the moment it becomes a module;
// unlike `readComposedAgentDoc` above, this keeps each module's own file:line coordinates, which
// a violation-reporting sweep needs.
export const buildInputModuleDirs = (): string[] => BUILD_INPUT_ONLY_DIRS.map((dir) => `src/${dir}`);

// Platform-conditional-leak scan (V-GEMINI-01/V-CODEX-04): compiled output for `activeTarget`
// must contain no unresolved {{#<platform>}} marker for any *other* platform — a leaked marker
// means applyPlatformConditionals failed to strip it. Iterates PLATFORM_TARGETS (build.ts's
// § facts SSOT, issue #327) instead of a hardcoded cursor/claude pair, so a leak from any of the
// 5 platforms is caught — previously only 2 of 5 were checked, silently missing e.g. a leaked
// {{#skills}} block in Gemini output or a leaked {{#gemini}} block in Codex output. Exported for
// direct unit coverage, same rationale as isAgentCountError in codex-build.check.ts — both call
// sites close over the repo-root filesystem and can't be exercised in isolation otherwise.
export const leakedPlatformConditionalMarkers = (
  content: string,
  activeTarget: (typeof PLATFORM_TARGETS)[number]
): string[] =>
  PLATFORM_TARGETS.filter((platform) => platform !== activeTarget).filter((platform) =>
    new RegExp(`\\{\\{#${platform}\\}\\}`).test(content)
  );

// checkGeminiBuild, checkGeminiDistributionBundle, checkClaudeDistributionBundle, checkBuild,
// and checkCodexBuild all need `bun run build` to have run before asserting file shape /
// diffing porcelain — memoize so a full `bun run verify` pass only builds once.
// ADR-007 T2: plain `bun run build` regenerates every git-tracked target; deprecated
// --gemini/--all/--no-codex flags are no-ops per DEPRECATED_BUILD_FLAGS in build.ts.
let fullBuildResult: { ok: boolean; output: string } | null = null;

export const runFullBuildOnce = (): { ok: boolean; output: string } => {
  if (!fullBuildResult) {
    const build = spawnSync('bun', ['run', 'build'], { cwd: root, encoding: 'utf-8' });
    fullBuildResult = { ok: build.status === 0, output: build.stderr || build.stdout || '' };
  }
  return fullBuildResult;
};

// Thin .md-filtering wrapper over scripts/lib/fs.ts's shared, directory-safe walker
// (ADR-007 R6 — one tree-walker, no local reimplementation, V-INT-02).
export const walkMdFilesAbs = (absDir: string): string[] =>
  walkFilesAbs(absDir).filter((f) => f.endsWith('.md'));

export const walkMdFiles = (dir: string): string[] =>
  walkMdFilesAbs(path.join(root, dir)).map((f) => path.relative(root, f));

// Resolves an ADR reference (e.g. "ADR-007") to its file under `decisionsDir` by prefix match on
// `${adrRef}-`. The trailing hyphen is load-bearing: without it "ADR-007" also matches
// "ADR-0071-...". Returns `null` on no match or a missing `decisionsDir` — never throws.
//
// `links.check.ts` resolves ADRs by a directory-listing Set rather than a per-number lookup, so it
// is not a consumer of this function.
export const findAdrFileByNumber = (decisionsDir: string, adrRef: string): string | null => {
  if (!fs.existsSync(decisionsDir)) return null;
  const found = fs.readdirSync(decisionsDir).find((f) => f.startsWith(`${adrRef}-`));
  return found ? path.join(decisionsDir, found) : null;
};

/** Escapes `value` for literal use inside a `RegExp` source. */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const listFiles = (dir: string, ext = '.md'): string[] => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith(ext));
};

// Issue #570/#567/#565 batch: `blackhole-vcodes.md`'s `| Code | Rule | Severity | Primary
// enforcement site |` table needs one shared {code, severity, site}[] extraction — consumed by
// both vcode-severity-sync.check.ts and vcode-citation.check.ts — rather than two divergent
// parsers (V-INT-02). Same split('|').map(trim) + length-guard row idiom as parseIndexTableRows
// below (this table's row shape differs, the technique doesn't) and ground-truth.check.ts's
// parseVcodeEnforcementSites (this exact table, narrower {code, site} extraction for
// V-GROUND-02): skip non-`|`-leading lines; split on `|` and trim; the first data cell's `V-`
// prefix discriminates a real row from header/separator rows (whose first cell is `Code`/`:---:`
// and never starts with `V-`).
export const parseVcodeTableRows = (
  vcodesContent: string,
): { code: string; severity: string; site: string }[] => {
  const rows: { code: string; severity: string; site: string }[] = [];
  for (const line of vcodesContent.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const code = cells[1];
    if (!code.startsWith('V-')) continue;
    rows.push({ code, severity: cells[3], site: cells[4] });
  }
  return rows;
};

// The code *family* a `V-…` id belongs to — everything ahead of its numeric suffix, so
// multi-segment names (`V-DOC-GOV-02` -> `V-DOC-GOV`) survive intact. Ownership of a family is
// what tells a campaign V-code apart from a check-internal result id; see
// vcode-citation.check.ts's `findUndocumentedEmittedCodes` for the judgment that consumes it.
export const vcodeFamily = (code: string): string => code.replace(/-\d+$/, '');

// One `blackhole-vcodes.md` row key can bundle several codes (`V-ADA-05/06/07`, `V-KISS-01 /
// V-YAGNI-01`). Expands a key into whole codes, carrying the last seen family across bare
// numeric continuations, so callers reasoning about individual codes never see a half-code.
export const expandVcodeTableKey = (key: string): string[] => {
  let family = '';
  return key.split(/[/,\s]+/).filter(Boolean).flatMap((part) => {
    const whole = part.match(/^(V-[A-Z-]*[A-Z])-\d+$/);
    if (whole) family = whole[1];
    return whole ? [part] : /^\d+$/.test(part) && family ? [`${family}-${part}`] : [];
  });
};

// Issue #573 (#498 deferral): `documentation/**/INDEX.md`'s 5-column `| path | summary | type |
// status | review_trigger |` schema (doc-health.check.ts's parseRootIndexRows; the decisions
// index is read by header name instead, readIndexColumns). Same split('|').map(trim) +
// length-guard idiom as parseVcodeTableRows above (V-INT-02) — the row-splitting *technique* is shared; the path
// column's *interpretation* is not (folder-prefixed vs. bare filename) and stays with each
// caller. Header/separator rows are skipped by the generic 'path' header value and the
// dash-only separator pattern — both live INDEX.md files use the literal 'path' header cell.
// Cells split on unescaped pipes only and come back unescaped, so a value renderIndexRowLine
// wrote with an escaped `|` reads back to the value it was given.
export const parseIndexTableRows = (
  content: string,
): { path: string; summary: string; type: string; status: string; reviewTrigger: string }[] => {
  const rows: { path: string; summary: string; type: string; status: string; reviewTrigger: string }[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitUnescapedPipes(line).map((c) => unescapeTableCell(c.trim()));
    if (cells.length < 6) continue;
    const p = cells[1];
    if (!p || p.toLowerCase() === 'path' || /^:?-+:?$/.test(p)) continue;
    rows.push({ path: p, summary: cells[2], type: cells[3], status: cells[4], reviewTrigger: cells[5] });
  }
  return rows;
};

// Lives here rather than in doc-health.check.ts: a `*.check.ts` extension makes a module
// unimportable from lib/ (this module's own header forbids importing any *.check.ts module, to
// avoid import cycles), and companion-file-sync.ts (lib/) needs this same idempotent-append
// primitive for the journeys.md INDEX row repair. doc-health.check.ts re-exports both names, so
// its own importers keep working.
export type RootIndexRow = { path: string; summary: string; type: string; status: string; reviewTrigger: string };

// Issue #941: extracted from decision-log-append.ts's local function of the same name and
// signature (issue #940) — that file's own carve-out for keeping it unexported was conditioned
// on "exactly one call site" (V-YAGNI-03); renderIndexRowLine below is a second real production
// consumer, so the guard moves here rather than being duplicated. escapeCell-style rendering
// (decision-log-append.ts) escapes `|` only, so a cell value carrying a real embedded
// newline/carriage-return (e.g. a JSON string whose `\n` escape became a literal newline before
// reaching this function) is written verbatim, splitting a pipe-table row across two physical
// lines. findTableBlock's blockEnd walk then treats the orphaned tail as "outside the table", so
// every insert made afterward silently corrupts the table further. Reject, don't escape: throw
// as soon as the first bad field is found, before any output is built.
export const assertNoEmbeddedNewline = (value: string, id: number | string, field: string): void => {
  if (/[\r\n]/.test(value)) {
    throw new Error(`record ${id} field "${field}" contains an embedded newline/carriage-return character`);
  }
};

// Issue #811 (ADR-031 Phase 1): exported for reuse by scripts/lib/doc-index-generate.ts, which
// needs the identical row-render shape and sort order the root-INDEX carry-step already
// produces — no second sort/render implementation (V-INT-02).
//
// Issue #941: guarded by assertNoEmbeddedNewline (above) for all five fields before any output is
// built — covers both of appendIndexRowIfAbsent's write branches below and
// doc-index-generate.ts's direct calls, since every one of them renders through this one
// function.
//
// Every cell goes through escapeTableCell, so a `|` in a frontmatter value stays inside its cell
// and parseIndexTableRows reads it back unchanged.
export const renderIndexRowLine = (row: RootIndexRow): string => {
  assertNoEmbeddedNewline(row.path, row.path, 'path');
  assertNoEmbeddedNewline(row.summary, row.path, 'summary');
  assertNoEmbeddedNewline(row.type, row.path, 'type');
  assertNoEmbeddedNewline(row.status, row.path, 'status');
  assertNoEmbeddedNewline(row.reviewTrigger, row.path, 'reviewTrigger');
  const cells = [row.path, row.summary, row.type, row.status, row.reviewTrigger].map(escapeTableCell);
  return `| ${cells.join(' | ')} |`;
};

// Byte-order (UTF-16 code-unit) comparator, deliberately not String.prototype.localeCompare —
// localeCompare uses the runtime's default-locale ICU collation, which can diverge from byte
// order on real path shapes (e.g. case variants, "_" vs "-") and is not guaranteed identical
// across machines/Node builds. The sorted-insert guarantee this file exists to provide only
// holds if two machines compute the same position for the same row, so the comparator must not
// depend on locale.
export const byPathByteOrder = (a: RootIndexRow, b: RootIndexRow): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// Locates a pipe-table's header-separator line and the contiguous block of `|`-prefixed row
// lines that follows it, in a raw line array. Schema-agnostic — it never inspects row content,
// only table structure (`/^:?-+:?$/` on the second cell marks the separator; a row block is the
// run of `|`-prefixed lines immediately after it) — so it is shared, not reimplemented, by
// every row-schema-specific rebuild that needs the same block boundary:
// `appendIndexRowIfAbsent` below (5-column INDEX.md rows) and `decision-log-append.ts`'s
// `insertRecordRowsSorted` (5-column Records-table rows, a different schema entirely — V-DRY-01,
// issue #887 review). `separatorIdx: -1` signals no parseable table was found; `blockEnd` is
// meaningless in that case and callers must not read it.
export const findTableBlock = (lines: string[]): { separatorIdx: number; blockEnd: number } => {
  let separatorIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length >= 2 && /^:?-+:?$/.test(cells[1])) {
      separatorIdx = i;
      break;
    }
  }

  if (separatorIdx === -1) return { separatorIdx: -1, blockEnd: -1 };

  let blockEnd = separatorIdx + 1;
  while (blockEnd < lines.length && lines[blockEnd].trim().startsWith('|')) blockEnd++;

  return { separatorIdx, blockEnd };
};

// A repo may render the same INDEX.md path two different ways — blackhole's own bare-path
// form, or mercure's self-referential markdown-link form (`[path](path)`, per a target repo's
// own convention — `doc-governance.md` § Repo Convention Precedence). Strips the link wrapper
// so both forms compare by the same underlying path string. The href group is greedy (`(.*)`),
// not an excluded-character class, because a repo-relative path can itself contain a literal
// `)` (e.g. `notes(final).md`); the `$` anchor is what makes greedy safe, forcing the match to
// the link's actual closing paren rather than the first one encountered — an excluded-character
// class stops at that first `)` and fails to match such a path at all, silently falling through
// to the "not a link" branch below. Anchored `^...$` so a non-link cell that merely contains a
// literal `[`/`]`/`)` character is returned unchanged rather than partial-matched.
const canonicalIndexPath = (cell: string): string => {
  const trimmed = cell.trim();
  const link = trimmed.match(/^\[([^\]]*)\]\((.*)\)$/);
  return link ? link[2] : trimmed;
};

// Extracts a row line's path cell directly from raw text — `line.split('|')[1]` trimmed —
// rather than via parseIndexTableRows's full-row reconstruction, so a later cell's GFM-escaped
// pipe (`\|`) can never shift this column. Safe even then, because a repo-relative path never
// itself contains a literal `|` character — the first two `|` delimiters in any row line always
// bound exactly the path column no matter what a later cell contains. Canonicalized via
// canonicalIndexPath so a link-wrapped and bare rendering of the same path compare equal for
// both dedup and sort.
const rowPathFromRawLine = (line: string): string => canonicalIndexPath(line.split('|')[1] ?? '');

// Idempotent, path-sorted row-insert primitive (issue #490, ADR-021 D2 carry-step; sorted
// insert per issue #743). Built on findTableBlock above for row-block boundary detection.
// Guards a duplicate row on implementer re-spawn, then rebuilds the entire row block in path
// order — [...existing, new].sort(...) — rather than appending at the end, so concurrent
// carry/promotion PRs land their new rows at different offsets instead of the same anchor line
// (the guaranteed-collision failure mode this issue closes).
//
// Dedups and sorts via canonicalIndexPath / rowPathFromRawLine above, operating on raw
// row-line text rather than parseIndexTableRows's field-level reconstruction, so an untouched
// row survives byte-for-byte no matter what any of its cells contain. Same raw-line-preserving
// technique as `decision-log-append.ts`'s `insertRecordRowsSorted` — reused, not reinvented
// (V-INT-02); that function's own sort key (a numeric id, no rendering-style ambiguity) does
// not generalize here, so `canonicalIndexPath` is new.
export const appendIndexRowIfAbsent = (indexContent: string, row: RootIndexRow): { content: string; appended: boolean } => {
  const canonicalNewPath = canonicalIndexPath(row.path);
  if (parseIndexTableRows(indexContent).some((r) => canonicalIndexPath(r.path) === canonicalNewPath)) {
    return { content: indexContent, appended: false };
  }

  const lines = indexContent.split('\n');
  const { separatorIdx, blockEnd } = findTableBlock(lines);

  // No parseable table (e.g. a fresh/malformed doc with no header separator) — fall back to
  // plain append-at-end, same behavior as before this change.
  if (separatorIdx === -1) {
    const line = renderIndexRowLine(row);
    return { content: `${indexContent}${indexContent.endsWith('\n') ? '' : '\n'}${line}\n`, appended: true };
  }

  return { content: insertRowSorted(lines, separatorIdx, blockEnd, renderIndexRowLine(row), rowPathFromRawLine), appended: true };
};

// Shared tail of both index appenders: rebuilds the row block with the new line inserted and the
// block ordered by `keyOf` (byte order, never localeCompare — see byPathByteOrder above), leaving
// every line outside the block, and every untouched row, byte-for-byte as it was.
const insertRowSorted = (
  lines: string[],
  separatorIdx: number,
  blockEnd: number,
  newLine: string,
  keyOf: (rawLine: string) => string,
): string => {
  const sortedLines = [...lines.slice(separatorIdx + 1, blockEnd), newLine].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return [...lines.slice(0, separatorIdx + 1), ...sortedLines, ...lines.slice(blockEnd)].join('\n');
};

// Splits a GFM table line on its cell delimiters only: a pipe preceded by an odd run of
// backslashes is escaped cell content and stays in its cell verbatim; after an even run (`\\|`,
// an escaped backslash) it is a real delimiter.
export const splitUnescapedPipes = (line: string): string[] => {
  const cells: string[] = [];
  let start = 0;
  let backslashes = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '|' && backslashes % 2 === 0) {
      cells.push(line.slice(start, i));
      start = i + 1;
    }
    backslashes = ch === '\\' ? backslashes + 1 : 0;
  }
  cells.push(line.slice(start));
  return cells;
};

// Escapes a cell value for a GFM pipe-table row: each `|` becomes `\|`, and the backslashes
// directly before it are doubled so they cannot pair up with the escape. Other backslashes are
// left alone, so a value with no pipe renders exactly as before.
export const escapeTableCell = (value: string): string =>
  value.replace(/(\\*)\|/g, (_m, bs: string) => `${bs}${bs}\\|`);

// Inverse of escapeTableCell, for a cell already split by splitUnescapedPipes (every pipe left in
// it is preceded by an odd run of backslashes).
export const unescapeTableCell = (cell: string): string =>
  cell.replace(/(\\+)\|/g, (_m, bs: string) => `${'\\'.repeat((bs.length - 1) / 2)}|`);

const splitRowCells = (line: string): string[] => {
  const cells = splitUnescapedPipes(line).map((c) => c.trim());
  return cells.slice(1, cells[cells.length - 1] === '' ? -1 : undefined);
};

const isSeparatorRow = (line: string): boolean => {
  const cells = line.split('|').map((c) => c.trim());
  return cells.length >= 2 && /^:?-+:?$/.test(cells[1]);
};

// The header is the table's first non-separator pipe row. Column names are lowercased.
const indexHeaderColumns = (indexContent: string): string[] => {
  const header = indexContent.split('\n').find((l) => l.trim().startsWith('|') && !isSeparatorRow(l));
  return header ? splitRowCells(header).map((c) => c.toLowerCase()) : [];
};

// A decisions INDEX whose first column is `ADR` (mercure `ADR | Title | Status | Date`, invest
// adds `Traceability`) uses a different row schema than blackhole's `path | summary | ...`;
// column-name detection is the only signal the carry step has for which one it is appending to.
export const isAdrIndexHeader = (indexContent: string): boolean => indexHeaderColumns(indexContent)[0] === 'adr';

export class IndexFragmentShapeError extends Error {
  override name = 'IndexFragmentShapeError';
}

const BLACKHOLE_INDEX_COLUMNS = ['path', 'summary', 'type', 'status', 'review_trigger'];

// Refuses a staged row fragment whose shape does not match the blackhole-schema table it is about
// to be appended to (the target's own header, or blackhole's five columns when it has none).
// parseIndexTableRows reads any row of five or more cells positionally, so a four-cell foreign
// fragment (mercure `ADR | Title | Status | Date`) would otherwise come back with its cells in the
// wrong columns and an empty review_trigger. A cell-count mismatch, or an `adr` type value sitting
// outside the type column (a shifted row), throws before anything is written. Converting a foreign
// fragment by column name is not attempted: it carries no summary/review_trigger to map from.
export const assertIndexFragmentShape = (indexContent: string, fragment: string): void => {
  const header = indexHeaderColumns(indexContent);
  const columns = header.length > 0 ? header : BLACKHOLE_INDEX_COLUMNS;
  const line = fragment.split('\n').find((l) => l.trim().startsWith('|'));
  const cells = line ? splitRowCells(line) : [];
  if (cells.length !== columns.length) {
    throw new IndexFragmentShapeError(
      `staged append_row fragment has ${cells.length} cells but the target table has ${columns.length} columns (${columns.join(' | ')}); refusing to append it misaligned: ${fragment}`,
    );
  }
  const typeIdx = columns.indexOf('type');
  const strayAdr = cells.findIndex((c, i) => i !== typeIdx && c.toLowerCase() === 'adr');
  if (typeIdx !== -1 && strayAdr !== -1) {
    throw new IndexFragmentShapeError(
      `staged append_row fragment carries the \`adr\` type value in column ${strayAdr + 1} (${columns[strayAdr]}), not the type column; refusing to append a shifted row: ${fragment}`,
    );
  }
};

// Reads two columns of an INDEX table by header name rather than by position, so one reader works
// on blackhole's `path | summary | type | status | review_trigger` and on the ADR-style
// `ADR | Title | Status | Date [| Traceability]` header alike. Column names match lowercased; a
// missing column yields no rows. Only the first table's row block (findTableBlock) is read.
// Cells come back trimmed and unescaped, as parseIndexTableRows returns them.
export const readIndexColumns = (
  indexContent: string,
  keyColumn: string,
  valueColumn: string,
): { key: string; value: string }[] => {
  const columns = indexHeaderColumns(indexContent);
  const keyIdx = columns.indexOf(keyColumn.toLowerCase());
  const valueIdx = columns.indexOf(valueColumn.toLowerCase());
  if (keyIdx === -1 || valueIdx === -1) return [];
  const lines = indexContent.split('\n');
  const { separatorIdx, blockEnd } = findTableBlock(lines);
  if (separatorIdx === -1) return [];
  const rows: { key: string; value: string }[] = [];
  for (const line of lines.slice(separatorIdx + 1, blockEnd)) {
    const cells = splitRowCells(line).map(unescapeTableCell);
    if (cells[keyIdx]) rows.push({ key: cells[keyIdx], value: cells[valueIdx] ?? '' });
  }
  return rows;
};

// adr-status.check.ts's V-ADR-02 reader (issue #1411): the decisions INDEX status column, found
// by header name. A blackhole header (`path | ... | status | ...`) is keyed by the ADR filename
// and keeps its status cell verbatim, since V-ADR-02 requires the exact bare token there. An
// ADR-style header (mercure `ADR | Title | Status | Date`, invest adds `Traceability`) is keyed
// by the linked filename, or by the bare `ADR-NNN` id when the cell has no link, and its status
// is the cell's leading word lowercased, past any `*`/`_`/backtick emphasis
// (`**Superseded by ADR-003**` reads `superseded`).
export const parseDecisionsIndexStatusMap = (indexContent: string): Map<string, string> => {
  const rows = new Map<string, string>();
  if (isAdrIndexHeader(indexContent)) {
    for (const { key, value } of readIndexColumns(indexContent, 'adr', 'status')) {
      const link = key.match(/^\[[^\]]*\]\(([^)]*)\)$/);
      const target = link ? path.basename(link[1]) : key;
      const id = target.match(/^ADR-\d+(?:-[^\s]*\.md)?/)?.[0];
      if (!id) continue;
      rows.set(id, (value.match(/^[\s*_`]*([A-Za-z]+)/)?.[1] ?? value).toLowerCase());
    }
    return rows;
  }
  for (const { key, value } of readIndexColumns(indexContent, 'path', 'status')) {
    if (!key.startsWith('ADR-')) continue;
    rows.set(key, value);
  }
  return rows;
};

// An ADR-style index may key a row by its bare `ADR-NNN` id instead of the filename. The id
// fallback applies only when exactly one of `filenames` carries that id, so a V-ADR-05 number
// collision is never covered by one shared row.
export const lookupIndexStatus = (
  indexMap: Map<string, string>,
  filename: string,
  filenames: string[],
): string | undefined => {
  const direct = indexMap.get(filename);
  const id = filename.match(/^ADR-\d+/)?.[0];
  if (direct !== undefined || !id) return direct;
  const sameId = filenames.filter((f) => f.match(/^ADR-\d+/)?.[0] === id);
  return sameId.length === 1 ? indexMap.get(id) : undefined;
};

const ADR_TOKEN = /ADR-\d+/;

// Dedup and sort key: the ADR id, which is the one value every rendering of the same row shares
// (`ADR-001`, `[ADR-001](./ADR-001-x.md)`, `ADR-001-x.md`). A row with no token keys on its raw
// first cell.
const adrRowKey = (rawLine: string): string => {
  const first = splitRowCells(rawLine)[0] ?? '';
  return first.match(ADR_TOKEN)?.[0] ?? first;
};

export class UnclassifiableAdrFragmentError extends Error {
  override name = 'UnclassifiableAdrFragmentError';
}

type AdrFragment = { id: string; file: string; title: string; status: string; date: string };

// A staged fragment is either blackhole's 5-cell shape (`file | title | adr | status | trigger`,
// recognised by `adr` in the type column) or already in the foreign schema (`adr | title |
// status | date`, extra trailing cells ignored). Anything else is unclassifiable and refused: a
// type value of `adr` anywhere but the type column, or a type column with the wrong cell count,
// means the columns are shifted and a best-effort render would corrupt the row.
const parseAdrFragment = (fragment: string): AdrFragment => {
  const line = fragment.split('\n').find((l) => l.trim().startsWith('|'));
  const cells = line ? splitRowCells(line) : [];
  const id = cells[0]?.match(ADR_TOKEN)?.[0];
  if (!id) throw new UnclassifiableAdrFragmentError(`staged append_row fragment did not parse as a table row: ${fragment}`);
  const link = cells[0].match(/^\[[^\]]*\]\((.*)\)$/);
  const file = (link ? link[1] : cells[0]).replace(/^\.\//, '');
  const typeIdx = cells.findIndex((c, i) => i > 0 && c.toLowerCase() === 'adr');
  if (typeIdx === 2 && cells.length === 5) return { id, file, title: cells[1], status: cells[3], date: '' };
  if (typeIdx === -1 && cells.length >= 4) return { id, file, title: cells[1], status: cells[2], date: cells[3] };
  throw new UnclassifiableAdrFragmentError(
    `staged append_row fragment fits neither the 5-cell \`file | title | adr | status | trigger\` shape nor the \`adr | title | status | date\` shape (${cells.length} cells): ${fragment}`,
  );
};

const renderAdrCell = (column: string, f: AdrFragment, today: string): string => {
  switch (column) {
    case 'adr':
      return f.file.endsWith('.md') ? `[${f.id}](./${f.file})` : f.id;
    case 'title':
      return f.title;
    case 'status':
      return f.status.charAt(0).toUpperCase() + f.status.slice(1);
    case 'date':
      return f.date || today;
    default:
      return '';
  }
};

// ADR-schema counterpart of appendIndexRowIfAbsent: renders the row by the target header's own
// column names instead of blackhole's fixed 5 cells, dedups and sorts on the ADR id, and falls
// back to a plain append when the table has no separator row.
export const appendAdrIndexRowIfAbsent = (
  indexContent: string,
  fragment: string,
  opts: { today: string },
): { content: string; appended: boolean } => {
  const parsed = parseAdrFragment(fragment);
  const lines = indexContent.split('\n');
  const { separatorIdx, blockEnd } = findTableBlock(lines);
  const columns = indexHeaderColumns(indexContent);

  const cells = columns.map((column) => {
    const value = renderAdrCell(column, parsed, opts.today);
    assertNoEmbeddedNewline(value, parsed.id, column);
    return value;
  });
  const newLine = `| ${cells.join(' | ')} |`;

  if (separatorIdx === -1) {
    return { content: `${indexContent}${indexContent.endsWith('\n') ? '' : '\n'}${newLine}\n`, appended: true };
  }
  if (lines.slice(separatorIdx + 1, blockEnd).some((l) => adrRowKey(l) === parsed.id)) {
    return { content: indexContent, appended: false };
  }
  return { content: insertRowSorted(lines, separatorIdx, blockEnd, newLine, adrRowKey), appended: true };
};

// Issue #941 leg 2: passive, exported structural-violation check — mirrors
// decision-log-append.ts's findRecordsTableViolations (issue #940), applied to any pipe table
// findTableBlock can locate rather than one file's specific Records schema. Schema-agnostic
// ("row found past the block" is the same signature for the INDEX.md 5-column schema and the
// vcodes 4-column schema, V-DRY-01) and deliberately does not modify findTableBlock itself — see
// the invariance pin in check-common.test.ts's findTableBlock describe block. Never wired into
// any write path (same judgment #940 made and rejected for findRecordsTableViolations): the
// guard above (assertNoEmbeddedNewline) is what prevents new corruption; this is what proves a
// table is currently well-formed, exercised only by bun test.
//
// Deliberately more permissive than findRecordsTableViolations: an ordinary non-blank,
// non-`|`-prefixed line after the block end (e.g. blackhole-vcodes.md's trailing
// "**BLOCK** = ..." / "**WARN** = ..." legend prose) is not a violation and does not stop the
// scan — only a resumed `|`-prefixed line is the tell-tale signature of an orphaned row
// continuation. Residual, explicitly out of scope: a split on a table's last row produces no
// further `|`-prefixed line and is therefore undetectable by this signature — the same class of
// blind spot #940 accepted for findRecordsTableViolations.
export const findPipeTableViolations = (content: string): string[] => {
  const lines = content.split('\n');
  const { separatorIdx, blockEnd } = findTableBlock(lines);
  if (separatorIdx === -1) return [];

  const violations: string[] = [];
  for (let i = blockEnd; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.trim().startsWith('|')) {
      violations.push(
        `line ${i + 1}: pipe-table row found after the table's detected block end (line ${blockEnd}) — likely an orphaned continuation of a row split by an embedded newline: ${line}`,
      );
    }
  }
  return violations;
};

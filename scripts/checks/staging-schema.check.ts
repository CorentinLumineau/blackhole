import { read, type CheckResult } from './check-utils.ts';

// Issue #482: pins the ADR-021 D1 durable-artifact staging contract —
// `.blackhole/staged/<issue>/manifest.json`'s field names and enum values, documented in
// `src/references/blackhole-state.md` § Staging — against silent drift between its two in-repo
// normative surfaces: the doc's own JSON example + field table (V-STAGE-01), and the
// `planner`/`investigator` producer prompts' literal `field: value` declarations (V-STAGE-02).
//
// Local table parser (not `check-common.ts`'s `parseIndexTableRows`/`parseVcodeTableRows`):
// neither shared parser fits — both split naively on `line.split('|')`, which would shred this
// table's Values-column escaped pipes (`` \| ``, separating enum alternatives) into extra cells.
// This parser splits on a pipe *not* preceded by a backslash instead, and has exactly one caller
// today, so it stays local per the plan's YAGNI judgment rather than joining check-common.ts for
// a single consumer (see `.blackhole/plans/issue-482.md` § Verified prerequisite state for the
// full shared-parser search this decision is based on).

const blackholeStateDoc = 'src/references/blackhole-state.md';
const plannerDoc = 'src/agents/planner.md';
const investigatorDoc = 'src/agents/investigator.md';

export type ManifestFieldRow = { field: string; enumValues: string[] | null };

// Row parser, scoped to the `| Field | Values | Notes |` table: `blackhole-state.md` carries a
// second, unrelated `|`-table (§ Paths, 2-column, also backtick-wrapped file names) earlier in
// the same document — a whole-file scan would misparse its rows as manifest fields. Locate the
// `| Field | Values | Notes |` header line, then read contiguous `|`-leading lines after it
// (skipping the separator row) until the first non-`|` line ends the table. Within the table,
// split each line on a pipe not preceded by a backslash (Values-column `` \| `` enum separators
// survive intact); a row counts only if its Field cell starts with a backtick — this excludes
// the separator row (`---`, no backtick) without a second regex.
export const parseManifestFieldTable = (content: string): ManifestFieldRow[] => {
  const lines = content.split('\n');
  const headerIndex = lines.findIndex((l) => /^\s*\|\s*Field\s*\|\s*Values\s*\|\s*Notes\s*\|/i.test(l));
  if (headerIndex === -1) throw new Error('no `| Field | Values | Notes |` table header found');

  const rows: ManifestFieldRow[] = [];
  for (let i = headerIndex + 1; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
    const cells = lines[i].split(/(?<!\\)\|/).map((c) => c.trim());
    const fieldCell = cells[1];
    if (!fieldCell || !fieldCell.startsWith('`')) continue;
    const field = fieldCell.replace(/^`|`$/g, '');
    const valuesCell = cells[2] ?? '';
    const enumValues = valuesCell.includes('`')
      ? [...valuesCell.matchAll(/`([^`]+)`/g)].map((m) => m[1])
      : null;
    rows.push({ field, enumValues });
  }
  return rows;
};

// Locates the first fenced ```json block in `blackhole-state.md` (there is exactly one — the
// manifest example) and parses its contents.
// biome-ignore lint/suspicious/noExplicitAny: parsed shape is the doc's own free-form JSON example
export const extractManifestExampleJson = (content: string): any => {
  const match = content.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error('no fenced ```json block found in blackhole-state.md');
  return JSON.parse(match[1]);
};

// V-STAGE-01 leg 1: symmetric-difference field-name comparison (never a boolean — same
// "name what's wrong" idiom as ground-truth.check.ts's findRosterScanMismatch) between the
// example's declared field names (top-level keys minus `entries`, plus every `entries[]`
// object's own keys prefixed `entries[].`) and the field table's field names.
export const findManifestFieldNameMismatch = (
  // biome-ignore lint/suspicious/noExplicitAny: parsed shape is the doc's own free-form JSON example
  example: any,
  tableFieldNames: string[],
): string | null => {
  const exampleFieldNames = new Set<string>();
  for (const key of Object.keys(example)) {
    if (key === 'entries') continue;
    exampleFieldNames.add(key);
  }
  for (const entry of example.entries ?? []) {
    for (const key of Object.keys(entry)) {
      exampleFieldNames.add(`entries[].${key}`);
    }
  }

  const table = new Set(tableFieldNames);
  const missing = [...exampleFieldNames].filter((f) => !table.has(f)).sort();
  const extra = tableFieldNames.filter((f) => !exampleFieldNames.has(f)).sort();
  if (missing.length === 0 && extra.length === 0) return null;

  const parts: string[] = [];
  if (missing.length) parts.push(`example declares fields absent from the table [${missing.join(', ')}]`);
  if (extra.length) parts.push(`table declares fields absent from the example [${extra.join(', ')}]`);
  return parts.join(', ');
};

// V-STAGE-01 leg 2: for every `entries[i]` object and every field with a non-null enum in the
// table, assert the example's literal value (including the literal JSON `null` for `sub_mode`,
// matched against the table's `null` token) is a member of that field's enum array.
export const findManifestExampleEnumViolations = (
  // biome-ignore lint/suspicious/noExplicitAny: parsed shape is the doc's own free-form JSON example
  example: any,
  rows: ManifestFieldRow[],
): string[] => {
  const violations: string[] = [];
  const enumByField = new Map(rows.filter((r) => r.enumValues !== null).map((r) => [r.field, r.enumValues as string[]]));

  (example.entries ?? []).forEach((entry: Record<string, unknown>, i: number) => {
    for (const [key, rawValue] of Object.entries(entry)) {
      const field = `entries[].${key}`;
      const enumValues = enumByField.get(field);
      if (!enumValues) continue;
      const value = rawValue === null ? 'null' : String(rawValue);
      if (!enumValues.includes(value)) {
        violations.push(`entries[${i}].${key}="${value}" not in table enum for ${field} {${enumValues.join(', ')}}`);
      }
    }
  });
  return violations;
};

const checkManifestSelfConsistency = (): CheckResult => {
  const content = read(blackholeStateDoc);
  const rows = parseManifestFieldTable(content);
  const example = extractManifestExampleJson(content);

  const nameMismatch = findManifestFieldNameMismatch(example, rows.map((r) => r.field));
  const enumViolations = findManifestExampleEnumViolations(example, rows);

  const errors = [...(nameMismatch ? [nameMismatch] : []), ...enumViolations];
  if (errors.length) return { id: 'V-STAGE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-STAGE-01', ok: true };
};

export type ProducerLiteral = { field: string; value: string; source: string };

// Extracts every `` `field: "value"` `` (or unquoted `` `field: value` ``) literal from a
// producer prompt's whole file content as one string — not line-by-line, since `\s` must be
// free to match a hard-wrapped newline inside a single backtick span (confirmed against
// planner.md's `produced_by: "planner"` span, which straddles a line break in source).
const PRODUCER_LITERAL_RE = /`(route|sub_mode|produced_by|target_kind):\s*"?([A-Za-z_]+|null)"?`/g;

export const extractProducerFieldValueLiterals = (content: string): { field: string; value: string }[] =>
  [...content.matchAll(PRODUCER_LITERAL_RE)].map((m) => ({ field: m[1], value: m[2] }));

// V-STAGE-02: for every extracted producer literal, assert it is a member of the corresponding
// `entries[].<field>` enum from the table.
export const findProducerEnumViolations = (literals: ProducerLiteral[], rows: ManifestFieldRow[]): string[] => {
  const violations: string[] = [];
  const enumByField = new Map(rows.filter((r) => r.enumValues !== null).map((r) => [r.field, r.enumValues as string[]]));

  for (const { field, value, source } of literals) {
    const enumValues = enumByField.get(`entries[].${field}`);
    if (!enumValues) continue;
    if (!enumValues.includes(value)) {
      violations.push(`${source}: \`${field}: ${value}\` not in table enum {${enumValues.join(', ')}}`);
    }
  }
  return violations;
};

const checkProducerConformance = (): CheckResult => {
  const rows = parseManifestFieldTable(read(blackholeStateDoc));
  const literals: ProducerLiteral[] = [
    ...extractProducerFieldValueLiterals(read(plannerDoc)).map((l) => ({ ...l, source: plannerDoc })),
    ...extractProducerFieldValueLiterals(read(investigatorDoc)).map((l) => ({ ...l, source: investigatorDoc })),
  ];

  const violations = findProducerEnumViolations(literals, rows);
  if (violations.length) return { id: 'V-STAGE-02', ok: false, detail: violations.join('; ') };
  return { id: 'V-STAGE-02', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see adr-status.check.ts's runChecks doc comment for the
// shared contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkManifestSelfConsistency(), checkProducerConformance()];

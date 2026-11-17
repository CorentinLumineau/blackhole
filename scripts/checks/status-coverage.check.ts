import { read, type CheckResult } from './check-utils.ts';
import { parseConfigTemplateKeys } from './config-registration.check.ts';
import { STATUS_DATASET_IDS } from '../lib/campaign-status/data.ts';
import { buildConfigRows } from '../lib/campaign-status/overview.ts';
import { RUN_ROW_KEYS } from '../lib/campaign-status/run-state.ts';

// V-CONFIG-03: every top-level block registered in config-template.md's field table declares,
// in its `## Status page coverage` table, the status dataset that shows it — or `none` with a
// reason. A run feature that adds config cannot ship invisible on the status page: removing a
// row, naming a dataset the plugin does not write, a row the dataset does not emit, or a dataset
// no template panel draws all fail verify.

export const COVERAGE_HEADING = '## Status page coverage';
const NONE = 'none';

export type CoverageRow = { block: string; dataset: string; row: string | null; reason: string };

const cell = (c: string | undefined): string => (c ?? '').trim().replace(/^`+|`+$/g, '').trim();

/** The rows of the `| Block | Status page | Row | Reason |` table under `COVERAGE_HEADING`. */
export const parseCoverageTable = (doc: string): CoverageRow[] => {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === COVERAGE_HEADING);
  if (start < 0) return [];
  const rows: CoverageRow[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|') || /^\|[-| ]+\|$/.test(line.trim()) || /^\|\s*Block\s*\|/.test(line)) continue;
    const cols = line.split('|').slice(1, -1);
    const row = cell(cols[2]);
    rows.push({ block: cell(cols[0]), dataset: cell(cols[1]), row: row && row !== '—' ? row : null, reason: cell(cols[3]) });
  }
  return rows;
};

/** Top-level config blocks: the first segment of every registered field. */
export const registeredBlocks = (templateKeys: Set<string>): string[] => [...new Set([...templateKeys].map((k) => k.split('.')[0]))];

/** Row keys of the key/value datasets whose rows are always emitted, so a declared row can be checked. */
export const PANEL_ROW_KEYS: Record<string, readonly string[]> = {
  config: buildConfigRows({}, null).map((r) => r.key),
  run: RUN_ROW_KEYS,
};

/** Datasets the status-page template draws (`data-source="<id>"`). */
export const templateDatasets = (template: string): Set<string> =>
  new Set([...template.matchAll(/data-source="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));

const rowGaps = (r: CoverageRow, drawn: Set<string>): string[] => {
  if (r.dataset === NONE) return r.reason ? [] : [`${r.block}: status page none needs a reason`];
  if (!(STATUS_DATASET_IDS as readonly string[]).includes(r.dataset)) return [`${r.block}: "${r.dataset}" is not a status dataset (STATUS_DATASET_IDS)`];
  const gaps: string[] = [];
  if (!drawn.has(r.dataset)) gaps.push(`${r.block}: dataset "${r.dataset}" is drawn by no panel of templates/status-dashboard/index.html`);
  const keys = PANEL_ROW_KEYS[r.dataset];
  if (r.row && keys && !keys.includes(r.row)) gaps.push(`${r.block}: "${r.row}" is not a row of the ${r.dataset} dataset (${keys.join(', ')})`);
  return gaps;
};

export const findStatusCoverageGaps = (configTemplate: string, template: string): string[] => {
  const blocks = registeredBlocks(parseConfigTemplateKeys(configTemplate));
  const rows = parseCoverageTable(configTemplate);
  const drawn = templateDatasets(template);
  const gaps: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.block)) gaps.push(`${r.block}: listed twice in ${COVERAGE_HEADING}`);
    seen.add(r.block);
    if (!blocks.includes(r.block)) gaps.push(`${r.block}: listed in ${COVERAGE_HEADING} but registered in no field row`);
    gaps.push(...rowGaps(r, drawn));
  }
  for (const b of blocks) if (!seen.has(b)) gaps.push(`${b}: registered in config-template.md but declares no status dataset or none (${COVERAGE_HEADING})`);
  return gaps;
};

export const checkStatusCoverage = (): CheckResult => {
  const gaps = findStatusCoverageGaps(read('src/references/config-template.md'), read('templates/status-dashboard/index.html'));
  return gaps.length ? { id: 'V-CONFIG-03', ok: false, detail: gaps.join('; ') } : { id: 'V-CONFIG-03', ok: true };
};

// Domain entrypoint: see agents.check.ts's runChecks doc comment for the shared contract.
export const runChecks = (): CheckResult[] => [checkStatusCoverage()];

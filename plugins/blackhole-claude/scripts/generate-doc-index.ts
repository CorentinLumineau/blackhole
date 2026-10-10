#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { buildDocIndexRows, renderDocIndexTable, renderFullIndexFile } from './lib/doc-index-generate.ts';
import { root } from './checks/check-utils.ts';

// Issue #811 (ADR-031 Phase 1, Task 6) — thin CLI wrapper over doc-index-generate.ts. Default
// invocation prints the full generated markdown table (header + separator + rendered rows) to
// stdout. `--check` diffs the generated table's row block against the committed
// documentation/INDEX.md's row block and exits 1 on mismatch, 0 on match — a standalone manual
// tool, distinct from `bun run verify`'s own V-DOCHEALTH-01/02/04 gate (doc-health.check.ts,
// glob-discovered independently). Issue #832 (ADR-031 Phase 2, Task 5) hoisted the
// table-rendering logic into doc-index-generate.ts's `renderFullIndexFile` — this file's own
// local `renderFullTable`/`HEADER` retired in favor of it.

const DOCS_DIR = path.join(root, 'documentation');
const INDEX_PATH = path.join(DOCS_DIR, 'INDEX.md');

function runCheck(): number {
  const generated = renderDocIndexTable(buildDocIndexRows(DOCS_DIR));
  const committed = fs.readFileSync(INDEX_PATH, 'utf-8');
  // Extract the committed file's row block (everything between the header separator line and
  // the next non-`|`-prefixed line), so the diff compares row content only — not surrounding
  // prose/title, which the generator's output never includes.
  const lines = committed.split('\n');
  const separatorIdx = lines.findIndex((l) => /^\|\s*-+\s*\|/.test(l.trim()));
  const rowLines: string[] = [];
  if (separatorIdx !== -1) {
    for (let i = separatorIdx + 1; i < lines.length && lines[i]!.trim().startsWith('|'); i++) {
      rowLines.push(lines[i]!);
    }
  }
  const committedRowBlock = rowLines.join('\n');

  if (generated === committedRowBlock) {
    process.stdout.write('generate-doc-index --check: OK — generated output matches committed documentation/INDEX.md\n');
    return 0;
  }

  process.stdout.write('generate-doc-index --check: MISMATCH\n');
  process.stdout.write('--- committed ---\n');
  process.stdout.write(`${committedRowBlock}\n`);
  process.stdout.write('--- generated ---\n');
  process.stdout.write(`${generated}\n`);
  return 1;
}

function main(): void {
  if (process.argv.includes('--check')) {
    process.exit(runCheck());
  }
  process.stdout.write(renderFullIndexFile(DOCS_DIR));
}

if (import.meta.main) {
  main();
}

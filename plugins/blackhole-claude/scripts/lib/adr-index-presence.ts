import * as fs from 'fs';
import * as path from 'path';

// An ADR file counts as indexed only when a table line (starts with `|`) carries its `ADR-\d+`
// token in the first cell, whatever the rendering (bare id, link, filename) — the same
// discriminator `appendAdrIndexRowIfAbsent` dedups on. Prose mentions never count. Absent
// `decisions/` or its INDEX.md yields [] (existence-gated, like the other index checks).
const ADR_ID = /ADR-\d+/;
const ADR_FILE = /^ADR-\d+-.*\.md$/;

export const findAdrsMissingIndexRow = (docsDir: string): string[] => {
  const decisionsDir = path.join(docsDir, 'decisions');
  const indexAbs = path.join(decisionsDir, 'INDEX.md');
  if (!fs.existsSync(decisionsDir) || !fs.existsSync(indexAbs)) return [];
  const indexed = new Set<string>();
  for (const line of fs.readFileSync(indexAbs, 'utf-8').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const id = line.split('|')[1]?.match(ADR_ID)?.[0];
    if (id) indexed.add(id);
  }
  return fs
    .readdirSync(decisionsDir)
    .filter((f) => ADR_FILE.test(f) && !indexed.has(f.match(ADR_ID)![0]))
    .sort();
};

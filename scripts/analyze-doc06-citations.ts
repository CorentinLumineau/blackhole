#!/usr/bin/env bun
import * as path from 'path';
import { scanDirsForCitations } from './lib/doc06-citation-scan.ts';
import { root } from './checks/check-utils.ts';

// One-off (and future re-runnable) measurement of how many `scripts/**`/`src/**`
// `.ts`/`.js` comment lines cite an issue/PR number, so a V-DOC-06 boundary decision is made
// from a real count rather than a manual grep estimate. `.md` is never walked — boundary (3) of
// V-DOC-06 already exempts markdown prose.

function main(): void {
  const findings = scanDirsForCitations([path.join(root, 'scripts'), path.join(root, 'src')]);
  const sorted = [...findings].sort((a, b) => b.count - a.count);
  for (const { file, count } of sorted) {
    console.log(`${count}\t${path.relative(root, file)}`);
  }
  const totalCitations = findings.reduce((sum, f) => sum + f.count, 0);
  console.log(`Total files: ${findings.length}`);
  console.log(`Total citing comment lines: ${totalCitations}`);
}

if (import.meta.main) {
  main();
}

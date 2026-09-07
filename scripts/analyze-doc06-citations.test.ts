import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as path from 'path';

// CLI smoke test — same pattern as scripts/merge-base-guard.test.ts / scripts/decision-log-append.test.ts:
// spawnSync the real script against the live repo tree and assert on exit code + summary lines,
// rather than re-deriving the report format from scanDirsForCitations directly (that coverage
// already lives in scripts/lib/doc06-citation-scan.test.ts).

const repoRoot = path.resolve(import.meta.dirname);
const scriptPath = path.join(repoRoot, 'analyze-doc06-citations.ts');

describe('analyze-doc06-citations CLI', () => {
  test('exits 0 and prints both summary lines', () => {
    const result = spawnSync('bun', ['run', '--cwd', repoRoot, scriptPath], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Total files: \d+/);
    expect(result.stdout).toMatch(/Total citing comment lines: \d+/);
  });
});

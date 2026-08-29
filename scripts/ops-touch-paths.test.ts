import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { touchPathsHitOpsSurface } from './lib/ops-touch-paths.ts';

const root = path.resolve(import.meta.dirname, '..');

describe('ops touch-path heuristic (#689)', () => {
  test('detects .devlocal and workflow touch paths', () => {
    expect(touchPathsHitOpsSurface(['src/foo.ts'])).toBe(false);
    expect(touchPathsHitOpsSurface(['.devlocal/**'])).toBe(true);
    expect(touchPathsHitOpsSurface(['.github/workflows/ci.yml'])).toBe(true);
    expect(touchPathsHitOpsSurface(['scripts/ci-pipeline.sh'])).toBe(true);
  });

  test('fixture manifest stages runbook entry for ops issue', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/staging/runbook-manifest.json'), 'utf-8'),
    );
    const runbook = manifest.entries.find((e: { route: string }) => e.route === 'runbook');
    expect(runbook?.target_path).toMatch(/^documentation\/runbooks\//);
  });
});

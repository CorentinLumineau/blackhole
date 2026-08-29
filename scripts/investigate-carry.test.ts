import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(import.meta.dirname, '..');

function manifestHasInvestigateRoute(manifest: { entries?: Array<{ route?: string }> }): boolean {
  return (manifest.entries ?? []).some((entry) => entry.route === 'investigate' || entry.route === 'analyze');
}

describe('investigate/analyze staging (#690)', () => {
  test('fixture manifest declares investigate durable targets', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/staging/investigate-manifest.json'), 'utf-8'),
    );
    expect(manifestHasInvestigateRoute(manifest)).toBe(true);
    const investigation = manifest.entries.find(
      (e: { route: string; target_kind: string }) => e.route === 'investigate' && e.target_kind === 'new_file',
    );
    expect(investigation?.target_path).toMatch(/^documentation\/investigations\//);
  });
});

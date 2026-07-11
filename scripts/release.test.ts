import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { findManifestVersionMismatches, MANIFEST_PATHS } from './release.ts';

describe('findManifestVersionMismatches', () => {
  test('returns [] when package.json and all 5 manifests share the same version', () => {
    const manifests: Record<string, unknown> = {};
    for (const { path } of MANIFEST_PATHS) {
      manifests[path] = { version: '0.8.0' };
    }
    // marketplace.json has no top-level version — nest it under plugins[0] instead.
    manifests['.claude-plugin/marketplace.json'] = { plugins: [{ version: '0.8.0' }] };

    expect(findManifestVersionMismatches('0.8.0', manifests)).toEqual([]);
  });

  test('regression shape: one stale manifest (.codex-plugin/plugin.json) is detected while the other 4 match', () => {
    const manifests: Record<string, unknown> = {};
    for (const { path } of MANIFEST_PATHS) {
      manifests[path] = { version: '0.4.2' };
    }
    manifests['.claude-plugin/marketplace.json'] = { plugins: [{ version: '0.4.2' }] };
    manifests['.codex-plugin/plugin.json'] = { version: '0.4.1' };

    expect(findManifestVersionMismatches('0.4.2', manifests)).toEqual(['.codex-plugin/plugin.json']);
  });

  test('reads marketplace.json version from the nested plugins[0].version field, not a top-level version', () => {
    const manifests: Record<string, unknown> = {};
    for (const { path } of MANIFEST_PATHS) {
      manifests[path] = { version: '1.0.0' };
    }
    // Top-level version field present but wrong shape for this file — must be ignored in favor
    // of plugins[0].version, and a stale nested version must still be caught.
    manifests['.claude-plugin/marketplace.json'] = { version: '1.0.0', plugins: [{ version: '0.9.0' }] };

    expect(findManifestVersionMismatches('1.0.0', manifests)).toEqual(['.claude-plugin/marketplace.json']);
  });
});

// ADR-007 T2 (R5′) regression: `release.ts`'s build() step must invoke plain `bun run build` —
// tracked ⇒ built by default means the release CLI no longer needs (or should pass) `--all` to
// regenerate every git-tracked target. `build()` isn't exported (it just wraps a single
// execSync call with no branching logic worth unit-testing in isolation), so this reads the
// source text directly — the same pattern this repo's other regression tests use for asserting
// invariants about literal command strings.
describe("release.ts's build() step (ADR-007 T2/R5′)", () => {
  test('invokes plain `bun run build`, never a --all/--gemini/--no-codex flag', () => {
    const releaseSrc = fs.readFileSync(path.join(import.meta.dirname, 'release.ts'), 'utf-8');
    expect(releaseSrc).toContain("execSync('bun run build', { cwd: root, stdio: 'inherit' });");
    expect(releaseSrc).not.toMatch(/bun run build --all/);
    expect(releaseSrc).not.toMatch(/bun run build --gemini/);
    expect(releaseSrc).not.toMatch(/bun run build --no-codex/);
  });
});

import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR } from './lib/test-fixtures.ts';
import { withTempDir } from './lib/test-fixtures.ts';

// This module covers two shipped CommonJS helpers under
// templates/hooks/pretooluse/utils/:
//
//   - installed-plugin-rows.js: selectCandidateInstalledPluginRows + extractCommandPath —
//     dual-consumed by sibling-plugin-guard.js and scripts/lib/hook-sources.ts.
//   - sibling-plugin-health.js: isPluginHealthy(installPath) — its own docstring carries the
//     canonical scope statement for what the health check does and does not detect.

const installedPluginRows = () =>
  require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'installed-plugin-rows.js'));

const siblingPluginHealth = () =>
  require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'sibling-plugin-health.js'));

// --- selectCandidateInstalledPluginRows ---------------------------------------------------

describe('installed-plugin-rows.js — selectCandidateInstalledPluginRows', () => {
  test('returns a user-scope row unconditionally', () => {
    const { selectCandidateInstalledPluginRows } = installedPluginRows();
    const rows = [{ scope: 'user', installPath: '/a' }];
    expect(selectCandidateInstalledPluginRows(rows, '/repo')).toEqual(rows);
  });

  test('returns a project-scope row only when projectPath matches repoRoot', () => {
    const { selectCandidateInstalledPluginRows } = installedPluginRows();
    const matching = { scope: 'project', projectPath: '/repo', installPath: '/a' };
    const nonMatching = { scope: 'project', projectPath: '/other', installPath: '/b' };
    expect(selectCandidateInstalledPluginRows([matching, nonMatching], '/repo')).toEqual([matching]);
  });

  test('multi-row: a user-scope row and a non-matching project-scope row both filtered correctly (constraint 4)', () => {
    const { selectCandidateInstalledPluginRows } = installedPluginRows();
    const userRow = { scope: 'user', installPath: '/user-install' };
    const projectRowMismatch = { scope: 'project', projectPath: '/somewhere-else', installPath: '/project-install' };
    const result = selectCandidateInstalledPluginRows([userRow, projectRowMismatch], '/repo');
    expect(result).toEqual([userRow]);
  });

  test('non-array input returns an empty array rather than throwing', () => {
    const { selectCandidateInstalledPluginRows } = installedPluginRows();
    expect(selectCandidateInstalledPluginRows(undefined, '/repo')).toEqual([]);
    expect(selectCandidateInstalledPluginRows(null, '/repo')).toEqual([]);
  });
});

// --- extractCommandPath --------------------------------------------------------------------

describe('installed-plugin-rows.js — extractCommandPath', () => {
  test.each(['sh', 'js', 'ts', 'mjs'])('extracts a quoted %s path', (ext) => {
    const { extractCommandPath } = installedPluginRows();
    const command = `bun run '/install/hooks/validate.${ext}'`;
    expect(extractCommandPath(command)).toBe(`/install/hooks/validate.${ext}`);
  });

  test.each(['sh', 'js', 'ts', 'mjs'])('extracts a bare %s path', (ext) => {
    const { extractCommandPath } = installedPluginRows();
    const command = `bun run /install/hooks/validate.${ext}`;
    expect(extractCommandPath(command)).toBe(`/install/hooks/validate.${ext}`);
  });

  test('returns null when no path can be extracted', () => {
    const { extractCommandPath } = installedPluginRows();
    expect(extractCommandPath('echo hello')).toBeNull();
  });

  test('self-test: resolves blackhole\'s own compiled plugins/blackhole-claude/hooks/hooks.json commands (Execution Strategy gate)', () => {
    const { extractCommandPath } = installedPluginRows();
    const manifestPath = path.join(PRETOOLUSE_HOOKS_DIR, '..', '..', '..', 'plugins', 'blackhole-claude', 'hooks', 'hooks.json');
    if (!fs.existsSync(manifestPath)) return; // covered by the dist tree only after a build; skip if absent
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const entries = manifest.hooks.PreToolUse;
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      for (const h of entry.hooks) {
        expect(extractCommandPath(h.command)).not.toBeNull();
      }
    }
  });
});

// --- isPluginHealthy -------------------------------------------------------------------------

const writeHooksJson = (installPath: string, manifest: unknown) => {
  const hooksDir = path.join(installPath, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, 'hooks.json'), JSON.stringify(manifest), 'utf-8');
};

const healthyManifest = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'bun run ${CLAUDE_PLUGIN_ROOT}/hooks/validate-bash-command.js' }],
      },
    ],
  },
};

describe('sibling-plugin-health.js — isPluginHealthy (fail-closed matrix)', () => {
  test('(a) installPath missing/non-string -> false', () => {
    const { isPluginHealthy } = siblingPluginHealth();
    expect(isPluginHealthy(undefined)).toBe(false);
    expect(isPluginHealthy(null)).toBe(false);
    expect(isPluginHealthy(42)).toBe(false);
    expect(isPluginHealthy('')).toBe(false);
  });

  test('(b) <installPath>/hooks/hooks.json absent -> false', () => {
    const { isPluginHealthy } = siblingPluginHealth();
    withTempDir('sibling-health-b', (dir) => {
      expect(isPluginHealthy(dir)).toBe(false);
    });
  });

  test('(c) hooks.json present but malformed JSON -> false', () => {
    const { isPluginHealthy } = siblingPluginHealth();
    withTempDir('sibling-health-c', (dir) => {
      const hooksDir = path.join(dir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      fs.writeFileSync(path.join(hooksDir, 'hooks.json'), '{ not json', 'utf-8');
      expect(isPluginHealthy(dir)).toBe(false);
    });
  });

  test('(d) hooks.json parses but hooks.PreToolUse is absent or empty -> false', () => {
    const { isPluginHealthy } = siblingPluginHealth();
    withTempDir('sibling-health-d-absent', (dir) => {
      writeHooksJson(dir, { hooks: {} });
      expect(isPluginHealthy(dir)).toBe(false);
    });
    withTempDir('sibling-health-d-empty', (dir) => {
      writeHooksJson(dir, { hooks: { PreToolUse: [] } });
      expect(isPluginHealthy(dir)).toBe(false);
    });
  });

  test('(e) a PreToolUse entry command does not yield an extractable script path -> false', () => {
    const { isPluginHealthy } = siblingPluginHealth();
    withTempDir('sibling-health-e', (dir) => {
      writeHooksJson(dir, {
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hello' }] }] },
      });
      expect(isPluginHealthy(dir)).toBe(false);
    });
  });

  test('(f) resolved script path does not exist on disk -> false', () => {
    const { isPluginHealthy } = siblingPluginHealth();
    withTempDir('sibling-health-f', (dir) => {
      writeHooksJson(dir, healthyManifest);
      // no script file written under hooks/
      expect(isPluginHealthy(dir)).toBe(false);
    });
  });

  test('(g) resolved script exists but is zero bytes -> false', () => {
    const { isPluginHealthy } = siblingPluginHealth();
    withTempDir('sibling-health-g', (dir) => {
      writeHooksJson(dir, healthyManifest);
      fs.writeFileSync(path.join(dir, 'hooks', 'validate-bash-command.js'), '', 'utf-8');
      expect(isPluginHealthy(dir)).toBe(false);
    });
  });

  test('(h) every resolved script exists and is non-empty -> true', () => {
    const { isPluginHealthy } = siblingPluginHealth();
    withTempDir('sibling-health-h', (dir) => {
      writeHooksJson(dir, healthyManifest);
      fs.writeFileSync(path.join(dir, 'hooks', 'validate-bash-command.js'), '// non-empty stub\n', 'utf-8');
      expect(isPluginHealthy(dir)).toBe(true);
    });
  });
});

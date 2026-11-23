import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir } from '../test-fixtures.ts';
import {
  assertFailOpenRecord,
  bashCommand,
  hookEventFiles,
  pathWithoutJq,
  resolveSelfContained,
  runWrapperWithStubExit,
} from './claude-native-settings.fixtures.ts';

describe('fail-open record does not depend on jq', () => {
  test('crashing validator with no jq on PATH: exits 0 and still writes a parseable record, no empty file', () => {
    withTempDir('blackhole-claude-wrapper-', (dir) => {
      const binDir = pathWithoutJq(path.join(dir, '.test-bin'));
      const { exitCode, stderr } = runWrapperWithStubExit(dir, 1, bashCommand(), 'validate-bash-command.js', {
        PATH: binDir,
      });
      expect(exitCode).toBe(0);
      const eventsDir = path.join(dir, '.blackhole', 'hook-events');
      const files = fs.readdirSync(eventsDir);
      expect(files).toHaveLength(1);
      for (const f of files) {
        expect(fs.statSync(path.join(eventsDir, f)).size).toBeGreaterThan(0);
      }
      assertFailOpenRecord(dir, hookEventFiles(dir), 'validate-bash-command', 'Bash');
      expect(stderr).not.toMatch(/NOT written/);
    });
  });

  test('record generation failing: no 0-byte record left and stderr says "record NOT written"', () => {
    withTempDir('blackhole-claude-wrapper-', (dir) => {
      // Break `bun -e` generation only: the validator stub is run via `bun run`, which still works.
      const binDir = pathWithoutJq(path.join(dir, '.test-bin'));
      fs.rmSync(path.join(binDir, 'bun'));
      fs.writeFileSync(
        path.join(binDir, 'bun'),
        `#!/bin/sh\nif [ "$1" = "run" ]; then exit 1; fi\nexit 3\n`,
        { mode: 0o755 },
      );
      const { exitCode, stderr } = runWrapperWithStubExit(dir, 1, bashCommand(), 'validate-bash-command.js', {
        PATH: binDir,
      });
      expect(exitCode).toBe(0);
      const eventsDir = path.join(dir, '.blackhole', 'hook-events');
      expect(fs.readdirSync(eventsDir)).toEqual([]);
      expect(stderr).toMatch(/record NOT written/);
    });
  });
});

describe('pathWithoutJq tool resolution', () => {
  test('skips a #! shim that re-dispatches by PATH lookup and links the next self-contained binary', () => {
    withTempDir('blackhole-claude-wrapper-', (dir) => {
      const shimDir = path.join(dir, 'shim');
      const realDir = path.join(dir, 'real');
      fs.mkdirSync(shimDir);
      fs.mkdirSync(realDir);
      fs.writeFileSync(path.join(shimDir, 'rm'), '#!/bin/sh\nexec rm "$@"\n', { mode: 0o755 });
      fs.copyFileSync(fs.realpathSync(Bun.which('cat') as string), path.join(realDir, 'rm'));
      fs.chmodSync(path.join(realDir, 'rm'), 0o755);
      expect(resolveSelfContained('rm', `${shimDir}:${realDir}`)).toBe(path.join(realDir, 'rm'));
    });
  });

  test('falls back to the first PATH hit when no self-contained candidate exists', () => {
    withTempDir('blackhole-claude-wrapper-', (dir) => {
      fs.writeFileSync(path.join(dir, 'tool'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      expect(resolveSelfContained('tool', dir)).toBe(path.join(dir, 'tool'));
    });
  });
});

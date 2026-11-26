import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  expectLinearTime,
  populateClaudeFixtureTree,
  populateCodexFixtureTree,
  populateGeminiDistributionTree,
  runGit,
  withLinkedWorktree,
  withTempDir,
} from './test-fixtures.ts';

describe('withTempDir', () => {
  test('removes the directory after the callback returns', () => {
    let capturedDir = '';
    withTempDir('test-fixtures-with-temp', (dir) => {
      capturedDir = dir;
      expect(fs.existsSync(dir)).toBe(true);
    });
    expect(fs.existsSync(capturedDir)).toBe(false);
  });
});

describe('populateGeminiDistributionTree', () => {
  test('populates plugin.json at the distribution root', () => {
    withTempDir('test-fixtures-gemini', (destRoot) => {
      populateGeminiDistributionTree(destRoot);
      const manifestPath = path.join(destRoot, 'plugin.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest).toHaveProperty('name');
      expect(manifest).toHaveProperty('version');
    });
  });
});

describe('populateCodexFixtureTree', () => {
  test('populates .codex-plugin/plugin.json', () => {
    withTempDir('test-fixtures-codex', (destRoot) => {
      populateCodexFixtureTree(destRoot);
      const manifestPath = path.join(destRoot, '.codex-plugin', 'plugin.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest).toHaveProperty('name');
    });
  });
});

describe('populateClaudeFixtureTree', () => {
  test('populates .claude-plugin/plugin.json and agents/', () => {
    withTempDir('test-fixtures-claude', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      expect(fs.existsSync(path.join(destRoot, '.claude-plugin', 'plugin.json'))).toBe(true);
      expect(fs.existsSync(path.join(destRoot, 'agents'))).toBe(true);
    });
  });
});

// #756/#747: every git call in this file's fixtures used to run unchecked — a failed `git
// commit`/`worktree add` left the fixture proceeding against a repo that wasn't in the state the
// test believed, and the real cause surfaced as an unrelated downstream failure instead of a git
// error. `runGit` closes that gap for setup/action calls.
describe('runGit', () => {
  test('throws naming the subcommand and captured stderr when cwd is not a git repository', () => {
    withTempDir('test-fixtures-rungit-norepo', (dir) => {
      expect(() => runGit(dir, ['commit', '--allow-empty', '-m', 'x'])).toThrow(
        /git commit.*not a git repository/s,
      );
    });
  });

  test('throws naming the subcommand and the spawn error when cwd does not exist on disk', () => {
    const missing = path.join(os.tmpdir(), `test-fixtures-rungit-missing-${Date.now()}`);
    expect(() => runGit(missing, ['status'])).toThrow(/git status.*ENOENT/s);
  });
});

// Discriminating mutation-check (#756 AC): a silent git failure inside a fixture must surface
// immediately as a git-attributed rejection, not cascade into an unrelated failure downstream.
//
// The plan's originally-designed trigger — sandbox `process.env` to strip git identity so
// `git commit` fails with "Author identity unknown" — proved non-deterministic on this Bun
// version: `spawnSync` without an explicit `env` option reads a startup-time environment
// snapshot, not the live (mutated) `process.env`, so the sandboxed `HOME` never reaches the
// subprocess and git resolves the real ambient identity every time (verified: the sandboxed
// commit always succeeds). Falls back to the Execution Strategy's named alternative instead: a
// cwd outside a git repo (status 128), applied to `withLinkedWorktree`'s `worktree add` call by
// deleting `.git` between its setup steps.
describe('withLinkedWorktree — silent git failure surfaces immediately (#756/#747)', () => {
  test('a worktree-add failure rejects immediately instead of cascading into a realpath ENOENT', async () => {
    let caught: unknown;
    try {
      await withLinkedWorktree(
        'test-fixtures-worktree-fail-',
        async () => {
          throw new Error('fn should never run — worktree add must reject first');
        },
        (mainRepo) => {
          fs.rmSync(path.join(mainRepo, '.git'), { recursive: true, force: true });
          return path.join(mainRepo, '.worktrees');
        },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/git worktree add.*not a git repository/s);
  });
});

describe('expectLinearTime', () => {
  const spin = (iterations: number): number => {
    let acc = 0;
    for (let i = 0; i < iterations; i += 1) acc = (acc + i) | 0;
    return acc;
  };

  // Injected clock: `run` advances virtual time by a chosen cost, so the measured ratio is exact.
  // `cost(size, call)` receives the size and how many times that size has been run so far.
  const fakeClock = (cost: (size: number, call: number) => number) => {
    let t = 0;
    const calls = new Map<number, number>();
    return {
      now: () => t,
      run: (size: number) => {
        const call = (calls.get(size) ?? 0) + 1;
        calls.set(size, call);
        t += cost(size, call);
      },
      calls,
    };
  };
  const SMALL = 10;
  const LARGE = 40;
  const measure = (cost: (size: number, call: number) => number, extra: { maxRatio?: number } = {}) => {
    const clock = fakeClock(cost);
    const attempt = () =>
      expectLinearTime({ build: (size) => size, run: clock.run, n: SMALL, factor: 4, now: clock.now, ...extra });
    return { clock, attempt };
  };

  test('default limit is 12: ratio 11.9 passes, 12.1 throws', () => {
    expect(measure((size) => (size === SMALL ? 10 : 119)).attempt).not.toThrow();
    expect(measure((size) => (size === SMALL ? 10 : 121)).attempt).toThrow(/limit 12/);
  });

  test('ratio exactly at the limit fails', () => {
    expect(measure((size) => (size === SMALL ? 10 : 120)).attempt).toThrow(/limit 12/);
  });

  test('retry passes after a spiked first pair', () => {
    const runs = 5;
    const { clock, attempt } = measure((size, call) => (size === SMALL ? 10 : call <= runs + 1 ? 500 : 40));
    expect(attempt).not.toThrow();
    expect(clock.calls.get(LARGE)).toBe(2 * (runs + 1));
  });

  test('fails when both pairs spike', () => {
    expect(measure((size) => (size === SMALL ? 10 : 500)).attempt).toThrow(/retry .*limit 12/);
  });

  test('a sub-millisecond small run divides by the 1 ms floor', () => {
    expect(measure((size) => (size === SMALL ? 0.1 : 11)).attempt).not.toThrow();
  });

  test('a sub-millisecond small run still throws once the floor-divided ratio reaches the limit', () => {
    expect(measure((size) => (size === SMALL ? 0.1 : 13)).attempt).toThrow(/limit 12/);
  });

  test('a linear function passes with the injected clock', () => {
    expect(measure((size) => size).attempt).not.toThrow();
  });

  test('honours an explicit factor and ratio limit', () => {
    const clock = fakeClock((size) => size);
    expect(() =>
      expectLinearTime({ build: (size) => size, run: clock.run, n: SMALL, factor: 2, maxRatio: 1.5, now: clock.now }),
    ).toThrow(/size 10 -> 20 .*limit 1.5/);
  });

  // Wiring check: the real clock is the default, so a genuinely quadratic function is rejected.
  test('rejects a quadratic function with the real clock and reports a ratio far above the limit', () => {
    let message = '';
    try {
      expectLinearTime({ build: (size) => size, run: (size) => spin(size * size * 40_000), n: 10, factor: 8 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/not linear: size 10 -> 80 .*ratio \d+/);
    expect(Number(/ratio (\d+(?:\.\d+)?)/.exec(message)?.[1])).toBeGreaterThanOrEqual(24);
  });
});

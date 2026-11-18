import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildNotesMarkdown,
  CADENCE_THRESHOLD,
  classifyBatch,
  cleanPrTitle,
  createDefaultCadenceDeps,
  cutRelease,
  evaluateCadenceGate,
  headHasSkipRelease,
  parseCadenceArgs,
  releaseCommitPaths,
  selectBatch,
  SKIP_RELEASE_MARKER,
  verifySucceededOnSha,
  VERIFY_WORKFLOW_FILE,
  type CadenceDeps,
  type MergedPr,
  type VerifyRun,
} from './release-cadence.ts';
import { bumpPackageVersion, MANIFEST_PATHS } from './release.ts';
import { makeTempDir } from './lib/fs.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const WORKFLOW = path.join(repoRoot, '.github', 'workflows', 'release-cadence.yml');
const PUBLISHER = path.join(repoRoot, '.github', 'workflows', 'release.yml');
const CADENCE_SRC = path.join(repoRoot, 'scripts', 'release-cadence.ts');

class ProcessExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

function withExitMocked(run: () => void): void {
  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExitError(code);
  }) as never);
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    run();
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
}

function prs(count: number, opts: { featFirst?: boolean; start?: number } = {}): MergedPr[] {
  const start = opts.start ?? 1;
  return Array.from({ length: count }, (_, i) => ({
    number: start + i,
    title: opts.featFirst !== false && i === 0 ? `feat: cadence item ${i}` : `fix: cadence item ${i}`,
    body: '',
    mergedAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 60_000).toISOString(),
  }));
}

function greenVerify(): VerifyRun[] {
  return [{ status: 'completed', conclusion: 'success', created_at: '2026-01-02T00:00:00Z' }];
}

function redVerify(): VerifyRun[] {
  return [{ status: 'completed', conclusion: 'failure', created_at: '2026-01-02T00:00:00Z' }];
}

type MockState = {
  gitCalls: string[];
  notes: Map<string, string>;
  pkgVersion: string;
  tagged: string[];
  pushed: string[];
  built: boolean;
  localTags: Set<string>;
  remoteTags: Set<string>;
};

function makeDeps(overrides: {
  pending?: MergedPr[];
  latestTag?: string | null;
  tagDate?: string | null;
  verify?: VerifyRun[];
  head?: string;
  originMain?: string | null;
  skipSubject?: string;
  localTags?: string[];
  remoteTags?: string[];
  existingNotes?: string[];
}): { deps: CadenceDeps; state: MockState } {
  const state: MockState = {
    gitCalls: [],
    notes: new Map(),
    pkgVersion: '0.30.1',
    tagged: [],
    pushed: [],
    built: false,
    localTags: new Set(overrides.localTags ?? []),
    remoteTags: new Set(overrides.remoteTags ?? []),
  };
  for (const tag of overrides.existingNotes ?? []) state.notes.set(tag, 'existing');

  const pending = overrides.pending ?? prs(CADENCE_THRESHOLD);
  const head = overrides.head ?? 'abc'.repeat(13) + '0';
  const originMain = overrides.originMain === undefined ? head : overrides.originMain;

  const deps: CadenceDeps = {
    git: (cmd: string) => {
      state.gitCalls.push(cmd);
      if (cmd === 'git log -1 --format=%s') return overrides.skipSubject ?? 'feat: something';
      if (cmd.startsWith('git add') || cmd.startsWith('git commit') || cmd.startsWith('git config')) return '';
      throw new Error(`unexpected git command: ${cmd}`);
    },
    listMergedPrs: async () => pending,
    getLatestVTag: () => (overrides.latestTag === undefined ? 'v0.30.1' : overrides.latestTag),
    getTagDateIso: () => overrides.tagDate ?? '2025-12-01T00:00:00Z',
    listVerifyRuns: () => overrides.verify ?? greenVerify(),
    headSha: () => head,
    originMainSha: () => originMain,
    tagExists: (tag) => state.localTags.has(tag),
    remoteTagExists: (tag) => state.remoteTags.has(tag),
    readPkgVersion: () => state.pkgVersion,
    writePkgVersion: (version) => {
      state.pkgVersion = version;
    },
    writeNotes: (tag, markdown) => {
      state.notes.set(tag, markdown);
    },
    notesExist: (tag) => state.notes.has(tag),
    build: () => {
      state.built = true;
    },
    validateRelease: () => undefined,
    tagRelease: (tag) => {
      state.tagged.push(tag);
      state.localTags.add(tag);
    },
    pushRelease: (tag) => {
      state.pushed.push(tag);
    },
    repoUrl: () => 'https://github.com/CorentinLumineau/blackhole',
    configureGitIdentity: () => undefined,
  };
  return { deps, state };
}

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CADENCE_THRESHOLD SSOT', () => {
  test('the exported threshold is 20 and is the only cadence threshold literal', () => {
    expect(CADENCE_THRESHOLD).toBe(20);
    const src = fs.readFileSync(CADENCE_SRC, 'utf-8');
    expect(src).toMatch(/export const CADENCE_THRESHOLD = 20;/);
    expect(src).not.toMatch(/mergedPrCount\s*>=\s*20/);
    expect(src).not.toMatch(/threshold:\s*20/);
    expect(src).toContain('threshold: CADENCE_THRESHOLD');
    expect(src).toContain('selectBatch(anchor.prs, CADENCE_THRESHOLD)');
    const yaml = fs.readFileSync(WORKFLOW, 'utf-8');
    expect(yaml).not.toMatch(/N\s*[<>=]{1,2}\s*20/);
    expect(yaml).toContain('CADENCE_THRESHOLD');
  });
});

describe('evaluateCadenceGate', () => {
  test('N below threshold without force is no-op', () => {
    expect(
      evaluateCadenceGate({
        skipReleaseOnHead: false,
        mergedPrCount: CADENCE_THRESHOLD - 1,
        threshold: CADENCE_THRESHOLD,
        force: false,
      }),
    ).toBe('no-op');
  });

  test('N at threshold cuts', () => {
    expect(
      evaluateCadenceGate({
        skipReleaseOnHead: false,
        mergedPrCount: CADENCE_THRESHOLD,
        threshold: CADENCE_THRESHOLD,
        force: false,
      }),
    ).toBe('cut');
  });

  test('N below threshold with force cuts', () => {
    expect(
      evaluateCadenceGate({
        skipReleaseOnHead: false,
        mergedPrCount: 3,
        threshold: CADENCE_THRESHOLD,
        force: true,
      }),
    ).toBe('cut');
  });

  test('[skip release] on HEAD with N below threshold skips even with force', () => {
    expect(
      evaluateCadenceGate({
        skipReleaseOnHead: true,
        mergedPrCount: 3,
        threshold: CADENCE_THRESHOLD,
        force: true,
      }),
    ).toBe('skip');
  });

  test('[skip release] on HEAD with a full batch still cuts', () => {
    expect(
      evaluateCadenceGate({
        skipReleaseOnHead: true,
        mergedPrCount: CADENCE_THRESHOLD,
        threshold: CADENCE_THRESHOLD,
        force: false,
      }),
    ).toBe('cut');
  });
});

describe('selectBatch', () => {
  test('keeps one batch of CADENCE_THRESHOLD even when N is larger, oldest first', () => {
    const batch = selectBatch(prs(CADENCE_THRESHOLD + 5));
    expect(batch).toHaveLength(CADENCE_THRESHOLD);
    expect(batch[0]?.number).toBe(1);
    expect(batch[CADENCE_THRESHOLD - 1]?.number).toBe(CADENCE_THRESHOLD);
  });
});

describe('classifyBatch', () => {
  test('feat titles bump minor', () => {
    expect(classifyBatch(prs(2, { featFirst: true }), '0.30.1')).toEqual({ bump: 'minor', nextVersion: '0.31.0' });
  });

  test('fix-only titles bump patch', () => {
    expect(classifyBatch(prs(2, { featFirst: false }), '0.30.1')).toEqual({ bump: 'patch', nextVersion: '0.30.2' });
  });

  test('BREAKING CHANGE footer and type! titles bump major', () => {
    expect(
      classifyBatch([{ number: 1, title: 'fix: x', body: 'BREAKING CHANGE: new api', mergedAt: '2026-01-01T00:00:00Z' }], '0.30.1'),
    ).toEqual({ bump: 'major', nextVersion: '1.0.0' });
    expect(
      classifyBatch([{ number: 2, title: 'feat!: break the gate', body: '', mergedAt: '2026-01-01T00:00:00Z' }], '0.30.1'),
    ).toEqual({ bump: 'major', nextVersion: '1.0.0' });
  });
});

describe('buildNotesMarkdown', () => {
  test('lists cleaned PR titles with links and stays above the 100-char validate floor', () => {
    const markdown = buildNotesMarkdown({
      tag: 'v0.31.0',
      previousTag: 'v0.30.1',
      prs: [
        { number: 10, title: 'feat: add cadence (#10)', body: '', mergedAt: '2026-01-01T00:00:00Z' },
        { number: 11, title: 'fix: gate skip', body: '', mergedAt: '2026-01-01T00:01:00Z' },
      ],
      repoUrl: 'https://github.com/CorentinLumineau/blackhole',
    });
    expect(cleanPrTitle('feat: add cadence (#10)')).toBe('feat: add cadence');
    expect(markdown).toContain('feat: add cadence');
    expect(markdown).not.toContain('feat: add cadence (#10)');
    expect(markdown).toContain('https://github.com/CorentinLumineau/blackhole/pull/10');
    expect(markdown).toContain('fix: gate skip');
    expect(markdown).toContain('v0.31.0');
    expect(markdown.trim().length).toBeGreaterThanOrEqual(100);
  });
});

describe('verifySucceededOnSha', () => {
  test('green latest completed Verify allows a cut; red or in-progress does not', () => {
    expect(verifySucceededOnSha(greenVerify())).toBe(true);
    expect(verifySucceededOnSha(redVerify())).toBe(false);
    expect(verifySucceededOnSha([{ status: 'in_progress', conclusion: null, created_at: '2026-01-02T00:00:00Z' }])).toBe(
      false,
    );
    expect(
      verifySucceededOnSha([
        { status: 'completed', conclusion: 'success', created_at: '2026-01-01T00:00:00Z' },
        { status: 'completed', conclusion: 'failure', created_at: '2026-01-03T00:00:00Z' },
      ]),
    ).toBe(false);
  });
});

describe('headHasSkipRelease', () => {
  test('detects the skip marker in the HEAD subject', () => {
    expect(headHasSkipRelease(() => `chore(release): prepare v0.31.0 ${SKIP_RELEASE_MARKER}`)).toBe(true);
    expect(headHasSkipRelease(() => 'feat: something else')).toBe(false);
  });
});

describe('releaseCommitPaths', () => {
  test('adds notes, package.json, and all 7 versioned manifests', () => {
    const paths = releaseCommitPaths('v0.31.0');
    expect(paths).toContain('.github/releases/v0.31.0.md');
    expect(paths).toContain('package.json');
    expect(paths).toEqual(expect.arrayContaining(MANIFEST_PATHS.map((m) => m.path)));
    expect(MANIFEST_PATHS).toHaveLength(7);
    expect(new Set(paths.filter((p) => p !== '.github/releases/v0.31.0.md' && p !== 'package.json')).size).toBe(7);
  });
});

describe('cutRelease', () => {
  test('flag-on path: N>=threshold + Verify green tags, writes notes, builds, and does not retag on a second run', async () => {
    const { deps, state } = makeDeps({ pending: prs(CADENCE_THRESHOLD) });
    const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const first = await cutRelease({ cut: true, force: false, json: false }, deps);
      expect(first).toEqual({ status: 'cut', tag: 'v0.31.0' });
      expect(state.tagged).toEqual(['v0.31.0']);
      expect(state.pushed).toEqual(['v0.31.0']);
      expect(state.built).toBe(true);
      expect(state.pkgVersion).toBe('0.31.0');
      const notes = state.notes.get('v0.31.0');
      expect(notes).toContain('feat: cadence item 0');
      expect(notes).toContain('https://github.com/CorentinLumineau/blackhole/pull/1');
      expect(state.gitCalls.some((cmd) => cmd.startsWith('git add -- '))).toBe(true);
      const add = state.gitCalls.find((cmd) => cmd.startsWith('git add -- '));
      for (const manifest of MANIFEST_PATHS) {
        expect(add).toContain(manifest.path);
      }
      expect(state.gitCalls).toContain(`git commit -m "chore(release): prepare v0.31.0 ${SKIP_RELEASE_MARKER}"`);

      const second = await cutRelease({ cut: true, force: false, json: false }, deps);
      expect(second.status).toBe('skipped');
      expect(second).toMatchObject({ reason: expect.stringContaining('already exist') });
      expect(state.tagged).toEqual(['v0.31.0']);
    } finally {
      logSpy.mockRestore();
    }
  });

  test('N<threshold is a no-op unless force', async () => {
    const { deps, state } = makeDeps({ pending: prs(CADENCE_THRESHOLD - 1) });
    const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const skipped = await cutRelease({ cut: true, force: false, json: false }, deps);
      expect(skipped.status).toBe('skipped');
      expect(skipped).toMatchObject({ reason: expect.stringContaining('below threshold') });
      expect(state.tagged).toEqual([]);

      const forced = await cutRelease({ cut: true, force: true, json: false }, deps);
      expect(forced).toEqual({ status: 'cut', tag: 'v0.31.0' });
      expect(state.tagged).toEqual(['v0.31.0']);
    } finally {
      logSpy.mockRestore();
    }
  });

  test('red Verify does not tag', async () => {
    const { deps, state } = makeDeps({ pending: prs(CADENCE_THRESHOLD), verify: redVerify() });
    const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const outcome = await cutRelease({ cut: true, force: true, json: false }, deps);
      expect(outcome.status).toBe('skipped');
      expect(outcome).toMatchObject({ reason: expect.stringContaining('Verify did not succeed') });
      expect(state.tagged).toEqual([]);
      expect(state.built).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  test('a stale tip SHA does not tag', async () => {
    const { deps, state } = makeDeps({
      pending: prs(CADENCE_THRESHOLD),
      head: 'a'.repeat(40),
      originMain: 'b'.repeat(40),
    });
    const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const outcome = await cutRelease({ cut: true, force: true, json: false }, deps);
      expect(outcome.status).toBe('skipped');
      expect(outcome).toMatchObject({ reason: expect.stringContaining('stale') });
      expect(state.tagged).toEqual([]);
    } finally {
      logSpy.mockRestore();
    }
  });

  test('an existing remote tag is not retagged', async () => {
    const { deps, state } = makeDeps({
      pending: prs(CADENCE_THRESHOLD),
      remoteTags: ['v0.31.0'],
    });
    const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const outcome = await cutRelease({ cut: true, force: false, json: false }, deps);
      expect(outcome.status).toBe('skipped');
      expect(outcome).toMatchObject({ reason: expect.stringContaining('not retagging') });
      expect(state.tagged).toEqual([]);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('workflow contract', () => {
  const yaml = fs.readFileSync(WORKFLOW, 'utf-8');
  const publisher = fs.readFileSync(PUBLISHER, 'utf-8');

  test('gates the cut on vars.RELEASE_CADENCE_ENABLED and no-ops when the flag is off', () => {
    expect(yaml).toContain("if: vars.RELEASE_CADENCE_ENABLED == 'true'");
    expect(yaml).toContain("if: vars.RELEASE_CADENCE_ENABLED != 'true'");
    expect(yaml).toContain('cadence-disabled (notice)');
    expect(yaml).not.toMatch(/^\s*run:.*gh variable set RELEASE_CADENCE_ENABLED/m);
  });

  test('runs on hosted ubuntu-latest only and never publishes the GitHub Release itself', () => {
    expect(yaml).toMatch(/^\s*runs-on: ubuntu-latest$/m);
    expect(yaml).not.toContain('self-hosted');
    expect(yaml).not.toContain('pcfixe');
    expect(yaml).not.toContain('CI_COMPUTE');
    expect(yaml).not.toContain('softprops/action-gh-release');
    expect(yaml).not.toContain('gh release create');
    expect(publisher).toContain('softprops/action-gh-release');
    expect(publisher).toContain('.github/releases/${TAG}.md');
  });

  test('schedules every 2h, supports force dispatch, concurrency, stale SHA skip, and failure tracking', () => {
    expect(yaml).toContain('cron: "17 */2 * * *"');
    expect(yaml).toContain('workflow_dispatch:');
    expect(yaml).toContain('force:');
    expect(yaml).toContain('group: release-cadence');
    expect(yaml).toContain('cancel-in-progress: false');
    expect(yaml).toContain('Skip a run that main has outrun');
    expect(yaml).toContain('release-cadence cut is failing on main');
    expect(yaml).toContain('bun run release-cadence');
  });
});

describe('package.json script', () => {
  test('exposes bun run release-cadence', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['release-cadence']).toBe('bun run scripts/release-cadence.ts');
  });
});

describe('bumpPackageVersion reuse', () => {
  test('writes the version that cadence will bump before bun run build', () => {
    const dir = makeTempDir('cadence-bump-');
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.1.0' }, null, 2) + '\n');
    bumpPackageVersion(dir, '0.31.0');
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as { version: string };
    expect(pkg.version).toBe('0.31.0');
  });
});

describe('parseCadenceArgs', () => {
  test('parses --cut and --force as booleans', () => {
    expect(parseCadenceArgs(['--cut', '--force'])).toEqual({ cut: true, force: true, json: false });
    expect(parseCadenceArgs([])).toEqual({ cut: false, force: false, json: false });
  });

  test('rejects unknown flags', () => {
    withExitMocked(() => {
      expect(() => parseCadenceArgs(['--backfill'])).toThrow(ProcessExitError);
    });
  });
});

describe('createDefaultCadenceDeps', () => {
  test('wires bun run build without a --all flag and queries the Verify workflow by file name', () => {
    const src = fs.readFileSync(CADENCE_SRC, 'utf-8');
    expect(src).toContain("execSync('bun run build', { cwd: root, stdio: 'inherit' })");
    expect(src).not.toMatch(/bun run build --all/);
    expect(src).toContain(VERIFY_WORKFLOW_FILE);
    expect(typeof createDefaultCadenceDeps).toBe('function');
  });
});

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findManifestVersionMismatches,
  MANIFEST_PATHS,
  normalizeTag,
  prepareRelease,
  pushRelease,
  tagRelease,
  validateRelease,
} from './release.ts';

const TAG = 'v9.9.9';
const VERSION = '9.9.9';
const LONG_NOTES = 'x'.repeat(100);

class ProcessExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

function withExitMocked(
  run: (
    exitSpy: ReturnType<typeof spyOn>,
    errorSpy: ReturnType<typeof spyOn>,
    warnSpy: ReturnType<typeof spyOn>,
    logSpy: ReturnType<typeof spyOn>,
  ) => void,
): void {
  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExitError(code);
  }) as never);
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
  const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    run(exitSpy, errorSpy, warnSpy, logSpy);
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  }
}

type SeedRepoOptions = {
  pkgVersion: string;
  notesContent?: string;
  localTag?: boolean;
  remoteTag?: boolean;
  template?: boolean;
  dirty?: boolean;
};

const tempDirs: string[] = [];

function seedRepo(opts: SeedRepoOptions): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-test-'));
  tempDirs.push(root);

  fs.mkdirSync(path.join(root, '.github', 'releases'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'blackhole-test', version: opts.pkgVersion }, null, 2) + '\n',
    'utf-8',
  );

  if (opts.template !== false) {
    fs.writeFileSync(
      path.join(root, '.github', 'releases', 'TEMPLATE.md'),
      '## Release vX.Y.Z\n\nNotes for X.Y.Z with enough placeholder text to satisfy validate when substituted.\n',
      'utf-8',
    );
  }

  if (opts.notesContent !== undefined) {
    fs.writeFileSync(path.join(root, '.github', 'releases', `${TAG}.md`), opts.notesContent, 'utf-8');
  }

  return root;
}

function defaultExecGit(opts: {
  localTag?: boolean;
  remoteTag?: boolean;
  dirty?: boolean;
  calls?: string[];
}): (cmd: string) => string {
  return (cmd: string) => {
    opts.calls?.push(cmd);
    if (cmd === `git rev-parse refs/tags/${TAG}`) {
      if (opts.localTag) return 'deadbeef';
      throw new Error('unknown ref');
    }
    if (cmd === `git ls-remote --tags origin refs/tags/${TAG}`) {
      return opts.remoteTag ? `${'a'.repeat(40)}\trefs/tags/${TAG}` : '';
    }
    if (cmd === 'git status --porcelain') {
      return opts.dirty ? ' M package.json' : '';
    }
    if (cmd === 'git rev-parse --short HEAD') {
      return 'abc1234';
    }
    if (cmd.startsWith('git tag -a')) {
      return '';
    }
    if (cmd.startsWith('git push origin')) {
      return '';
    }
    throw new Error(`unexpected git command: ${cmd}`);
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('findManifestVersionMismatches', () => {
  test('returns [] when package.json and all 5 manifests share the same version', () => {
    const manifests: Record<string, unknown> = {};
    for (const { path } of MANIFEST_PATHS) {
      manifests[path] = { version: '0.8.0' };
    }
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
    manifests['.claude-plugin/marketplace.json'] = { version: '1.0.0', plugins: [{ version: '0.9.0' }] };

    expect(findManifestVersionMismatches('1.0.0', manifests)).toEqual(['.claude-plugin/marketplace.json']);
  });
});

describe('normalizeTag', () => {
  function withNormalizeExitMocked(
    run: (exitSpy: ReturnType<typeof spyOn>, errorSpy: ReturnType<typeof spyOn>) => void,
  ): void {
    withExitMocked((exitSpy, errorSpy) => {
      run(exitSpy, errorSpy);
    });
  }

  test('accepts a valid vX.Y.Z tag and returns it unchanged', () => {
    withNormalizeExitMocked((exitSpy, errorSpy) => {
      expect(normalizeTag('v1.2.3')).toBe('v1.2.3');
      expect(exitSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  test('rejects a tag missing the leading "v"', () => {
    withNormalizeExitMocked((exitSpy, errorSpy) => {
      expect(() => normalizeTag('1.2.3')).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid tag "1.2.3"'));
    });
  });

  test('rejects a tag with an extra version segment', () => {
    withNormalizeExitMocked((exitSpy, errorSpy) => {
      expect(() => normalizeTag('v1.2.3.4')).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid tag "v1.2.3.4"'));
    });
  });

  test('rejects a tag with a non-numeric segment', () => {
    withNormalizeExitMocked((exitSpy, errorSpy) => {
      expect(() => normalizeTag('v1.2.x')).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid tag "v1.2.x"'));
    });
  });

  test('rejects a tag missing the patch segment', () => {
    withNormalizeExitMocked((exitSpy, errorSpy) => {
      expect(() => normalizeTag('v1.2')).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid tag "v1.2"'));
    });
  });
});

describe('validateRelease', () => {
  test('exits when release notes file is missing', () => {
    const root = seedRepo({ pkgVersion: VERSION });
    withExitMocked((exitSpy, errorSpy) => {
      expect(() => validateRelease(root, TAG, { deps: { execGit: defaultExecGit({}) } })).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing release notes'));
    });
  });

  test('exits when release notes are shorter than 100 characters', () => {
    const root = seedRepo({ pkgVersion: VERSION, notesContent: 'too short' });
    withExitMocked((exitSpy, errorSpy) => {
      expect(() => validateRelease(root, TAG, { deps: { execGit: defaultExecGit({}) } })).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Release notes too short'));
    });
  });

  test('exits when package.json version does not match the tag', () => {
    const root = seedRepo({ pkgVersion: '0.0.1', notesContent: LONG_NOTES });
    withExitMocked((exitSpy, errorSpy) => {
      expect(() => validateRelease(root, TAG, { deps: { execGit: defaultExecGit({}) } })).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('does not match tag'));
    });
  });

  test('exits when the tag already exists locally', () => {
    const root = seedRepo({ pkgVersion: VERSION, notesContent: LONG_NOTES });
    withExitMocked((exitSpy, errorSpy) => {
      expect(() =>
        validateRelease(root, TAG, { deps: { execGit: defaultExecGit({ localTag: true }) } }),
      ).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already exists locally'));
    });
  });

  test('exits when the tag already exists on origin', () => {
    const root = seedRepo({ pkgVersion: VERSION, notesContent: LONG_NOTES });
    withExitMocked((exitSpy, errorSpy) => {
      expect(() =>
        validateRelease(root, TAG, { deps: { execGit: defaultExecGit({ remoteTag: true }) } }),
      ).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already exists on origin'));
    });
  });

  test('warns on a dirty working tree but still succeeds', () => {
    const root = seedRepo({ pkgVersion: VERSION, notesContent: LONG_NOTES });
    withExitMocked((exitSpy, _errorSpy, warnSpy, logSpy) => {
      validateRelease(root, TAG, { deps: { execGit: defaultExecGit({ dirty: true }) } });
      expect(exitSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith('Warning: working tree is not clean:');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('validated'));
    });
  });

  test('succeeds when all checks pass', () => {
    const root = seedRepo({ pkgVersion: VERSION, notesContent: LONG_NOTES });
    withExitMocked((exitSpy, errorSpy, warnSpy, logSpy) => {
      validateRelease(root, TAG, { deps: { execGit: defaultExecGit({}) } });
      expect(exitSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(`✓ ${TAG} validated — notes file OK, package.json ${VERSION}`);
    });
  });
});

describe('prepareRelease', () => {
  test('exits when TEMPLATE.md is missing', () => {
    const root = seedRepo({ pkgVersion: '0.0.1', template: false });
    withExitMocked((exitSpy, errorSpy) => {
      expect(() => prepareRelease(root, TAG, { build: () => undefined })).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing template'));
    });
  });

  test('exits when release notes file already exists', () => {
    const root = seedRepo({ pkgVersion: VERSION, notesContent: LONG_NOTES });
    withExitMocked((exitSpy, errorSpy) => {
      expect(() => prepareRelease(root, TAG, { build: () => undefined })).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already exist'));
    });
  });

  test('creates notes from template, bumps package.json, and invokes build', () => {
    const root = seedRepo({ pkgVersion: '0.0.1' });
    let buildCalled = false;
    prepareRelease(root, TAG, { build: () => {
      buildCalled = true;
    } });

    const notesFile = path.join(root, '.github', 'releases', `${TAG}.md`);
    const notes = fs.readFileSync(notesFile, 'utf-8');
    expect(notes).toContain(TAG);
    expect(notes).toContain(VERSION);
    expect(notes).not.toContain('vX.Y.Z');

    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { version: string };
    expect(pkg.version).toBe(VERSION);
    expect(buildCalled).toBe(true);
  });
});

describe('tagRelease', () => {
  test('propagates validate failure when release notes are missing', () => {
    const root = seedRepo({ pkgVersion: VERSION });
    withExitMocked((exitSpy, errorSpy) => {
      expect(() => tagRelease(root, TAG, { execGit: defaultExecGit({}) })).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing release notes'));
    });
  });

  test('creates an annotated local tag on the happy path', () => {
    const root = seedRepo({ pkgVersion: VERSION, notesContent: LONG_NOTES });
    const calls: string[] = [];
    withExitMocked((exitSpy, _errorSpy, _warnSpy, logSpy) => {
      tagRelease(root, TAG, { execGit: defaultExecGit({ calls }) });
      expect(exitSpy).not.toHaveBeenCalled();
      expect(calls.some((cmd) => cmd.startsWith(`git tag -a ${TAG}`))).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`Created annotated tag ${TAG}`));
    });
  });
});

describe('pushRelease', () => {
  test('exits when the local tag does not exist', () => {
    const root = seedRepo({ pkgVersion: VERSION });
    withExitMocked((exitSpy, errorSpy) => {
      expect(() => pushRelease(root, TAG, { execGit: defaultExecGit({}) })).toThrow(ProcessExitError);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('does not exist locally'));
    });
  });

  test('pushes main and the tag to origin on the happy path', () => {
    const root = seedRepo({ pkgVersion: VERSION });
    const calls: string[] = [];
    withExitMocked((exitSpy, _errorSpy, _warnSpy, logSpy) => {
      pushRelease(root, TAG, { execGit: defaultExecGit({ localTag: true, calls }) });
      expect(exitSpy).not.toHaveBeenCalled();
      expect(calls).toContain('git push origin main');
      expect(calls).toContain(`git push origin ${TAG}`);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Pushed main'));
    });
  });
});

describe("release.ts's build() step (ADR-007 T2/R5′)", () => {
  test('invokes plain `bun run build`, never a --all/--gemini/--no-codex flag', () => {
    const releaseSrc = fs.readFileSync(path.join(import.meta.dirname, 'release.ts'), 'utf-8');
    expect(releaseSrc).toContain("execSync('bun run build', { cwd: root, stdio: 'inherit' });");
    expect(releaseSrc).not.toMatch(/bun run build --all/);
    expect(releaseSrc).not.toMatch(/bun run build --gemini/);
    expect(releaseSrc).not.toMatch(/bun run build --no-codex/);
  });
});

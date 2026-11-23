import { describe, expect, test } from 'bun:test';
import { detectForgeFromOrigin, repoPathFromOrigin, resolveForgeType } from './forge-detection.ts';

describe('detectForgeFromOrigin', () => {
  test('detects GitHub', () => {
    expect(detectForgeFromOrigin('git@github.com:owner/repo.git')).toBe('github');
    expect(detectForgeFromOrigin('https://github.com/owner/repo')).toBe('github');
  });

  test('detects GitLab', () => {
    expect(detectForgeFromOrigin('https://gitlab.com/group/project')).toBe('gitlab');
    expect(detectForgeFromOrigin('git@gitlab.example.com:group/project.git')).toBe('gitlab');
  });

  test('detects Gitea', () => {
    expect(detectForgeFromOrigin('https://git.dev.example.lan/gitea/owner/repo')).toBe('gitea');
  });

  test('returns null for unknown hosts', () => {
    expect(detectForgeFromOrigin('https://example.com/foo/bar')).toBeNull();
  });
});

describe('resolveForgeType', () => {
  test('explicit config wins over origin', () => {
    const result = resolveForgeType({
      configForge: 'gitea',
      originUrl: 'https://git.dev.example.lan/gitea/o/r',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.forge).toBe('gitea');
      expect(result.source).toBe('config');
    }
  });

  test('fails on config/origin mismatch', () => {
    const result = resolveForgeType({
      configForge: 'github',
      originUrl: 'https://git.dev.example.lan/gitea/o/r',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain('mismatch');
  });

  test('infers from origin when config absent', () => {
    const result = resolveForgeType({
      originUrl: 'https://github.com/o/r',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.forge).toBe('github');
      expect(result.source).toBe('origin');
    }
  });
});

describe('repoPathFromOrigin', () => {
  test('the whole path after the host, for scp-like, https and ssh origins', () => {
    expect(repoPathFromOrigin('git@github.com:CorentinLumineau/blackhole.git')).toEqual({ host: 'github.com', path: 'CorentinLumineau/blackhole' });
    expect(repoPathFromOrigin('https://github.com/o/r.GIT/')).toEqual({ host: 'github.com', path: 'o/r' });
    expect(repoPathFromOrigin('ssh://git@git.example.lan:2222/AI/mercure.git')).toEqual({ host: 'git.example.lan:2222', path: 'AI/mercure' });
  });

  test('keeps GitLab nested groups whole', () => {
    expect(repoPathFromOrigin('https://gitlab.com/grp/sub/repo.git')).toEqual({ host: 'gitlab.com', path: 'grp/sub/repo' });
    expect(repoPathFromOrigin('git@gitlab.example.com:grp/sub/repo.git')).toEqual({ host: 'gitlab.example.com', path: 'grp/sub/repo' });
  });

  test('null without a host: local paths, file:// origins, or a path with fewer than two segments', () => {
    expect(repoPathFromOrigin('/srv/git/repo.git')).toBeNull();
    expect(repoPathFromOrigin('../other/repo')).toBeNull();
    expect(repoPathFromOrigin('file:///srv/git/o/r.git')).toBeNull();
    expect(repoPathFromOrigin('https://github.com/solo')).toBeNull();
    expect(repoPathFromOrigin('blackhole')).toBeNull();
    expect(repoPathFromOrigin(null)).toBeNull();
    expect(repoPathFromOrigin('')).toBeNull();
  });
});

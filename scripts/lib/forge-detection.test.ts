import { describe, expect, test } from 'bun:test';
import { detectForgeFromOrigin, resolveForgeType } from './forge-detection.ts';

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

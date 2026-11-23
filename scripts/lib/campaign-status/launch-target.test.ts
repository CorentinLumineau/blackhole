import { describe, expect, test } from 'bun:test';
import { resolveLaunchTarget, statedTargetMatches, targetCard, targetHeading, targetLine } from './launch-target.ts';

const DIR = '/home/user/blackhole/.blackhole';

describe('resolveLaunchTarget', () => {
  test('config.json repo wins over the origin remote', () => {
    expect(resolveLaunchTarget({ campaignDir: DIR, configRepo: 'a/b', originUrl: 'git@github.com:c/d.git' })).toEqual({ repo: 'a/b', campaignDir: DIR, source: 'config' });
  });

  test('falls back to the whole path of the origin remote, GitLab nested groups included', () => {
    expect(resolveLaunchTarget({ campaignDir: DIR, configRepo: undefined, originUrl: 'git@github.com:c/d.git' })).toEqual({ repo: 'c/d', campaignDir: DIR, source: 'origin' });
    expect(resolveLaunchTarget({ campaignDir: DIR, configRepo: undefined, originUrl: 'https://gitlab.com/grp/sub/repo.git' })).toEqual({ repo: 'grp/sub/repo', campaignDir: DIR, source: 'origin' });
  });

  test('no repo when there is no origin, or an origin with no host (local path, file://)', () => {
    expect(resolveLaunchTarget({ campaignDir: DIR, configRepo: undefined, originUrl: null })).toEqual({ repo: null, campaignDir: DIR, source: 'none' });
    expect(resolveLaunchTarget({ campaignDir: DIR, configRepo: undefined, originUrl: '/srv/git/o/r.git' })).toEqual({ repo: null, campaignDir: DIR, source: 'none' });
    expect(resolveLaunchTarget({ campaignDir: DIR, configRepo: undefined, originUrl: 'file:///srv/git/o/r.git' })).toEqual({ repo: null, campaignDir: DIR, source: 'none' });
  });
});

describe('statedTargetMatches', () => {
  const target = { repo: 'CorentinLumineau/blackhole', campaignDir: DIR, source: 'config' as const };

  test('a bare name, a full path or a URL naming the resolved repository matches, case-insensitively', () => {
    expect(statedTargetMatches('blackhole', target)).toBe(true);
    expect(statedTargetMatches('BlackHole.GIT', target)).toBe(true);
    expect(statedTargetMatches('corentinlumineau/blackhole', target)).toBe(true);
    expect(statedTargetMatches('https://github.com/CorentinLumineau/blackhole.git', target)).toBe(true);
  });

  test('a stated target naming another repository does not match', () => {
    expect(statedTargetMatches('monorepo', target)).toBe(false);
    expect(statedTargetMatches('CorentinLumineau/monorepo', target)).toBe(false);
    expect(statedTargetMatches('other/blackhole', target)).toBe(false);
  });

  test('GitLab nested groups compare the whole path or a segment-boundary suffix', () => {
    const nested = { repo: 'grp/sub/repo', campaignDir: DIR, source: 'origin' as const };
    expect(statedTargetMatches('grp/sub/repo', nested)).toBe(true);
    expect(statedTargetMatches('https://gitlab.com/grp/sub/repo', nested)).toBe(true);
    expect(statedTargetMatches('repo', nested)).toBe(true);
    expect(statedTargetMatches('sub/repo', nested)).toBe(true);
    expect(statedTargetMatches('grp/other/repo', nested)).toBe(false);
  });

  test('a stated path matches a segment-boundary suffix of the resolved path, as on a proxied cloud origin', () => {
    const proxied = resolveLaunchTarget({ campaignDir: DIR, configRepo: undefined, originUrl: 'http://proxy@127.0.0.1:4000/git/owner/repo' });
    expect(proxied.repo).toBe('git/owner/repo');
    expect(statedTargetMatches('owner/repo', proxied)).toBe(true);
    expect(statedTargetMatches('sub/repo', { repo: 'grp/sub/repo', campaignDir: DIR, source: 'origin' })).toBe(true);
    expect(statedTargetMatches('wner/repo', { repo: 'owner/repo', campaignDir: DIR, source: 'config' })).toBe(false);
    expect(statedTargetMatches('wner/repo', proxied)).toBe(false);
    expect(statedTargetMatches('other/repo', proxied)).toBe(false);
  });

  test('no resolved repository never matches a stated target: it cannot be confirmed', () => {
    expect(statedTargetMatches('blackhole', { repo: null, campaignDir: DIR, source: 'none' })).toBe(false);
  });
});

describe('the target line, heading and card', () => {
  const target = { repo: 'CorentinLumineau/blackhole', campaignDir: DIR, source: 'config' as const };

  test('the heading names owner/repo and the absolute campaign directory', () => {
    expect(targetHeading(target)).toBe(`## Launch summary — CorentinLumineau/blackhole · ${DIR}`);
    expect(targetHeading({ repo: null, campaignDir: DIR, source: 'none' })).toBe(`## Launch summary — no repo · ${DIR}`);
  });

  test('the target line', () => {
    expect(targetLine(target)).toBe(`Target: CorentinLumineau/blackhole · ${DIR}`);
  });

  test('the mismatch card asks one question with Continue here and Stop, and no Accept', () => {
    const card = targetCard(target, 'monorepo');
    expect(card.questions).toHaveLength(1);
    const [q] = card.questions;
    expect(q.header).toBe('Target');
    expect(q.question).toContain('monorepo');
    expect(q.question).toContain('CorentinLumineau/blackhole');
    expect(q.question).toContain(DIR);
    expect(q.options.map((o) => o.label)).toEqual(['Continue here', 'Stop']);
  });
});

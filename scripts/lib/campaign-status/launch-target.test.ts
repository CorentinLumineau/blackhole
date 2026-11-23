import { describe, expect, test } from 'bun:test';
import { repoSlugFromOrigin, resolveLaunchTarget, statedTargetMatches, targetCard, targetHeading, targetLine } from './launch-target.ts';

const DIR = '/home/user/blackhole/.blackhole';

describe('repoSlugFromOrigin', () => {
  test('reads owner/repo from the usual origin shapes', () => {
    expect(repoSlugFromOrigin('git@github.com:CorentinLumineau/blackhole.git')).toBe('CorentinLumineau/blackhole');
    expect(repoSlugFromOrigin('https://github.com/CorentinLumineau/blackhole')).toBe('CorentinLumineau/blackhole');
    expect(repoSlugFromOrigin('https://github.com/CorentinLumineau/blackhole.git/')).toBe('CorentinLumineau/blackhole');
    expect(repoSlugFromOrigin('http://proxy@127.0.0.1:4000/git/CorentinLumineau/monorepo')).toBe('CorentinLumineau/monorepo');
    expect(repoSlugFromOrigin('ssh://git@git.example.lan:2222/AI/mercure.git')).toBe('AI/mercure');
  });

  test('null when there is no origin or no owner/repo in it', () => {
    expect(repoSlugFromOrigin(null)).toBeNull();
    expect(repoSlugFromOrigin('')).toBeNull();
    expect(repoSlugFromOrigin('blackhole')).toBeNull();
  });
});

describe('resolveLaunchTarget', () => {
  test('config.json repo wins over the origin remote', () => {
    expect(resolveLaunchTarget({ campaignDir: DIR, configRepo: 'a/b', originUrl: 'git@github.com:c/d.git' })).toEqual({ repo: 'a/b', campaignDir: DIR, source: 'config' });
  });

  test('falls back to the origin remote, then to no repo', () => {
    expect(resolveLaunchTarget({ campaignDir: DIR, configRepo: undefined, originUrl: 'git@github.com:c/d.git' })).toEqual({ repo: 'c/d', campaignDir: DIR, source: 'origin' });
    expect(resolveLaunchTarget({ campaignDir: DIR, configRepo: undefined, originUrl: null })).toEqual({ repo: null, campaignDir: DIR, source: 'none' });
  });
});

describe('statedTargetMatches', () => {
  const target = { repo: 'CorentinLumineau/blackhole', campaignDir: DIR, source: 'config' as const };

  test('a bare name or a full slug naming the resolved repository matches, case-insensitively', () => {
    expect(statedTargetMatches('blackhole', target)).toBe(true);
    expect(statedTargetMatches('BlackHole', target)).toBe(true);
    expect(statedTargetMatches('corentinlumineau/blackhole', target)).toBe(true);
    expect(statedTargetMatches('https://github.com/CorentinLumineau/blackhole.git', target)).toBe(true);
  });

  test('a stated target naming another repository does not match', () => {
    expect(statedTargetMatches('monorepo', target)).toBe(false);
    expect(statedTargetMatches('CorentinLumineau/monorepo', target)).toBe(false);
    expect(statedTargetMatches('other/blackhole', target)).toBe(false);
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

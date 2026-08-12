import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildCreateArgs,
  buildCreateArgsWithCampaignLabel,
  buildListArgs,
  issueMatchesScope,
  loadConfig,
  readScope,
  resolveConfigPath,
  type CampaignScope,
  type ForgeIssue,
} from './forge-scope';
import { makeTempDir } from './lib/fs.ts';

const SCRIPT_PATH = path.join(import.meta.dir, 'forge-scope.ts');

const runCli = (
  cmd: string,
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
) => {
  const proc = Bun.spawnSync({
    cmd: ['bun', SCRIPT_PATH, cmd],
    cwd: opts.cwd ?? import.meta.dir,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    status: proc.exitCode,
    stdout: proc.stdout.toString('utf-8'),
    stderr: proc.stderr.toString('utf-8'),
  };
};

const writeCampaignConfig = (
  dir: string,
  config: Record<string, unknown>,
  relPath = '.blackhole/config.json',
): string => {
  const configPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');
  return configPath;
};

describe('buildListArgs', () => {
  test('milestone only', () => {
    const args = buildListArgs({ milestone: 'v0.4.0' });
    expect(args).toContain('--milestone');
    expect(args).toContain('v0.4.0');
  });

  test('labels only', () => {
    const args = buildListArgs({ labels: ['a', 'b'] });
    expect(args.filter((a) => a === '--label')).toHaveLength(2);
    expect(args).toContain('a');
    expect(args).toContain('b');
  });

  test('milestone and labels', () => {
    const args = buildListArgs({ milestone: 'v0.4.0', labels: ['blackhole/backlog'] });
    expect(args).toContain('--milestone');
    expect(args).toContain('v0.4.0');
    expect(args).toContain('--label');
    expect(args).toContain('blackhole/backlog');
  });

  test('empty scope', () => {
    const args = buildListArgs({});
    expect(args).toEqual([]);
  });
});

describe('buildCreateArgs', () => {
  test('mirrors list args', () => {
    const scope: CampaignScope = { milestone: 'v0.4.0', labels: ['size:m'] };
    const args = buildCreateArgs(scope);
    expect(args).toContain('--milestone');
    expect(args).toContain('v0.4.0');
    expect(args).toContain('--label');
    expect(args).toContain('size:m');
  });
});

describe('buildCreateArgsWithCampaignLabel', () => {
  test('appends campaign label when not already in scope_labels', () => {
    const args = buildCreateArgsWithCampaignLabel({
      scope_milestone: 'v0.4.0',
      scope_labels: ['blackhole/backlog'],
      issue_labels: { campaign: 'blackhole/campaign' },
    });
    expect(args).toEqual([
      '--milestone',
      'v0.4.0',
      '--label',
      'blackhole/backlog',
      '--label',
      'blackhole/campaign',
    ]);
  });

  test('does not duplicate campaign label when already in scope_labels', () => {
    const args = buildCreateArgsWithCampaignLabel({
      scope_labels: ['blackhole/campaign', 'size:s'],
      issue_labels: { campaign: 'blackhole/campaign' },
    });
    expect(args.filter((a) => a === 'blackhole/campaign')).toHaveLength(1);
    expect(args).toEqual(['--label', 'blackhole/campaign', '--label', 'size:s']);
  });

  test('omits campaign label when issue_labels.campaign is unset', () => {
    const args = buildCreateArgsWithCampaignLabel({
      scope_milestone: 'v0.4.0',
      scope_labels: ['blackhole/backlog'],
    });
    expect(args).toEqual(['--milestone', 'v0.4.0', '--label', 'blackhole/backlog']);
  });

  test('adds only campaign label when scope is empty', () => {
    const args = buildCreateArgsWithCampaignLabel({
      issue_labels: { campaign: 'blackhole/campaign' },
    });
    expect(args).toEqual(['--label', 'blackhole/campaign']);
  });
});

describe('issueMatchesScope', () => {
  const issue = (milestone: string | null, labels: string[]): ForgeIssue => ({
    milestone: milestone ? { title: milestone } : null,
    labels: labels.map((name) => ({ name })),
  });

  test('no scope matches all', () => {
    expect(issueMatchesScope(issue('v0.4.0', ['a']), {})).toBe(true);
  });

  test('milestone match', () => {
    expect(issueMatchesScope(issue('v0.4.0', []), { milestone: 'v0.4.0' })).toBe(true);
    expect(issueMatchesScope(issue('v0.3.0', []), { milestone: 'v0.4.0' })).toBe(false);
  });

  test('labels require all (AND)', () => {
    expect(issueMatchesScope(issue(null, ['a', 'b']), { labels: ['a', 'b'] })).toBe(true);
    expect(issueMatchesScope(issue(null, ['a']), { labels: ['a', 'b'] })).toBe(false);
  });

  test('milestone and labels combined', () => {
    const scope = { milestone: 'v0.4.0', labels: ['blackhole/backlog'] };
    expect(issueMatchesScope(issue('v0.4.0', ['blackhole/backlog']), scope)).toBe(true);
    expect(issueMatchesScope(issue('v0.4.0', []), scope)).toBe(false);
  });
});

describe('readScope', () => {
  test('reads milestone and labels', () => {
    const scope = readScope({
      scope_milestone: 'v0.4.0',
      scope_labels: ['blackhole/backlog', 'size:m'],
    });
    expect(scope.milestone).toBe('v0.4.0');
    expect(scope.labels).toEqual(['blackhole/backlog', 'size:m']);
  });

  test('empty scope_labels treated as unset', () => {
    const scope = readScope({ scope_milestone: 'v0.4.0', scope_labels: [] });
    expect(scope.milestone).toBe('v0.4.0');
    expect(scope.labels).toBeUndefined();
  });

  test('unset fields', () => {
    expect(readScope({})).toEqual({});
  });
});

describe('resolveConfigPath', () => {
  const originalCampaignConfig = process.env.CAMPAIGN_CONFIG;

  afterEach(() => {
    if (originalCampaignConfig === undefined) delete process.env.CAMPAIGN_CONFIG;
    else process.env.CAMPAIGN_CONFIG = originalCampaignConfig;
  });

  test('returns CAMPAIGN_CONFIG when set', () => {
    process.env.CAMPAIGN_CONFIG = '/tmp/custom-config.json';
    expect(resolveConfigPath()).toBe('/tmp/custom-config.json');
  });

  test('defaults to .blackhole/config.json under cwd when CAMPAIGN_CONFIG unset', () => {
    delete process.env.CAMPAIGN_CONFIG;
    expect(resolveConfigPath()).toBe(path.join(process.cwd(), '.blackhole/config.json'));
  });
});

describe('loadConfig', () => {
  const originalCampaignConfig = process.env.CAMPAIGN_CONFIG;

  afterEach(() => {
    if (originalCampaignConfig === undefined) delete process.env.CAMPAIGN_CONFIG;
    else process.env.CAMPAIGN_CONFIG = originalCampaignConfig;
  });

  test('reads config from CAMPAIGN_CONFIG path', () => {
    const fixtureDir = makeTempDir('forge-scope-config');
    try {
      const configPath = writeCampaignConfig(fixtureDir, {
        scope_milestone: 'v0.5.0',
        scope_labels: ['blackhole/backlog'],
        issue_labels: { campaign: 'blackhole/campaign' },
      });
      process.env.CAMPAIGN_CONFIG = configPath;
      expect(loadConfig()).toEqual({
        scope_milestone: 'v0.5.0',
        scope_labels: ['blackhole/backlog'],
        issue_labels: { campaign: 'blackhole/campaign' },
      });
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

describe('forge-scope CLI', () => {
  test('list-args prints scope flags from default config path', () => {
    const fixtureDir = makeTempDir('forge-scope-cli');
    try {
      writeCampaignConfig(fixtureDir, {
        scope_milestone: 'v0.4.0',
        scope_labels: ['blackhole/backlog'],
      });
      const result = runCli('list-args', { cwd: fixtureDir, env: { CAMPAIGN_CONFIG: undefined } });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('--milestone v0.4.0 --label blackhole/backlog');
      expect(result.stderr).toBe('');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('create-args merges campaign label via CAMPAIGN_CONFIG override', () => {
    const fixtureDir = makeTempDir('forge-scope-cli');
    try {
      const configPath = writeCampaignConfig(fixtureDir, {
        scope_milestone: 'v0.4.0',
        scope_labels: ['blackhole/backlog'],
        issue_labels: { campaign: 'blackhole/campaign' },
      });
      const result = runCli('create-args', {
        cwd: fixtureDir,
        env: { CAMPAIGN_CONFIG: configPath },
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(
        '--milestone v0.4.0 --label blackhole/backlog --label blackhole/campaign',
      );
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('unknown subcommand prints usage and exits 1', () => {
    const result = runCli('not-a-command');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: bun scripts/forge-scope.ts <list-args|create-args>');
    expect(result.stdout).toBe('');
  });
});

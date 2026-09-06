import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as cli from './forge-adapter/cli.ts';
import * as glabCli from './forge-adapter/glab-cli.ts';
import * as teaCli from './forge-adapter/tea-cli.ts';
import { checkForgeAuthSync } from './forge-doctor.ts';

describe('checkForgeAuthSync github', () => {
  let runGhSpy: ReturnType<typeof spyOn<typeof cli, 'runGh'>>;

  afterEach(() => {
    runGhSpy?.mockRestore();
  });

  test('reports ok with github.com host when logged in', () => {
    runGhSpy = spyOn(cli, 'runGh').mockReturnValue({
      status: 0,
      stdout: 'Logged in to github.com as octocat\n',
      stderr: '',
      error: null,
    });
    expect(checkForgeAuthSync('github')).toEqual({ ok: true, host: 'github.com' });
  });

  test('reports missing gh binary on ENOENT', () => {
    runGhSpy = spyOn(cli, 'runGh').mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
    const result = checkForgeAuthSync('github');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('GitHub CLI not found');
  });

  test('reports a non-zero gh auth status exit', () => {
    runGhSpy = spyOn(cli, 'runGh').mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'not logged in',
      error: null,
    });
    expect(checkForgeAuthSync('github')).toEqual({ ok: false, detail: 'not logged in' });
  });
});

describe('checkForgeAuthSync gitea', () => {
  let runTeaSpy: ReturnType<typeof spyOn<typeof teaCli, 'runTea'>>;

  afterEach(() => {
    runTeaSpy?.mockRestore();
  });

  test('reports ok when tea logins lists an account', () => {
    runTeaSpy = spyOn(teaCli, 'runTea').mockReturnValue({
      status: 0,
      stdout: 'user@host (default)\n',
      stderr: '',
      error: null,
    });
    expect(checkForgeAuthSync('gitea')).toEqual({ ok: true });
  });

  test('reports missing tea binary on ENOENT', () => {
    runTeaSpy = spyOn(teaCli, 'runTea').mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
    const result = checkForgeAuthSync('gitea');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Gitea CLI (tea) not found');
  });

  test('reports no login configured on empty stdout with a zero exit', () => {
    runTeaSpy = spyOn(teaCli, 'runTea').mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      error: null,
    });
    const result = checkForgeAuthSync('gitea');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('no tea login configured');
  });

  test('reports a non-zero tea logins exit', () => {
    runTeaSpy = spyOn(teaCli, 'runTea').mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'no config file found',
      error: null,
    });
    expect(checkForgeAuthSync('gitea')).toEqual({
      ok: false,
      detail: 'no config file found',
    });
  });
});

describe('checkForgeAuthSync gitlab', () => {
  let runGlabSpy: ReturnType<typeof spyOn<typeof glabCli, 'runGlab'>>;

  afterEach(() => {
    runGlabSpy?.mockRestore();
  });

  test('reports ok with the GitLab host when logged in', () => {
    runGlabSpy = spyOn(glabCli, 'runGlab').mockReturnValue({
      status: 0,
      stdout: 'GitLab: gitlab.com as user (glab)\n',
      stderr: '',
      error: null,
    });
    expect(checkForgeAuthSync('gitlab')).toEqual({ ok: true, host: 'gitlab.com' });
  });

  test('reports missing glab binary on ENOENT', () => {
    runGlabSpy = spyOn(glabCli, 'runGlab').mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
    const result = checkForgeAuthSync('gitlab');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('GitLab CLI (glab) not found');
  });

  test('reports a non-zero glab auth status exit', () => {
    runGlabSpy = spyOn(glabCli, 'runGlab').mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'no token found',
      error: null,
    });
    expect(checkForgeAuthSync('gitlab')).toEqual({ ok: false, detail: 'no token found' });
  });
});

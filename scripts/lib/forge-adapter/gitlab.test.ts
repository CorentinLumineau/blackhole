import { describe, expect, spyOn, test, afterEach } from 'bun:test';
import * as glabCli from './glab-cli.ts';
import { GitLabForgeAdapter } from './gitlab.ts';

describe('GitLabForgeAdapter', () => {
  let runGlabJsonSpy: ReturnType<typeof spyOn<typeof glabCli, 'runGlabJson'>>;

  afterEach(() => {
    runGlabJsonSpy?.mockRestore();
  });

  test('issueList normalizes glab issue rows', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue([
      {
        iid: 12,
        title: 'GitLab issue',
        description: 'body',
        labels: ['bug'],
        state: 'opened',
      },
    ]);
    const adapter = new GitLabForgeAdapter('group/project');
    const issues = await adapter.issueList();
    expect(issues[0].number).toBe(12);
    expect(issues[0].labels).toEqual([{ name: 'bug' }]);
    expect(issues[0].state).toBe('OPEN');
  });

  test('prList maps merge requests to ForgePr', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue([
      {
        iid: 4,
        title: 'mr',
        description: '',
        source_branch: 'feature',
        state: 'opened',
        merged_at: null,
      },
    ]);
    const adapter = new GitLabForgeAdapter('group/project');
    const prs = await adapter.prList();
    expect(prs[0].number).toBe(4);
    expect(prs[0].headRefName).toBe('feature');
  });
});

describe('createForgeAdapter gitlab', () => {
  test('selects gitlab backend', async () => {
    const { createForgeAdapter } = await import('./index.ts');
    const adapter = createForgeAdapter({ repo: 'group/project', forge: 'gitlab' });
    expect(adapter.forge).toBe('gitlab');
  });
});

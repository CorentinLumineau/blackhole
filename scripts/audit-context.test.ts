import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildAuditContext } from './audit-context.ts';
import { requiredAuditModules } from './lib/audit-module-triggers.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ctx-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const git = (...args: string[]) => {
  const r = Bun.spawnSync({ cmd: ['git', '-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
};
const put = (rel: string, body = 'x') => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

git('init', '-q', '-b', 'main');
put('README.md');
git('add', '.');
git('commit', '-q', '-m', 'base');
git('checkout', '-q', '-b', 'pr');
put('templates/hooks/a.ts');
put('scripts/hooks.test.ts');
put('documentation/reference/product-principles.md');
put('.blackhole/plan.md', '---\ntrack: standard\n---\n## Threat Model\nrows\n');
put('.blackhole/config.json', JSON.stringify({ docs_governance: { enabled: true } }));
put('.blackhole/queue.json', JSON.stringify({ pipeline_detection: { actionman_workclaude: true }, issues: { '7': { size: 'xs', route: { ui: true, task_type: 'feature' } } } }));
git('add', '.');
git('commit', '-q', '-m', 'pr');

const input = {
  repoDir: dir,
  baseRef: 'main',
  head: 'HEAD',
  dispatch: 'full' as const,
  issueRef: '7',
  planFile: path.join(dir, '.blackhole/plan.md'),
  configFile: path.join(dir, '.blackhole/config.json'),
  queueFile: path.join(dir, '.blackhole/queue.json'),
};

describe('buildAuditContext', () => {
  test('collects the diff paths, plan, config, route (size normalised), queue and dispatch facts', () => {
    const ctx = buildAuditContext(input);
    expect(ctx.changedFiles).toContain('templates/hooks/a.ts');
    expect(ctx.planText).toContain('## Threat Model');
    expect(ctx.config?.docs_governance?.enabled).toBe(true);
    expect(ctx.route).toMatchObject({ ui: true, size: 'size:xs', task_type: 'feature' });
    expect(ctx.queue?.pipeline_detection?.actionman_workclaude).toBe(true);
    expect(ctx.dispatch).toEqual({ recheck: false, independentVerification: false });
    expect(ctx.productPrinciplesExists).toBe(true);
  });

  test('the built context drives the trigger table end to end', () => {
    const required = requiredAuditModules(buildAuditContext(input));
    expect(required).toContain('16-threat-model-audit.md');
    expect(required).toContain('28-actionman-workclaude-discipline-audit.md');
    expect(required).toContain('30-v-test09-hooks-claim-audit.md');
    expect(required).not.toContain('21-ui-interpretation-gate-audit.md');
  });

  test('a recheck dispatch sets the recheck flag; a verification dispatch sets the other', () => {
    expect(buildAuditContext({ ...input, dispatch: 'recheck' }).dispatch).toEqual({ recheck: true, independentVerification: false });
    expect(buildAuditContext({ ...input, dispatch: 'verification' }).dispatch).toEqual({ recheck: false, independentVerification: true });
  });

  test('an unresolvable base ref throws instead of yielding an empty diff', () => {
    expect(() => buildAuditContext({ ...input, baseRef: 'no-such-ref' })).toThrow('failed');
  });
});

import { describe, expect, test } from 'bun:test';
import {
  checkPlaybookInvocation,
  findAliasInvocations,
  flaggedAliases,
  runChecks,
} from './checks/playbook-invocation.check.ts';

const PACKAGE_SCRIPTS = {
  build: 'bun run scripts/build.ts',
  verify: 'bun run scripts/verify.ts',
  'verify:codex': 'bun run scripts/verify.ts',
  test: 'bun test',
  status: 'bun run scripts/campaign-status.ts',
  doctor: 'bun run scripts/doctor.ts',
};

describe('flaggedAliases', () => {
  test('flags every package.json script key outside the maintainer exemption set', () => {
    expect(flaggedAliases(PACKAGE_SCRIPTS)).toEqual(['doctor', 'status']);
  });

  test('a newly added alias is flagged without editing the check', () => {
    expect(flaggedAliases({ ...PACKAGE_SCRIPTS, 'new-thing': 'bun run scripts/new-thing.ts' })).toContain(
      'new-thing',
    );
  });
});

describe('findAliasInvocations', () => {
  const aliases = flaggedAliases(PACKAGE_SCRIPTS);
  const flags = (content: string) => findAliasInvocations(content, 'fixture.md', aliases);

  test.each([
    ['bun run status', 'Run `bun run status` for the dashboard.'],
    ['bun run status with arguments', '`bun run status config-summary`'],
    ['bun run doctor', 'Run `bun run doctor` before launch.'],
    ['bun run --cwd pinned alias', '`bun run --cwd . status --data`'],
    ['bun run --cwd placeholder alias', '`bun run --cwd <repo root> doctor`'],
    ['bun shorthand', '`bun status`'],
    ['npm run', '`npm run status`'],
  ])('flags %s', (_name, line) => {
    expect(flags(line)).toEqual(['fixture.md:1']);
  });

  test.each([
    ['source-path invocation', '`bun run scripts/campaign-status.ts --data`'],
    ['exempt maintainer alias build', '`bun run build`'],
    ['exempt maintainer alias verify', '`bun run verify`'],
    ['consumer repo script', '`bun run setup`'],
    ['longer word sharing the prefix', '`bun run status-page`'],
    ['prose mention without an invocation', 'the status command and the doctor report'],
  ])('does not flag %s', (_name, line) => {
    expect(flags(line)).toEqual([]);
  });

  test('reports the line number of each offending line', () => {
    const content = ['ok line', 'run `bun run doctor`', 'ok', '`npm run status`'].join('\n');
    expect(flags(content)).toEqual(['fixture.md:2', 'fixture.md:4']);
  });
});

describe('runChecks', () => {
  test('the live playbook tree carries no package.json alias invocation', () => {
    const [result] = runChecks();
    expect(result.id).toBe('V-INVOKE-01');
    expect(result.detail).toBeUndefined();
    expect(result.ok).toBe(true);
  });
});

describe('checkPlaybookInvocation fails closed', () => {
  test('a missing sweep directory fails instead of sweeping nothing', () => {
    const result = checkPlaybookInvocation(PACKAGE_SCRIPTS, ['src/agents', 'src/no-such-dir']);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('sweep dir src/no-such-dir is missing or has no .md files');
  });

  test('a directory with no markdown files fails', () => {
    const result = checkPlaybookInvocation(PACKAGE_SCRIPTS, ['scripts/checks']);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('sweep dir scripts/checks is missing or has no .md files');
  });

  test('an empty flagged alias set fails instead of matching nothing', () => {
    const result = checkPlaybookInvocation({ build: 'bun run scripts/build.ts' }, ['src/agents']);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('no package.json script alias left to guard (scripts missing or all exempt)');
  });

  test('a healthy sweep with live aliases passes', () => {
    expect(checkPlaybookInvocation(PACKAGE_SCRIPTS, ['src/agents'])).toEqual({ id: 'V-INVOKE-01', ok: true });
  });
});

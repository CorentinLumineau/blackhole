import { describe, expect, test } from 'bun:test';
import {
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

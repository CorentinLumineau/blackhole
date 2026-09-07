import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import { checkReformulationSurface, runChecks } from './checks/reformulation-surface.check.ts';

// Issue #943 — V-REFORM-01 had no test under any convention until this file.
// checkReformulationSurface() takes no parameters and reads four fixed real-repo paths directly
// via fs.readFileSync (worker-schemas.md, planner.ts, phase-plan.md, planner-ready.json fixture)
// — no exported pure sub-function exists to unit-test the comparison logic without touching real
// state. We spyOn(fs, 'readFileSync') (the mocking primitive verify.runner.test.ts already
// establishes in this codebase — spyOn(process, 'exit'), spyOn(console, 'log')), intercept
// exactly one target path per test, transform its real content to a deliberately-broken variant,
// and delegate every other path to the real fs.readFileSync (captured before the spy installs).

const realReadFileSync = fs.readFileSync.bind(fs);

const WORKER_SCHEMAS_PATH = path.join(root, 'src/references/worker-schemas.md');
const PLANNER_TS_PATH = path.join(root, 'scripts/lib/worker-json/validators/planner.ts');
const PHASE_PLAN_PATH = path.join(root, 'src/references/phase-plan.md');
const FIXTURE_PATH = path.join(root, 'fixtures/worker-json/planner-ready.json');

let activeSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  activeSpy?.mockRestore();
  activeSpy = undefined;
});

// Installs a readFileSync spy that returns `overrideContent` for `targetPath` (matched by
// absolute path, ignoring the encoding argument bun/node always pass as 'utf-8' here) and
// delegates every other path to the real implementation.
function installOverride(targetPath: string, overrideContent: string): void {
  activeSpy = spyOn(fs, 'readFileSync').mockImplementation(((...args: unknown[]) => {
    const [filePath] = args as [fs.PathOrFileDescriptor, ...unknown[]];
    if (typeof filePath === 'string' && path.resolve(filePath) === targetPath) {
      return overrideContent;
    }
    return (realReadFileSync as (...a: unknown[]) => unknown)(...args);
  }) as typeof fs.readFileSync);
}

describe('checkReformulationSurface — broken-input cases', () => {
  test('worker-schemas.md missing reformulation.understood → ok:false, detail names it', () => {
    const real = realReadFileSync(WORKER_SCHEMAS_PATH, 'utf-8') as string;
    expect(real).toContain('reformulation.understood');
    const broken = real.replace(/reformulation\.understood/g, 'reformulation.DECOY');
    installOverride(WORKER_SCHEMAS_PATH, broken);

    const result = checkReformulationSurface();
    expect(result.ok).toBe(false);
    expect(result.detail ?? '').toContain('worker-schemas.md: missing reformulation.understood');
  });

  test('planner.ts missing validateReformulation wiring → ok:false, detail names it', () => {
    const real = realReadFileSync(PLANNER_TS_PATH, 'utf-8') as string;
    expect(real).toContain('validateReformulation');
    const broken = real.replace(/validateReformulation/g, 'validateDecoyDoesNotExist');
    installOverride(PLANNER_TS_PATH, broken);

    const result = checkReformulationSurface();
    expect(result.ok).toBe(false);
    expect(result.detail ?? '').toContain('planner.ts: missing validateReformulation wiring');
  });

  test('phase-plan.md missing gh issue comment posting → ok:false, detail names it', () => {
    const real = realReadFileSync(PHASE_PLAN_PATH, 'utf-8') as string;
    expect(real).toContain('gh issue comment');
    const broken = real.replace(/gh issue comment/g, 'gh decoy comment');
    installOverride(PHASE_PLAN_PATH, broken);

    const result = checkReformulationSurface();
    expect(result.ok).toBe(false);
    expect(result.detail ?? '').toContain(
      'phase-plan.md: missing gh issue comment posting for reformulation',
    );
  });

  test('fixture with reformulation key deleted → ok:false, detail names it', () => {
    const real = JSON.parse(realReadFileSync(FIXTURE_PATH, 'utf-8') as string) as Record<
      string,
      unknown
    >;
    expect(real.reformulation).toBeDefined();
    const broken = { ...real };
    delete broken.reformulation;
    installOverride(FIXTURE_PATH, JSON.stringify(broken, null, 2));

    const result = checkReformulationSurface();
    expect(result.ok).toBe(false);
    expect(result.detail ?? '').toContain('planner-ready.json: missing reformulation object');
  });

  test('fixture with reformulation.assumed set to empty string → ok:false, detail names it', () => {
    const real = JSON.parse(realReadFileSync(FIXTURE_PATH, 'utf-8') as string) as Record<
      string,
      unknown
    >;
    const reformulation = real.reformulation as Record<string, unknown>;
    expect(typeof reformulation.assumed).toBe('string');
    const broken = { ...real, reformulation: { ...reformulation, assumed: '' } };
    installOverride(FIXTURE_PATH, JSON.stringify(broken, null, 2));

    const result = checkReformulationSurface();
    expect(result.ok).toBe(false);
    expect(result.detail ?? '').toContain(
      'planner-ready.json: reformulation.assumed must be a non-empty string',
    );
  });
});

describe('checkReformulationSurface — live-tree pass-through', () => {
  test('returns { id: V-REFORM-01, ok: true } with no mock installed', () => {
    const result = checkReformulationSurface();
    expect(result).toEqual({ id: 'V-REFORM-01', ok: true });
  });

  test('runChecks() returns exactly one result matching the live-tree pass', () => {
    const results = runChecks();
    expect(results.length).toBe(1);
    expect(results[0]).toEqual({ id: 'V-REFORM-01', ok: true });
  });
});

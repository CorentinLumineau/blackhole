import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ENUM_SOURCE_CONSTANTS_SUBPATH,
  ENUM_SOURCE_VALIDATOR_SUBPATH,
  NON_WAIVABLE_DISCRIMINATOR_FIELDS,
  resolveValidateWorker,
} from './enum-source.ts';

// Trust boundary: an `--enum-source` tree is always a worker's own unreviewed PR worktree
// (`orchestrator-runtime.md` step 1a), so its code must never run. These tests plant a
// validator module whose only job is to prove — via a filesystem side effect — whether it was
// executed, and assert it never is, regardless of what `resolveValidateWorker` reports about
// the tree's declared enums.
describe('resolveValidateWorker — never executes the named tree', () => {
  let treeRoot: string | undefined;
  let markerPath: string | undefined;

  afterEach(() => {
    if (treeRoot) {
      fs.rmSync(treeRoot, { recursive: true, force: true });
      treeRoot = undefined;
    }
    if (markerPath && fs.existsSync(markerPath)) {
      fs.rmSync(markerPath);
    }
    markerPath = undefined;
  });

  function writeTreeWithSideEffectingValidator(): { root: string; marker: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enum-source-exec-guard-'));
    const validatorSubdir = path.dirname(ENUM_SOURCE_VALIDATOR_SUBPATH);
    const validatorDir = path.join(root, validatorSubdir);
    fs.mkdirSync(validatorDir, { recursive: true });

    const marker = path.join(root, 'executed.marker');
    // Top-level side effect. A dynamic `import()` of this file evaluates the module body and
    // writes the marker; static text extraction never does, because it never evaluates the file.
    fs.writeFileSync(
      path.join(root, ENUM_SOURCE_VALIDATOR_SUBPATH),
      [
        "import * as fs from 'fs';",
        `fs.writeFileSync(${JSON.stringify(marker)}, 'executed');`,
        'export function validateWorker() { return []; }',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(validatorDir, 'constants.ts'),
      "export const COMPANION_REPAIR_VCODES = ['V-ADA-01', 'V-ADA-05', 'V-ADA-09', 'V-ADA-99'] as const;\n",
    );

    return { root, marker };
  }

  test('resolving against a tree whose validator module has a top-level side effect never runs it', async () => {
    const { root, marker } = writeTreeWithSideEffectingValidator();
    treeRoot = root;
    markerPath = marker;

    await resolveValidateWorker(root);

    expect(fs.existsSync(marker)).toBe(false);
  });

  test('using the resolved validator afterward still never runs the named tree\'s module', async () => {
    const { root, marker } = writeTreeWithSideEffectingValidator();
    treeRoot = root;
    markerPath = marker;

    const validate = await resolveValidateWorker(root);
    validate('implementer', { status: 'complete' });

    expect(fs.existsSync(marker)).toBe(false);
  });
});

// F-00048 (PR #854 review iteration 2): waiveWidenedEnumErrors matched a waivable error purely on
// (value in some extracted array) AND (real expected-set subset-of that same array), with no
// binding to which field the array represents and no cap on how much larger than the real
// expected set it could be. A worker's own unreviewed `constants.ts` could declare one array
// unioning every real enum member across the whole schema plus a bogus value, waiving a
// completely unrelated invalid-enum error. The fix enforces the docstring's own "exactly one new
// member" invariant: a widened array only waives an error when it is exactly the real `expected`
// set plus the one rejected value — no more.
describe('waiveWidenedEnumErrors — cardinality bound on widened arrays (F-00048)', () => {
  let treeRoot: string | undefined;

  afterEach(() => {
    if (treeRoot) {
      fs.rmSync(treeRoot, { recursive: true, force: true });
      treeRoot = undefined;
    }
  });

  function writeTreeWithConstants(constantsSource: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enum-source-cardinality-'));
    const validatorDir = path.join(root, path.dirname(ENUM_SOURCE_VALIDATOR_SUBPATH));
    fs.mkdirSync(validatorDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, ENUM_SOURCE_VALIDATOR_SUBPATH),
      'export function validateWorker() { return []; }\n',
    );
    fs.writeFileSync(path.join(validatorDir, 'constants.ts'), constantsSource);
    return root;
  }

  test('a kitchen-sink array unioning many real enum members does not waive an unrelated bogus value (recheck PoC)', async () => {
    treeRoot = writeTreeWithConstants(
      [
        'export const KITCHEN_SINK = [',
        "  'complete', 'blocked', 'error', 'partial', 'ready', 'skip', 'design', 'brainstorm',",
        "  'quick', 'standard', 'xs', 's', 'm', 'l', 'xl', 'routed', 'feature', 'bugfix',",
        "  'refactor', 'docs', 'PASS', 'FAIL', 'N/A', 'TOTALLY_BOGUS_STATUS',",
        '] as const;',
        '',
      ].join('\n'),
    );

    const validate = await resolveValidateWorker(treeRoot);
    const errors = validate('implementer', { status: 'TOTALLY_BOGUS_STATUS' });

    expect(errors).toContain(
      'status: invalid enum value "TOTALLY_BOGUS_STATUS" (expected complete|blocked|error|partial)',
    );
  });

  // Iteration 4 (F-00060) makes `status` a non-waivable discriminator (see the dedicated describe
  // block below), so the cardinality-bound regression coverage here moves to a non-discriminator
  // enum — `companion_repairs[].vcode` (`COMPANION_REPAIR_VCODES`) — which is the actual enum
  // issue #738 exists to widen and gates no required-field branch.
  test('a genuinely widened single enum on a non-discriminator field (companion-repair vcode) is still waived — the actual #738 use case', async () => {
    treeRoot = writeTreeWithConstants(
      "export const COMPANION_REPAIR_VCODES = ['V-ADA-01', 'V-ADA-05', 'V-ADA-09', 'V-ADA-77'] as const;\n",
    );

    const validate = await resolveValidateWorker(treeRoot);
    const errors = validate('implementer', {
      status: 'complete',
      pr_number: 1,
      branch: 'blackhole/issue-738',
      tests_passed: true,
      touch_paths_honored: true,
      evidence: { command: 'bun test', result: 'ok' },
      companion_repairs: [{ vcode: 'V-ADA-77', file: 'ARCHITECTURE.md', action: 'add row' }],
    });

    expect(errors).not.toContain(
      'vcode: invalid enum value "V-ADA-77" (expected V-ADA-01|V-ADA-05|V-ADA-09)',
    );
  });
});

// F-00060 (PR #854 review iteration 4): the cardinality bound above is a per-*array* check, not a
// per-*field* check. One `constants.ts` can declare one exactly-sized widened array per field and
// smuggle one bogus value into every enum at once. That matters most for a field a validator uses
// as a branch discriminator — e.g. implementer's `if (data.status === 'complete') { require
// pr_number, branch, tests_passed, touch_paths_honored, evidence }` — because a smuggled value
// matching none of the real branches skips every required-field check those branches gate,
// turning a near-empty stub payload into a zero-error accept. The fix excludes
// `NON_WAIVABLE_DISCRIMINATOR_FIELDS` from the waiver entirely, regardless of cardinality.
describe('waiveWidenedEnumErrors — discriminator fields never waived (F-00060)', () => {
  let treeRoot: string | undefined;

  afterEach(() => {
    if (treeRoot) {
      fs.rmSync(treeRoot, { recursive: true, force: true });
      treeRoot = undefined;
    }
  });

  function writeTreeWithConstants(constantsSource: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enum-source-discriminator-'));
    const validatorDir = path.join(root, path.dirname(ENUM_SOURCE_VALIDATOR_SUBPATH));
    fs.mkdirSync(validatorDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, ENUM_SOURCE_VALIDATOR_SUBPATH),
      'export function validateWorker() { return []; }\n',
    );
    fs.writeFileSync(path.join(validatorDir, 'constants.ts'), constantsSource);
    return root;
  }

  test('recheck PoC: a stub payload with a widened bogus implementer status is rejected, not accepted with zero errors', async () => {
    treeRoot = writeTreeWithConstants(
      "export const IMPLEMENTER_STATUSES = ['complete', 'blocked', 'error', 'partial', 'BOGUS'] as const;\n",
    );

    const validate = await resolveValidateWorker(treeRoot);
    // No pr_number/branch/tests_passed/touch_paths_honored/evidence — exactly the near-empty stub
    // the bypass would have let through by skipping the 'complete' branch's required-field checks.
    const errors = validate('implementer', { status: 'BOGUS' });

    expect(errors).toContain(
      'status: invalid enum value "BOGUS" (expected complete|blocked|error|partial)',
    );
  });

  test('same PoC against planner', async () => {
    treeRoot = writeTreeWithConstants(
      "export const PLANNER_STATUSES = ['ready', 'blocked', 'error', 'partial', 'BOGUS'] as const;\n",
    );

    const validate = await resolveValidateWorker(treeRoot);
    const errors = validate('planner', { status: 'BOGUS' });

    expect(errors).toContain(
      'status: invalid enum value "BOGUS" (expected ready|blocked|error|partial)',
    );
  });

  test('same PoC against reviewer', async () => {
    treeRoot = writeTreeWithConstants(
      "export const REVIEWER_STATUSES = ['complete', 'error', 'partial', 'BOGUS'] as const;\n",
    );

    const validate = await resolveValidateWorker(treeRoot);
    const errors = validate('reviewer', { status: 'BOGUS' });

    expect(errors).toContain('status: invalid enum value "BOGUS" (expected complete|error|partial)');
  });

  test('a non-status discriminator (planner track) is also never waived', async () => {
    treeRoot = writeTreeWithConstants(
      "export const TRACKS = ['quick', 'standard', 'skip', 'design', 'brainstorm', 'BOGUS'] as const;\n",
    );

    const validate = await resolveValidateWorker(treeRoot);
    const errors = validate('planner', {
      status: 'ready',
      track: 'BOGUS',
      plan_path: 'p',
      failing_checks: [],
      clarification_markers: 0,
    });

    expect(errors).toContain(
      'track: invalid enum value "BOGUS" (expected quick|standard|skip|design|brainstorm)',
    );
  });

  // Anti-rot: NON_WAIVABLE_DISCRIMINATOR_FIELDS is hand-maintained (enum-source.ts docstring), so
  // nothing stops a future validator change from adding a new enum-checked field used as a branch
  // discriminator without updating that set. This statically scans the real validator source for
  // that exact shape — `data.<field> ===`/`!==` against a string literal, on a field the same file
  // also enum-checks via `pushEnumError` — and fails the moment one exists outside the set.
  test('NON_WAIVABLE_DISCRIMINATOR_FIELDS is exhaustive against validator source (anti-rot)', () => {
    const validatorsDir = path.join(import.meta.dirname, 'validators');
    const files = fs.readdirSync(validatorsDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    const undeclared: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(validatorsDir, file), 'utf-8');
      const comparedFields = new Set(
        [...source.matchAll(/data\.(\w+)\s*(?:===|!==)\s*['"]/g)].map((m) => m[1]),
      );
      const enumCheckedFields = new Set(
        [...source.matchAll(/pushEnumError\(errors,\s*'(\w+)'/g)].map((m) => m[1]),
      );
      for (const field of comparedFields) {
        if (enumCheckedFields.has(field) && !NON_WAIVABLE_DISCRIMINATOR_FIELDS.has(field)) {
          undeclared.push(`${file}: '${field}'`);
        }
      }
    }

    expect(undeclared).toEqual([]);
  });
});

// F-00049 (PR #854 review iteration 2): the constants.ts read had no size cap and no check that
// the path is a regular file. A symlink to a FIFO or an unbounded device file at that path (fully
// worker-controlled, inside a worktree the worker authored) would hang or OOM the orchestrator's
// synchronous read.
describe('--enum-source constants.ts read guard (F-00049)', () => {
  let treeRoot: string | undefined;

  afterEach(() => {
    if (treeRoot) {
      fs.rmSync(treeRoot, { recursive: true, force: true });
      treeRoot = undefined;
    }
  });

  function writeTreeSkeleton(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enum-source-guard-'));
    const validatorDir = path.join(root, path.dirname(ENUM_SOURCE_VALIDATOR_SUBPATH));
    fs.mkdirSync(validatorDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, ENUM_SOURCE_VALIDATOR_SUBPATH),
      'export function validateWorker() { return []; }\n',
    );
    return root;
  }

  test('refuses a constants.ts that is a symlink rather than a regular file', async () => {
    treeRoot = writeTreeSkeleton();
    const constantsPath = path.join(treeRoot, ENUM_SOURCE_CONSTANTS_SUBPATH);
    const realTarget = path.join(treeRoot, 'real-target.txt');
    fs.writeFileSync(realTarget, "export const X = ['a'] as const;\n");
    fs.symlinkSync(realTarget, constantsPath);

    await expect(resolveValidateWorker(treeRoot)).rejects.toThrow();
  });

  test('refuses a constants.ts larger than the size cap', async () => {
    treeRoot = writeTreeSkeleton();
    const constantsPath = path.join(treeRoot, ENUM_SOURCE_CONSTANTS_SUBPATH);
    fs.writeFileSync(constantsPath, `// ${'x'.repeat(70_000)}\n`);

    await expect(resolveValidateWorker(treeRoot)).rejects.toThrow();
  });
});

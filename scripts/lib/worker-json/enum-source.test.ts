import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ENUM_SOURCE_CONSTANTS_SUBPATH,
  ENUM_SOURCE_VALIDATOR_SUBPATH,
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

  test('a genuinely widened single enum (exactly one new member in the right shape) is still waived', async () => {
    treeRoot = writeTreeWithConstants(
      "export const IMPLEMENTER_STATUSES = ['complete', 'blocked', 'error', 'partial', 'stalled'] as const;\n",
    );

    const validate = await resolveValidateWorker(treeRoot);
    const errors = validate('implementer', { status: 'stalled' });

    expect(errors).not.toContain(
      'status: invalid enum value "stalled" (expected complete|blocked|error|partial)',
    );
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

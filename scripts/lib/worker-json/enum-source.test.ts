import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENUM_SOURCE_VALIDATOR_SUBPATH, resolveValidateWorker } from './enum-source.ts';

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

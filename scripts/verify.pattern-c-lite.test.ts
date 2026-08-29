import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(import.meta.dirname, '..');

describe('Pattern C-lite (#694)', () => {
  test('multitask-mode documents Pattern C-lite opt-in', () => {
    const src = fs.readFileSync(path.join(root, 'src/references/multitask-mode.md'), 'utf-8');
    expect(src).toContain('Pattern C-lite');
    expect(src).toContain('CreateGoal');
  });

  test('ADR-027 exists for design amendment', () => {
    expect(
      fs.existsSync(path.join(root, 'documentation/decisions/ADR-028-cursor-pattern-c-lite.md')),
    ).toBe(true);
  });
});

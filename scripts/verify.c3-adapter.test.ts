import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(import.meta.dirname, '..');

describe('C3 adapter (#693)', () => {
  test('clarify-gates documents harness-neutral C3 adapter table', () => {
    const src = fs.readFileSync(path.join(root, 'src/references/clarify-gates.md'), 'utf-8');
    expect(src).toContain('C3 adapter');
    expect(src).toContain('AskUserQuestion');
    expect(src).toContain('Lettered inline');
  });

  test('model-routing Cursor appendix documents gate-turn preference', () => {
    const src = fs.readFileSync(path.join(root, 'src/references/model-routing.md'), 'utf-8');
    const cursorBlock = src.split('{{#cursor}}')[1]?.split('{{/cursor}}')[0] ?? '';
    expect(cursorBlock).toContain('Gate-turn preference');
    expect(cursorBlock).toContain('composer-2.5');
  });
});

import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(import.meta.dirname, '..');

describe('Cursor harness protocol truth (#692)', () => {
  test('claude-code-native Cursor appendix does not claim absent C1/C3 forever', () => {
    const src = fs.readFileSync(path.join(root, 'src/references/claude-code-native.md'), 'utf-8');
    const cursorBlock = src.split('{{#cursor}}')[1]?.split('{{/cursor}}')[0] ?? '';
    expect(cursorBlock).not.toContain('No native C1/C3');
    expect(cursorBlock).toContain('Detect session primitives');
    expect(cursorBlock).toContain('AskQuestion');
  });

  test('blackhole-protocol Cursor entry documents /goal detect path', () => {
    const src = fs.readFileSync(path.join(root, 'src/references/blackhole-protocol.md'), 'utf-8');
    const cursorBlock = src.split('{{#cursor}}')[1]?.split('{{/cursor}}')[0] ?? '';
    expect(cursorBlock).not.toContain('No `/goal`');
    expect(cursorBlock).toContain('/goal run blackhole until empty');
  });

  test('Claude appendix still documents AskUserQuestion (regression guard)', () => {
    const src = fs.readFileSync(path.join(root, 'src/references/claude-code-native.md'), 'utf-8');
    const claudeBlock = src.split('{{#claude}}')[1]?.split('{{/claude}}')[0] ?? '';
    expect(claudeBlock).toContain('AskUserQuestion');
    expect(claudeBlock).toContain('Workflow');
  });
});

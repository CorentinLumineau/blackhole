import { describe, expect, test } from 'bun:test';
import {
  BUILD_OUTPUT_PATH_MARKERS,
  isBuildOutputPorcelainLine,
  newPorcelainLines,
} from './verify.ts';

describe('isBuildOutputPorcelainLine', () => {
  test('matches known build output paths', () => {
    expect(isBuildOutputPorcelainLine(' M .cursor/agents/bc-planner.md')).toBe(true);
    expect(isBuildOutputPorcelainLine(' M scripts/verify.ts')).toBe(false);
  });

  test('BUILD_OUTPUT_PATH_MARKERS is non-empty', () => {
    expect(BUILD_OUTPUT_PATH_MARKERS.length).toBeGreaterThan(0);
  });
});

describe('newPorcelainLines', () => {
  test('returns lines introduced after build', () => {
    const before = ' M README.md';
    const after = ' M README.md\n M .cursor/agents/bc-planner.md';
    expect(newPorcelainLines(before, after)).toEqual([' M .cursor/agents/bc-planner.md']);
  });

  test('returns empty when porcelain unchanged', () => {
    const porcelain = ' M README.md';
    expect(newPorcelainLines(porcelain, porcelain)).toEqual([]);
  });
});

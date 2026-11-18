import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './fs.ts';
import { appendUsageReading, readUsageHistory } from './usage-history.ts';

const R = (observed_at: number, used_percentage = 10) => ({ observed_at, used_percentage, resets_at: 2_000_000_000 });

describe('usage-history.jsonl', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = makeTempDir('usage-history');
    file = path.join(dir, 'nested', 'usage-history.jsonl');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('a missing file reads as no history; an append creates it', () => {
    expect(readUsageHistory(file)).toEqual([]);
    appendUsageReading(file, R(100, 21));
    expect(readUsageHistory(file)).toEqual([R(100, 21)]);
  });

  test('one reading per observed_at: a repeat probe of the same event replaces it', () => {
    appendUsageReading(file, R(100, 21));
    appendUsageReading(file, R(200, 30));
    appendUsageReading(file, R(100, 22));
    expect(readUsageHistory(file)).toEqual([R(100, 22), R(200, 30)]);
  });

  test('keeps the newest 200 readings, oldest dropped first', () => {
    for (let i = 1; i <= 205; i++) appendUsageReading(file, R(i));
    const kept = readUsageHistory(file);
    expect(kept).toHaveLength(200);
    expect(kept[0].observed_at).toBe(6);
    expect(kept.at(-1)!.observed_at).toBe(205);
  });

  test('torn or foreign lines are skipped on read', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(R(100))}\n{"observed_at":"x"}\nnot json\n${JSON.stringify(R(200))}\n`);
    expect(readUsageHistory(file)).toEqual([R(100), R(200)]);
  });
});

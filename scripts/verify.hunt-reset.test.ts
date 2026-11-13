import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// ADR-053 T1: `hunt <kind> --fresh-territory` resets one kind's watermark so a scheduled hunt
// scans full territory each run. Content gates over the prose specs that own the behavior.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('phase-loop.md — territory reset step', () => {
  const doc = read('src/references/phase-loop.md');

  test('documents the --fresh-territory reset with every reset field', () => {
    for (const marker of ['--fresh-territory', 'Territory reset', 'last_reset_at', 'lifetime_waves', 'requires an explicit kind']) {
      expect(doc).toContain(marker);
    }
  });

  test('the reset runs after the gated-batch no-op check so a no-op turn never writes', () => {
    expect(doc.indexOf('Gated-batch mid-flight no-op')).toBeGreaterThan(-1);
    expect(doc.indexOf('Territory reset')).toBeGreaterThan(doc.indexOf('Gated-batch mid-flight no-op'));
  });
});

describe('SKILL.md — hunt mode and F-HUNT-01 wording', () => {
  const skill = read('src/SKILL.md');

  test('Modes row carries the flag', () => {
    expect(skill).toContain('`hunt [kind] [--fresh-territory]`');
  });

  test('F-HUNT-01 (a) counts waves since the last reset and (c) uses lifetime_waves', () => {
    const row = skill.split('\n').find((l) => l.startsWith('| F-HUNT-01'));
    expect(row).toBeDefined();
    expect(row).toContain('since the last reset');
    expect(row).toContain('lifetime_waves');
  });
});

describe('findings-ledger.md and fixture — additive fields', () => {
  test('field table documents last_reset_at and lifetime_waves', () => {
    const doc = read('src/references/findings-ledger.md');
    expect(doc).toContain('`hunt_state.kinds.<kind>.last_reset_at`');
    expect(doc).toContain('`hunt_state.kinds.<kind>.lifetime_waves`');
  });

  test('orchestrator-dispatch.md notes the full-territory spawn directive after a reset', () => {
    expect(read('src/references/orchestrator-dispatch.md')).toContain('--fresh-territory');
  });

  test('AGENTS.md modes line carries the flag', () => {
    expect(read('AGENTS.md')).toContain('`hunt [kind] [--fresh-territory]`');
  });
});

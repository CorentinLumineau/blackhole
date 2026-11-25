import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(import.meta.dirname, '..');
const WORKER_SHELLS = ['implementer', 'hunter', 'investigator', 'planner', 'reviewer', 'router'];
const TABLE = 'src/references/blackhole-vcodes.md';
const BINDING = /^Binding rules: .*$/m;

const shellLine = (name: string): string => {
  const text = fs.readFileSync(path.join(root, 'src/agents', `${name}.md`), 'utf8');
  const m = text.match(BINDING);
  if (!m) throw new Error(`${name}.md has no Binding rules line`);
  return m[0];
};

// The lookup command a shell tells the worker to run, with {{VCODES_PATH}} bound to the source table.
const lookupCommand = (line: string, family: string): string => {
  const m = line.match(/`(grep [^`]*)`/);
  if (!m) throw new Error(`no grep command in: ${line}`);
  return m[1].replaceAll('{{VCODES_PATH}}', TABLE).replace('V-<FAMILY>-', `V-${family}-`);
};

const run = (cmd: string): string => spawnSync('bash', ['-c', cmd], { cwd: root, encoding: 'utf8' }).stdout;

describe('worker V-code lookup', () => {
  test('every worker shell directs a grep lookup, not a whole-table read', () => {
    for (const name of WORKER_SHELLS) {
      const line = shellLine(name);
      expect(line).toMatch(/`grep -nF 'V-<FAMILY>-' \{\{VCODES_PATH\}\}`/);
      expect(line).toContain('Read the whole table only');
    }
  });

  test('all six shells carry the identical lookup line', () => {
    const lines = new Set(WORKER_SHELLS.map(shellLine));
    expect(lines.size).toBe(1);
  });

  test('table header no longer tells workers to restate the table', () => {
    const head = fs.readFileSync(path.join(root, TABLE), 'utf8').split('| Code |')[0];
    expect(head).not.toMatch(/restate/i);
    expect(head).toContain('grep');
  });

  test('the lookup returns the table row, severity included, for grouped codes', () => {
    const line = shellLine('implementer');
    // Grouped rows: V-SOLID-01/03, V-DRY-02/03, "V-KISS-01 / V-YAGNI-01".
    for (const family of ['SOLID', 'DRY', 'YAGNI', 'SCOPE']) {
      const rows = run(lookupCommand(line, family)).split('\n').filter((r) => r.includes('| '));
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows.filter((x) => x.includes(`:| V-`))) expect(r).toMatch(/\| (BLOCK|WARN|INFO) \|/);
    }
    const yagni = run(lookupCommand(line, 'YAGNI'));
    expect(yagni).toContain('V-KISS-01 / V-YAGNI-01');
    expect(yagni).toMatch(/\| BLOCK \|/);
  });
});

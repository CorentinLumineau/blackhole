import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// ADR-053 T3: PRs that implement a hunt-origin issue carry the `kaizen` label, added through the
// forge-channels row and never through `gh pr edit` (classic-Projects GraphQL failure).

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('implementer.md — kaizen label on hunt-origin PRs', () => {
  const doc = read('src/agents/implementer.md');

  test('states the origin: hunt -> kaizen rule via the forge-channels PR add-label row', () => {
    expect(doc).toContain('`origin: hunt`');
    expect(doc).toContain('label `kaizen`');
    expect(doc).toContain('Add labels to a PR');
  });

  test('a missing label on the forge is logged, not fatal', () => {
    expect(doc).toMatch(/missing[^.]*label[^.]*completion note/i);
  });

  test('never instructs gh pr edit --add-label', () => {
    expect(doc).not.toContain('gh pr edit --add-label');
    expect(doc).not.toMatch(/gh pr edit [^\n]*--add-label/);
  });
});

describe('spawn-context plumbing', () => {
  test('phase-implement.md and orchestrator-delegation.md define origin: hunt from the ledger row', () => {
    for (const rel of ['src/references/phase-implement.md', 'src/references/orchestrator-delegation.md']) {
      const doc = read(rel);
      expect(doc).toContain('`origin: hunt`');
      expect(doc).toContain('deferred_to_issue');
    }
  });

  test('forge-channels.md has a PR add-label row for gh, REST and MCP', () => {
    const row = read('src/references/forge-channels.md')
      .split('\n')
      .find((l) => l.startsWith('| Add labels to a PR'));
    expect(row).toBeDefined();
    expect(row).toContain('gh api');
    expect(row).toContain('POST repos/{repo}/issues/N/labels');
    expect(row).toContain('issue_write');
  });
});

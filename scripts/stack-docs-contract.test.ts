import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ref = (name: string) => readFileSync(join(import.meta.dir, '..', 'src', 'references', name), 'utf8');

const section = (doc: string, heading: string) => {
  const start = doc.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, next);
};

describe('stacked-child conflict recovery doc', () => {
  const body = section(ref('merge-conflict-protocol.md'), '## Stacked child after its parent merges');

  test('names the manual merge a worker must start, since the replay leaves no merge in progress', () => {
    expect(body).toContain('git fetch origin');
    expect(body).toMatch(/git merge origin\/<target_branch>/);
  });
});

describe('queue-dag Step 3 conflict filter', () => {
  const body = section(ref('queue-dag.md'), '### Step 3 — Conflict filter');

  test('does not promise a dispatch-time depth deferral that pickStackParent never makes', () => {
    expect(body).not.toMatch(/stack depth cap\s+is reached/);
    expect(body).toMatch(/stack-check\.ts/);
  });
});

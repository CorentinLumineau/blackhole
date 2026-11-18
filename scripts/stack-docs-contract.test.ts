import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
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

  test('drops REGENERATED_PATHS members from touch_paths before comparing', () => {
    expect(body).toContain('REGENERATED_PATHS');
  });
});

describe('merge-conflict-protocol class 1 root index step', () => {
  const body = section(ref('merge-conflict-protocol.md'), '## Classification rule');

  test('scopes the generate-doc-index regenerate to Scope-1 and sends consumer repos to class 3', () => {
    expect(body).toContain('Scope-1');
    expect(body).toContain('class 3');
  });
});

describe('parent-landed doc rule', () => {
  test('merge-gate § 7 names parent-landed and forbids deciding landing by ancestry', () => {
    const body = section(ref('merge-gate.md'), '## 7. Stacked-child tip capture and post-merge repair');
    expect(body).toContain('parent-landed');
    expect(body).toMatch(/never[^\n]*--is-ancestor/i);
  });

  test('the only --is-ancestor mentions under src/references are the allowlisted ones', () => {
    const dir = join(import.meta.dir, '..', 'src', 'references');
    const hits = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('--is-ancestor'))
      .sort();
    expect(hits).toEqual(['blackhole-state.md', 'merge-gate.md']);
    const prohibitions = ref('merge-gate.md').split('\n').filter((l) => l.includes('--is-ancestor'));
    expect(prohibitions).toHaveLength(1);
    expect(prohibitions[0]).toMatch(/never/i);
  });
});

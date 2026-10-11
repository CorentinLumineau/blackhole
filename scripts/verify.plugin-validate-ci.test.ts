import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Pins the Claude Code plugin-validate CI step added for 2.1.292–2.1.296: `--strict` on the
// native plugin and the marketplace bundle, plus `claude plugin test` only when a tests/ tree
// exists, and only on the free-tier path (self-hosted or push — never a GitHub-hosted PR).
// Resolves the workflow via this file's dirname so the test is not a check-utils consumer
// (V-BLASTRADIUS-01).

const WORKFLOW = path.join(import.meta.dirname, '..', '.github', 'workflows', 'verify.yml');

describe('verify.yml Claude plugin validate step', () => {
  const yaml = fs.readFileSync(WORKFLOW, 'utf-8');

  test('runs claude plugin validate --strict against the repo root and the marketplace bundle', () => {
    expect(yaml).toContain('claude plugin validate --strict .');
    expect(yaml).toContain('claude plugin validate --strict plugins/blackhole-claude');
  });

  test('gates the step to push or self-hosted (free-tier; not GitHub-hosted pull_request)', () => {
    expect(yaml).toMatch(
      /if:\s*github\.event_name == 'push' \|\| runner\.environment == 'self-hosted'/,
    );
    expect(yaml).not.toMatch(/claude plugin validate --strict[\s\S]*if:\s*always\(\)/);
  });

  test('invokes claude plugin test only when a tests/ tree exists', () => {
    expect(yaml).toMatch(/if \[ -d plugins\/blackhole-claude\/tests \] \|\| \[ -d tests \]/);
    expect(yaml).toContain('claude plugin test');
  });
});

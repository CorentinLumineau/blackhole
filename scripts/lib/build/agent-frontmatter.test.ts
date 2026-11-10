import { describe, expect, test } from 'bun:test';
import { stripClaudeOnlyAgentFrontmatter } from './agent-frontmatter.ts';
import { parseMdFrontmatter } from './content.ts';

describe('stripClaudeOnlyAgentFrontmatter', () => {
  const src = `---
name: planner
description: d
model: opus[1m]
permissionMode: default
---

Body says model: opus[1m] in prose.
`;

  test('drops the frontmatter model line and keeps every other key', () => {
    const out = stripClaudeOnlyAgentFrontmatter(src);
    const { frontmatter, body } = parseMdFrontmatter(out);
    expect(frontmatter).not.toMatch(/^model:/m);
    expect(frontmatter).toContain('name: planner');
    expect(frontmatter).toContain('permissionMode: default');
    expect(body).toContain('model: opus[1m] in prose.');
  });

  test('is a no-op on content with no frontmatter model line', () => {
    const noModel = '---\nname: router\n---\n\nbody\n';
    expect(stripClaudeOnlyAgentFrontmatter(noModel)).toBe(noModel);
  });
});

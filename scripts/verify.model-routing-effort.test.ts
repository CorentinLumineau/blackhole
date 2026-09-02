import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Structural tests locking issue #469: reasoning effort folded into model-routing.md tier
// ladders (no parallel bump table or second resolution pass).

const root = path.resolve(import.meta.dirname, '..');
const modelRoutingPath = path.join(root, 'src/references/model-routing.md');
const configTemplatePath = path.join(root, 'src/references/config-template.md');

const readModelRouting = () => fs.readFileSync(modelRoutingPath, 'utf-8');
const readConfigTemplate = () => fs.readFileSync(configTemplatePath, 'utf-8');

describe('model-routing.md — reasoning effort (issue #469)', () => {
  const content = readModelRouting();

  test('disambiguates reasoning effort from V-PARETO-02 effort scoring', () => {
    expect(content).toMatch(/V-PARETO-02/);
    expect(content).toMatch(/reasoning effort/i);
    expect(content).toMatch(/worker-schemas\.md/);
  });

  test('per-tier effort defaults live inside § Harness tier ladders (not a separate bump table)', () => {
    const ladderSection = content.match(/## Harness tier ladders[\s\S]*/)?.[0] ?? '';
    expect(ladderSection).toContain('Default effort');
    expect(ladderSection).toContain('Rationale');
    for (const tier of ['economy', 'standard', 'premium'] as const) {
      expect(ladderSection).toContain(`\`${tier}\``);
    }
    expect(content).not.toMatch(/## Route-derived effort bumps/i);
    expect(content).not.toMatch(/## Effort bumps/i);
  });

  test('spawn footer is a single line including effort', () => {
    expect(content).toMatch(
      /MODEL_TIER:.*\|.*slug:.*\|.*effort:/,
    );
    const footerMatch = content.match(/```\n(MODEL_TIER:[^\n]+)\n```/);
    expect(footerMatch).not.toBeNull();
    expect(footerMatch![1]).toContain('effort:');
    expect(footerMatch![1].split('\n').length).toBe(1);
  });

  test('spawn checklist includes effort resolution step', () => {
    const checklistMatch = content.match(/## Spawn checklist\n([\s\S]*?)(\n## |\nSee )/);
    expect(checklistMatch).not.toBeNull();
    const checklist = checklistMatch![1];
    expect(checklist).toMatch(/effort/i);
    expect(checklist).toMatch(/worker_effort_policy|cost-optimized/);
  });

  test('Workflow-tool pin table includes effort guidance', () => {
    const workflowSection = content.match(/## Workflow-tool enforcement[\s\S]*/)?.[0] ?? '';
    expect(workflowSection).toMatch(/effort/i);
    expect(workflowSection).toMatch(/agent\(\)/);
  });

  test('documents harness-specific unpinned behavior and Claude Code agent() limitation', () => {
    expect(content).toMatch(/#68042/);
    expect(content).not.toMatch(/provider default/i);
    expect(content).toMatch(/not portable|per-harness|harness-native/i);
  });

  test('documents skills.sh/generic effort policy as inherit, backed by a live build.test.ts citation (issue #746)', () => {
    const skillsBlock = content.match(/\{\{#skills\}\}([\s\S]*?)\{\{\/skills\}\}/)?.[1] ?? '';
    expect(skillsBlock).toMatch(/inherit/i);
    expect(skillsBlock).not.toMatch(/unverified/i);
    expect(skillsBlock).toMatch(/scripts\/build\.test\.ts/);
    expect(skillsBlock).toMatch(/applyPlatformConditionals/);

    // The citation must resolve to real, currently-existing coverage, not just a claim in
    // prose: the cited build.test.ts test must still exist and still target 'skills'.
    const buildTestContent = fs.readFileSync(path.join(root, 'scripts/build.test.ts'), 'utf-8');
    expect(buildTestContent).toMatch(/skills target resolves model-routing\.md/);
    expect(buildTestContent).toContain("'skills'");
  });
});

describe('config-template.md — worker_effort_policy (issue #469)', () => {
  const template = readConfigTemplate();

  test('example JSON includes worker_effort_policy', () => {
    const jsonBlockMatch = template.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonBlockMatch).not.toBeNull();
    expect(jsonBlockMatch![1]).toContain('"worker_effort_policy"');
  });

  test('field table documents worker_effort_policy', () => {
    expect(template).toMatch(/\| `worker_effort_policy` \|/);
    expect(template).toMatch(/inherit/);
    expect(template).toMatch(/cost-optimized/);
  });
});

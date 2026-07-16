import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Regression/structural tests locking in Milestone 1's autonomy contract (ADR-010):
// the config schema, confidence-gates kernel, and durable-artifact contract must keep
// carrying the exact field/dimension/route names other Milestone 2+ work will bind to.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('fixtures/config.example.json — autonomy block', () => {
  const config = JSON.parse(read('fixtures/config.example.json'));

  test('parses as valid JSON', () => {
    expect(config).toBeTypeOf('object');
  });

  test('autonomy.enabled defaults to false (opt-in, like kaizen)', () => {
    expect(config.autonomy).toBeTypeOf('object');
    expect(config.autonomy.enabled).toBe(false);
  });
});

describe('config-template.md — autonomy sub-field documentation', () => {
  const template = read('src/references/config-template.md');

  test('documents the autonomy block', () => {
    expect(template).toContain('autonomy');
  });

  test.each([
    'confidence_threshold',
    'design_dominance_delta',
    'design_autonomy',
    'analyze_routing',
    'brainstorm_routing',
    'never_bypass',
  ])('documents autonomy.%s', (field) => {
    expect(template).toContain(field);
  });
});

describe('confidence-gates.md — dimension kernel and never-bypass contract', () => {
  test('reference file exists', () => {
    expect(fs.existsSync(path.join(root, 'src/references/confidence-gates.md'))).toBe(true);
  });

  const gates = read('src/references/confidence-gates.md');

  test.each([
    'Problem Understanding',
    'Context Completeness',
    'Technical Clarity',
    'Scope Definition',
    'Risk Awareness',
  ])('documents the %s dimension', (dimension) => {
    expect(gates).toContain(dimension);
  });

  test('documents confidence_threshold', () => {
    expect(gates).toContain('confidence_threshold');
  });

  test.each(['destructive', 'credentials', 'epic-go-no-go'])(
    'documents the never_bypass value %s',
    (value) => {
      expect(gates).toContain(value);
    }
  );
});

describe('artifact-contract.md — route → artifact table', () => {
  test('reference file exists', () => {
    expect(fs.existsSync(path.join(root, 'src/references/artifact-contract.md'))).toBe(true);
  });

  const contract = read('src/references/artifact-contract.md');

  test.each(['analyze', 'brainstorm', 'design', 'investigate'])(
    'documents the %s route',
    (routeName) => {
      expect(contract).toContain(routeName);
    }
  );
});

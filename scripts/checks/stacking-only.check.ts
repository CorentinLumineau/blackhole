import * as fs from 'fs';
import * as path from 'path';
import { read, root, type CheckResult } from './check-utils.ts';
import { readJsonFile } from '../lib/fs.ts';
import { flattenConfigKeys, parseConfigTemplateKeys } from './config-registration.check.ts';

// Stacking is the only behavior (ADR-051): no config key may turn it off, and the four docs that
// describe merging agree on it. A key whose name has a `stack` segment in the config template or
// in a config fixture is the opt-out the requirement forbids, so it fails here rather than in review.

export const CANONICAL_SENTENCE = 'Stacking is the only behavior: no config key turns it off.';

const DOC_DIR = 'src/references';
const DEFINING_DOC = 'queue-dag.md';
const CITING_DOCS = ['merge-gate.md', 'config-template.md', 'phase-loop.md'];

export const findStackingOptOutKeys = (keys: string[]): string[] =>
  keys.filter((k) => k.split('.').some((segment) => /stack/i.test(segment)));

/** The defining doc carries the whole sentence; the others cite it by its opening words. */
export const findDocsMissingSentence = (docs: Record<string, string>): string[] =>
  [DEFINING_DOC, ...CITING_DOCS].filter((name) => {
    const content = docs[name] ?? '';
    return name === DEFINING_DOC ? !content.includes(CANONICAL_SENTENCE) : !/stacking is the only behavior/i.test(content);
  });

export type StackingOnlyInput = {
  templateContent: string;
  configs: Record<string, unknown>[];
  docs: Record<string, string>;
};

export const evaluateStackingOnly = ({ templateContent, configs, docs }: StackingOnlyInput): CheckResult => {
  const keys = [...parseConfigTemplateKeys(templateContent), ...configs.flatMap((c) => flattenConfigKeys(c))];
  const optOuts = findStackingOptOutKeys(keys);
  const missing = findDocsMissingSentence(docs);
  const problems = [
    ...(optOuts.length ? [`opt-out config key(s): ${optOuts.join(', ')}`] : []),
    ...(missing.length ? [`doc(s) without the stacking-only sentence: ${missing.join(', ')}`] : []),
  ];
  return problems.length ? { id: 'V-STACK-03', ok: false, detail: problems.join('; ') } : { id: 'V-STACK-03', ok: true };
};

// Committed config files only; the live `.blackhole/config.json` is gitignored and absent in CI.
const configFiles = (): string[] => {
  const dir = path.join(root, 'fixtures');
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^config.*\.json$/.test(f)).map((f) => path.join(dir, f))
    : [];
};

const checkStackingOnly = (): CheckResult =>
  evaluateStackingOnly({
    templateContent: read(`${DOC_DIR}/config-template.md`),
    configs: configFiles().map((f) => readJsonFile(f, f) as Record<string, unknown>),
    docs: Object.fromEntries([DEFINING_DOC, ...CITING_DOCS].map((name) => [name, read(`${DOC_DIR}/${name}`)])),
  });

export const runChecks = (): CheckResult[] => [checkStackingOnly()];

import * as fs from 'fs';
import * as path from 'path';
import { read, root, type CheckResult } from './check-utils.ts';

// ADR-007 T5/R2' — config-registration.check.ts: matches verify.config-registration.test.ts.
//
// V-CONFIG-02: keys present in committed `.blackhole/config.json` must appear in
// `config-template.md`'s field table (dot-path notation for nested keys).

const stripCell = (cell: string): string => cell.replace(/^`+|`+$/g, '').trim();

export const parseConfigTemplateKeys = (content: string): Set<string> => {
  const keys = new Set<string>();
  let inTable = false;
  for (const line of content.split('\n')) {
    if (/^\| Field \| Required \| Description \|/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable && /^\|[-| ]+\|/.test(line)) continue;
    if (inTable && line.startsWith('|')) {
      const cols = line.split('|').map((c) => c.trim());
      const field = cols[1] ? stripCell(cols[1]) : '';
      if (field && field !== 'Field') keys.add(field);
    } else if (inTable && line.trim() && !line.startsWith('|')) {
      break;
    }
  }
  return keys;
};

export const flattenConfigKeys = (obj: Record<string, unknown>, prefix = ''): string[] => {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const dotted = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenConfigKeys(v as Record<string, unknown>, dotted));
    } else {
      keys.push(dotted);
    }
  }
  return keys;
};

export const findUnregisteredConfigKeys = (configKeys: string[], templateKeys: Set<string>): string[] =>
  configKeys.filter((k) => !templateKeys.has(k));

const configPath = path.join(root, '.blackhole', 'config.json');

const checkConfigRegistration = (): CheckResult => {
  const templateKeys = parseConfigTemplateKeys(read('src/references/config-template.md'));
  if (!fs.existsSync(configPath)) {
    return { id: 'V-CONFIG-02', ok: true };
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  const unregistered = findUnregisteredConfigKeys(flattenConfigKeys(config), templateKeys);
  if (unregistered.length) {
    return {
      id: 'V-CONFIG-02',
      ok: false,
      detail: `keys in .blackhole/config.json absent from config-template.md: ${unregistered.join(', ')}`,
    };
  }
  return { id: 'V-CONFIG-02', ok: true };
};

export const runChecks = (): CheckResult[] => [checkConfigRegistration()];

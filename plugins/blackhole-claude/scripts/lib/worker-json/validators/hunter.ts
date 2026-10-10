import {
  HUNTER_SEVERITIES,
  HUNTER_STATUSES,
  HUNTER_VERIFICATIONS,
} from '../constants.ts';
import {
  isBoolean,
  isGainEffortScore,
  isNonEmptyString,
  isNumber,
  isObject,
  isString,
  isStringArray,
  pushEnumError,
  requireField,
} from '../predicates.ts';
import { validateArrayOf, validatePartialResult } from '../shared-validators.ts';

function validateHunterFinding(finding: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(finding)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, finding, 'kind', isNonEmptyString, 'non-empty string');
  requireField(errors, finding, 'file', isString, 'string');
  requireField(errors, finding, 'line', isNumber, 'number');
  requireField(errors, finding, 'summary', isString, 'string');
  requireField(errors, finding, 'evidence_snippet', isString, 'string');
  requireField(errors, finding, 'rationale', isString, 'string');
  requireField(errors, finding, 'gain', isGainEffortScore, 'number (1-10)');
  requireField(errors, finding, 'effort', isGainEffortScore, 'number (1-10)');
  requireField(errors, finding, 'severity', isString, 'string');
  if (isString(finding.severity)) {
    pushEnumError(errors, `${path}.severity`, finding.severity, HUNTER_SEVERITIES);
  }
  requireField(errors, finding, 'verification', isString, 'string');
  if (isString(finding.verification)) {
    pushEnumError(errors, `${path}.verification`, finding.verification, HUNTER_VERIFICATIONS);
  }

  return errors;
}

function validateHunterFindingsArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateHunterFinding);
}

function validateHunterTerritory(territory: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(territory)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, territory, 'bands_scanned', isStringArray, 'string[]');
  requireField(errors, territory, 'exhausted', isBoolean, 'boolean');

  return errors;
}

export function validateHunter(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, HUNTER_STATUSES);
  }

  // Issue #492 — stop --now leg B: `partial` skips the `kind`/`findings` shape entirely
  // (`worker-schemas.md` § Partial result — not a smaller `complete`).
  if (data.status === 'partial') {
    errors.push(...validatePartialResult(data));
    return errors;
  }

  requireField(errors, data, 'kind', isNonEmptyString, 'non-empty string');

  if (data.status === 'complete') {
    requireField(errors, data, 'wave', isNumber, 'number');
    if (!('territory' in data)) {
      errors.push('territory: required');
    } else {
      errors.push(...validateHunterTerritory(data.territory, 'territory'));
    }
    if (!('findings' in data)) {
      errors.push('findings: required');
    } else {
      errors.push(...validateHunterFindingsArray(data.findings, 'findings'));
    }
  } else if (data.status === 'error') {
    requireField(errors, data, 'error', isString, 'string');
    if (!('findings' in data)) {
      errors.push('findings: required');
    } else {
      errors.push(...validateHunterFindingsArray(data.findings, 'findings'));
    }
  }

  return errors;
}

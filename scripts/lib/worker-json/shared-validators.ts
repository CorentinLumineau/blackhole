import { AC_VERDICTS, CAPTURE_STATUSES, DECISION_RECORD_KINDS, SEVERITIES } from './constants.ts';
import {
  isNonEmptyString,
  isNumber,
  isObject,
  isString,
  isStringArray,
  pushEnumError,
  requireField,
} from './predicates.ts';

export function validateArrayOf(
  value: unknown,
  path: string,
  validateEntry: (entry: unknown, entryPath: string) => string[],
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return errors;
  }
  value.forEach((entry, index) => {
    errors.push(...validateEntry(entry, `${path}[${index}]`));
  });
  return errors;
}

export function validateFinding(finding: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(finding)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, finding, 'vcode', isString, 'string');
  requireField(errors, finding, 'severity', isString, 'string');
  if (isString(finding.severity)) {
    pushEnumError(errors, `${path}.severity`, finding.severity, SEVERITIES);
  }
  requireField(errors, finding, 'file', isString, 'string');
  requireField(errors, finding, 'line', isNumber, 'number');
  requireField(errors, finding, 'summary', isString, 'string');

  if (finding.vcode === 'V-PARETO-02') {
    requireField(errors, finding, 'gain', isNumber, 'number');
    requireField(errors, finding, 'effort', isNumber, 'number');
  }

  return errors;
}

export function validateFindingsArray(value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return errors;
  }
  value.forEach((finding, index) => {
    errors.push(...validateFinding(finding, `${path}[${index}]`));
  });
  return errors;
}

export function validateDecisionRecord(record: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(record)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, record, 'kind', isString, 'string');
  if (isString(record.kind)) {
    pushEnumError(errors, 'kind', record.kind, DECISION_RECORD_KINDS);
  }
  requireField(errors, record, 'touch_paths', isStringArray, 'string[]');
  requireField(errors, record, 'decision', isNonEmptyString, 'non-empty string');
  requireField(errors, record, 'why', isNonEmptyString, 'non-empty string');

  if (!isNumber(record.pr) && !isNumber(record.issue)) {
    errors.push('pr/issue: exactly one of pr or issue is required');
  }

  return errors.map((error) => `${path}.${error}`);
}

export function validateDecisionRecordsArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateDecisionRecord);
}

export function validateAcResult(row: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(row)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, row, 'criterion', isNonEmptyString, 'non-empty string');
  requireField(errors, row, 'check', isNonEmptyString, 'non-empty string');
  requireField(errors, row, 'result', isNonEmptyString, 'non-empty string');
  requireField(errors, row, 'verdict', isString, 'string');
  if (isString(row.verdict)) {
    pushEnumError(errors, 'verdict', row.verdict, AC_VERDICTS);
  }

  return errors.map((error) => `${path}.${error}`);
}

export function validateAcResultsArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateAcResult);
}

export function validateVisualEvidenceEntry(entry: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(entry)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, entry, 'target', isNumber, 'number');
  requireField(errors, entry, 'capture_status', isString, 'string');
  if (isString(entry.capture_status)) {
    pushEnumError(errors, 'capture_status', entry.capture_status, CAPTURE_STATUSES);
  }

  if (entry.capture_status === 'captured') {
    requireField(errors, entry, 'path', isNonEmptyString, 'non-empty string');
    requireField(errors, entry, 'route', isNonEmptyString, 'non-empty string');
    requireField(errors, entry, 'state', isNonEmptyString, 'non-empty string');
  }

  if (entry.capture_status === 'unavailable') {
    requireField(errors, entry, 'note', isNonEmptyString, 'non-empty string');
  }

  return errors.map((error) => `${path}.${error}`);
}

export function validateVisualEvidenceArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateVisualEvidenceEntry);
}

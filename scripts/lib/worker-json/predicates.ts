export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && !Number.isNaN(item));
}

export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

export function isGainEffortScore(value: unknown): value is number {
  return isNumber(value) && value >= 1 && value <= 10;
}

export function isEvidence(value: unknown): value is { command: string; result: string } {
  return isObject(value) && isNonEmptyString(value.command) && isNonEmptyString(value.result);
}

export function isConfidenceScore(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 100;
}

export function pushEnumError(errors: string[], field: string, value: unknown, allowed: readonly string[]) {
  if (!allowed.includes(String(value))) {
    errors.push(`${field}: invalid enum value "${String(value)}" (expected ${allowed.join('|')})`);
  }
}

export function requireField(
  errors: string[],
  obj: Record<string, unknown>,
  field: string,
  predicate: (value: unknown) => boolean,
  typeLabel: string,
) {
  if (!(field in obj)) {
    errors.push(`${field}: required`);
    return;
  }
  if (!predicate(obj[field])) {
    errors.push(`${field}: expected ${typeLabel}`);
  }
}

import { describe, expect, test } from 'bun:test';
import { parseFlags, requireFlag } from './argv-flags.ts';

describe('parseFlags', () => {
  test('a normal --flag value pair parses to a string value', () => {
    expect(parseFlags(['--flag', 'value'])).toEqual({ flag: 'value' });
  });

  test('a boolean flag with no trailing value parses to true', () => {
    expect(parseFlags(['--flag'])).toEqual({ flag: true });
  });

  test('a boolean flag followed by end-of-argv parses to true', () => {
    expect(parseFlags(['--tmp', 'x', '--flag'])).toEqual({ tmp: 'x', flag: true });
  });

  // The load-bearing fix: a flag immediately followed by another flag name must never swallow
  // that flag's name as a string value.
  test('a flag immediately followed by another flag name binds boolean true, never the flag name as a string', () => {
    expect(parseFlags(['--entity-key', '--live', '/x'])).toEqual({
      'entity-key': true,
      live: '/x',
    });
    expect(parseFlags(['--entity-key', '--live', '/x'])).not.toEqual({
      'entity-key': '--live',
    });
  });

  test('a non-flag leading token is skipped', () => {
    expect(parseFlags(['positional', '--flag', 'value'])).toEqual({ flag: 'value' });
  });
});

describe('requireFlag', () => {
  test('returns the string value when present', () => {
    expect(requireFlag({ flag: 'value' }, 'flag')).toBe('value');
  });

  test('throws when the value is the boolean true', () => {
    expect(() => requireFlag({ flag: true }, 'flag')).toThrow('missing required flag --flag');
  });

  test('throws when the flag is absent entirely', () => {
    expect(() => requireFlag({}, 'flag')).toThrow('missing required flag --flag');
  });
});

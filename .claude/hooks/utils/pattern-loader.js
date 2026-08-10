#!/usr/bin/env bun
'use strict';

/**
 * pattern-loader.js — compiles the JSON pattern data shipped alongside this file into RegExps.
 *
 * Patterns are data, never inlined conditionals: adding one is a JSON edit, not a source change.
 * Paths resolve against __dirname, not ${CLAUDE_PLUGIN_ROOT} — only hooks.json's `command` field
 * needs the plugin root, to locate the entry script; once running, the tree is self-locating.
 *
 * Every function here throws on malformed data, and callers translate that into a refusal: a
 * validator that cannot read its patterns cannot tell a safe call from a dangerous one. That
 * fail-closed trade-off is only safe because scripts/checks/hooks.check.ts validates both pattern
 * files at `bun run scripts/verify.ts` time, so malformed data never reaches a shipped build.
 */

const fs = require('fs');
const path = require('path');

const PATTERNS_DIR = path.join(__dirname, '..', 'patterns');

const compileEntry = (entry, label) => {
  if (!entry || typeof entry.id !== 'string' || typeof entry.pattern !== 'string') {
    throw new Error(`${label}: entry is missing "id" or "pattern"`);
  }
  return {
    id: entry.id,
    reason: entry.reason || entry.id,
    regex: new RegExp(entry.pattern, entry.flags || ''),
  };
};

const compileList = (data, key, label) => {
  const list = data[key];
  if (!Array.isArray(list)) throw new Error(`${label}: "${key}" is not an array`);
  return list.map((entry) => compileEntry(entry, `${label}.${key}`));
};

const readPatternFile = (name) => {
  const data = JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, name), 'utf-8'));
  if (data.version !== 1) throw new Error(`${name}: unsupported pattern schema version ${data.version}`);
  return data;
};

const loadBashPatterns = () => {
  const data = readPatternFile('bash-patterns.json');
  return {
    blockPatterns: compileList(data, 'blockPatterns', 'bash-patterns.json'),
    warnPatterns: compileList(data, 'warnPatterns', 'bash-patterns.json'),
  };
};

const loadFilePatterns = () => {
  const data = readPatternFile('file-patterns.json');
  return {
    blockedSystemPaths: compileList(data, 'blockedSystemPaths', 'file-patterns.json'),
    pathTraversal: compileList(data, 'pathTraversal', 'file-patterns.json'),
    sensitiveFiles: compileList(data, 'sensitiveFiles', 'file-patterns.json'),
  };
};

/** First compiled entry whose regex matches `value`, or null when nothing matches. */
const matchFirst = (value, compiled) => {
  if (!value) return null;
  for (const entry of compiled) {
    entry.regex.lastIndex = 0;
    if (entry.regex.test(value)) return entry;
  }
  return null;
};

module.exports = { PATTERNS_DIR, loadBashPatterns, loadFilePatterns, matchFirst };

import { describe, expect, test } from 'bun:test';
import { headingSectionsOnce, markdownHeadings, sectionEnd } from './markdown-headings.ts';

describe('markdownHeadings()', () => {
  test('reads level and text, and skips `#` lines inside fenced code blocks', () => {
    const lines = ['# Top', 'text', '```bash', '# a comment', '```', '~~~', '## not a heading', '~~~', '### Deep one'];
    expect(markdownHeadings(lines)).toEqual([
      { line: 0, level: 1, text: 'Top' },
      { line: 8, level: 3, text: 'Deep one' },
    ]);
  });

  test('a `#` with no following space is not a heading', () => {
    expect(markdownHeadings(['#hashtag', '#### Four'])).toEqual([{ line: 1, level: 4, text: 'Four' }]);
  });
});

describe('sectionEnd()', () => {
  const lines = ['## A', 'x', '### A.1', 'y', '## B', 'z'];
  const headings = markdownHeadings(lines);

  test('a section ends at the next heading of the same or a higher level', () => {
    expect(sectionEnd(headings, headings[0], lines.length)).toBe(4);
    expect(sectionEnd(headings, headings[1], lines.length)).toBe(4);
  });

  test('the last section runs to the end of the file', () => {
    expect(sectionEnd(headings, headings[2], lines.length)).toBe(6);
  });
});

describe('headingSectionsOnce()', () => {
  const doc = ['# Wrap stop', 'w', '## Main', 'm', '### Inner stop', 'i', '## Other stop', 'o'].join('\n');
  const isMain = (h: { text: string }) => h.text === 'Main';
  const isStop = (h: { text: string }) => /stop/.test(h.text);

  test('the primary section is always returned in full, even inside a wrapping section', () => {
    expect(headingSectionsOnce(doc, isMain, isStop).primary?.text).toBe('## Main\nm\n### Inner stop\ni');
  });

  test('other sections blank the lines an earlier section covered, so each line is taken once', () => {
    const others = headingSectionsOnce(doc, isMain, isStop).others.map((s) => s.text);
    expect(others).toEqual(['# Wrap stop\nw\n\n\n\n\n## Other stop\no', '\n', '\n']);
  });

  test('no primary heading returns null and no sections', () => {
    expect(headingSectionsOnce(doc, () => false, isStop)).toEqual({ primary: null, others: [] });
  });
});

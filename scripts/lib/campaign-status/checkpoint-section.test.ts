import { describe, expect, test } from 'bun:test';
import { checkpointSection } from './dashboard.ts';
import { buildBlockers, buildHeadline } from './overview.ts';
import type { StageCounts } from './types.ts';

// A checkpoint section is a heading at the start of a line. A heading named inside a sentence
// (a note that mentions `## Headline`) is prose and starts no section.

const COUNTS: StageCounts = { done: 2, in_review: 1, on_you: 0, blocked: 0, parked: 0, not_started: 1, total: 4 };

const checkpoint = [
  '# Campaign Checkpoint',
  '',
  '## Notes',
  '',
  '- The `## Headline` section is rewritten each turn; the `## Blocking the run` list too.',
  '- Second note.',
  '',
  '## Ready set',
  '',
  '- #12',
  '',
].join('\n');

describe('checkpointSection', () => {
  test('a heading named mid-line is not a section', () => {
    expect(checkpointSection(checkpoint, 'Headline')).toBeNull();
    expect(checkpointSection(checkpoint, 'Blocking the run')).toBeNull();
  });

  test('a real heading after a mid-line mention still wins, and the mention stays in the section before it', () => {
    const body = `${checkpoint}\n## Headline\n\nPayments is nearly done.\n\n## Blocking the run\n\n- Vendor SDK 4.0 is not out\n`;
    expect(checkpointSection(body, 'Headline')).toBe('Payments is nearly done.');
    expect(checkpointSection(body, 'Blocking the run')).toBe('- Vendor SDK 4.0 is not out');
    expect(checkpointSection(body, 'Notes')).toContain('`## Headline` section is rewritten');
  });

  test('a section ends at the next line-anchored heading, not at a mid-line one', () => {
    const body = '## Notes\n\nSee `## Ready set` below.\n\nmore\n\n## Ready set\n\n- #1\n';
    expect(checkpointSection(body, 'Notes')).toBe('See `## Ready set` below.\n\nmore');
  });

  test('the heading on the first line, and a heading with trailing blanks, both match', () => {
    expect(checkpointSection('## Headline  \nOne line.\n', 'Headline')).toBe('One line.');
  });
});

describe('the page header reads line-anchored sections only', () => {
  test('a note that mentions ## Headline does not become the headline', () => {
    expect(buildHeadline(checkpoint, COUNTS, null)).toEqual({ text: '2 of 4 done; 1 in review, 1 not started.', source: 'generated' });
  });

  test('a note that mentions ## Blocking the run does not become the blockers', () => {
    const out = buildBlockers(checkpoint, [], [], true, []);
    expect(out.every((b) => b.source === 'generated')).toBe(true);
    expect(out.map((b) => b.text).join('\n')).not.toContain('rewritten');
  });
});

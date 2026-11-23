// Markdown heading scan for verify checks that slice a doc into heading-bounded sections.

export type MarkdownHeading = { line: number; level: number; text: string };

// Fence delimiters follow CommonMark: a run of 3+ backticks or tildes opens a block, and only a
// run of the same character, at least as long, with nothing after it, closes it. The opening
// indent is not capped at 3 spaces, because a fence nested in a list item is indented further.
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
// CommonMark ATX heading: 0-3 spaces indent, 1-6 `#`, then space/tab and text, optional closing `#`s.
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

const withoutCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);

/** Per-line fence mask plus the opening marker of a fence still open at end of input. */
const scanFences = (lines: string[]): { mask: boolean[]; open: string | null } => {
  let open: string | null = null;
  const mask = lines.map((raw) => {
    const line = withoutCr(raw);
    if (open === null) {
      const opening = FENCE_OPEN.exec(line)?.[1];
      if (!opening) return false;
      open = opening;
      return true;
    }
    const closing = FENCE_CLOSE.exec(line)?.[1];
    if (closing && closing[0] === open[0] && closing.length >= open.length) open = null;
    return true;
  });
  return { mask, open };
};

/**
 * Per line: true for a fence delimiter or a line inside a fenced code block. An unterminated
 * fence runs to the end of the input, as in CommonMark.
 */
export const fencedLineMask = (lines: string[]): boolean[] => scanFences(lines).mask;

/** The opening marker (e.g. "```") of a fence left open at the end of `lines`, or null. */
export const openFenceAtEnd = (lines: string[]): string | null => scanFences(lines).open;

/** Every CommonMark ATX heading in `lines`, skipping `#` lines inside fenced code blocks. */
export const markdownHeadings = (lines: string[]): MarkdownHeading[] => {
  const fenced = fencedLineMask(lines);
  return lines.flatMap((line, i) => {
    const match = fenced[i] ? null : HEADING.exec(withoutCr(line));
    return match ? [{ line: i, level: match[1].length, text: match[2].trim() }] : [];
  });
};

/** The line index where `heading`'s section ends: the next heading of the same or a higher level. */
export const sectionEnd = (headings: MarkdownHeading[], heading: MarkdownHeading, lineCount: number): number => {
  const next = headings.find((h) => h.line > heading.line && h.level <= heading.level);
  return next ? next.line : lineCount;
};

export type HeadingSection = { heading: MarkdownHeading; text: string };

/**
 * The `primary` heading's section in full, then every other heading matching `matches`, in
 * document order, with the lines an earlier section already covered blanked — so each line lands
 * in exactly one section. `primary` is null when no heading satisfies `isPrimary`.
 */
export const headingSectionsOnce = (
  content: string,
  isPrimary: (h: MarkdownHeading) => boolean,
  matches: (h: MarkdownHeading) => boolean,
): { primary: HeadingSection | null; others: HeadingSection[] } => {
  const lines = content.split('\n');
  const headings = markdownHeadings(lines);
  const main = headings.find(isPrimary);
  if (!main) return { primary: null, others: [] };
  const covered = new Set<number>();
  const take = (heading: MarkdownHeading): HeadingSection => {
    const kept: string[] = [];
    for (let i = heading.line; i < sectionEnd(headings, heading, lines.length); i++) {
      kept.push(covered.has(i) ? '' : lines[i]);
      covered.add(i);
    }
    return { heading, text: kept.join('\n') };
  };
  const primary = take(main);
  const others = headings.filter((h) => h !== main && matches(h)).map(take);
  return { primary, others };
};

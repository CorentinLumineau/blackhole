// Markdown heading scan for verify checks that slice a doc into heading-bounded sections.

export type MarkdownHeading = { line: number; level: number; text: string };

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^(#{1,6}) (.*)$/;

/** Per line: true for a fence delimiter or a line inside a fenced code block. */
export const fencedLineMask = (lines: string[]): boolean[] => {
  let inFence = false;
  return lines.map((line) => {
    if (!FENCE.test(line)) return inFence;
    inFence = !inFence;
    return true;
  });
};

/** Every ATX heading in `lines`, skipping `#` lines inside fenced code blocks. */
export const markdownHeadings = (lines: string[]): MarkdownHeading[] => {
  const fenced = fencedLineMask(lines);
  return lines.flatMap((line, i) => {
    const match = fenced[i] ? null : HEADING.exec(line);
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

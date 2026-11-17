// Markdown heading scan for verify checks that slice a doc into heading-bounded sections.

export type MarkdownHeading = { line: number; level: number; text: string };

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^(#{1,6}) (.*)$/;

/** Every ATX heading in `lines`, skipping `#` lines inside fenced code blocks. */
export const markdownHeadings = (lines: string[]): MarkdownHeading[] => {
  let inFence = false;
  return lines.flatMap((line, i) => {
    if (FENCE.test(line)) inFence = !inFence;
    const match = inFence ? null : HEADING.exec(line);
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

import * as fs from 'fs';

interface TranscriptContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: { message?: unknown };
}

interface TranscriptLine {
  type?: string;
  message?: {
    id?: string;
    content?: TranscriptContentBlock[];
  };
}

/**
 * Groups the `type: "assistant"` lines of a raw subagent `.jsonl` transcript into turns:
 * consecutive lines sharing one `message.id` are one turn, since a single assistant message
 * may be written across several lines. Each line is parsed independently, so a truncated
 * leading line from a byte-tail read (`readTranscriptTail`) is skipped.
 */
function assistantContentBlocks(jsonl: string): TranscriptContentBlock[][] {
  const turns: TranscriptContentBlock[][] = [];
  let lastId: string | undefined;

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }

    if (parsed?.type !== 'assistant') {
      continue;
    }

    const content = parsed.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    const id = parsed.message?.id;
    if (id !== undefined && id === lastId && turns.length > 0) {
      turns[turns.length - 1].push(...blocks);
    } else {
      turns.push([...blocks]);
    }
    lastId = id;
  }

  return turns;
}

function turnText(blocks: TranscriptContentBlock[]): string | null {
  const text = blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  return text.length > 0 ? text : null;
}

function turnHandback(blocks: TranscriptContentBlock[]): string | null {
  let message: string | null = null;
  for (const block of blocks) {
    if (block.type === 'tool_use' && block.name === HANDBACK_TOOL_NAME && typeof block.input?.message === 'string') {
      message = block.input.message;
    }
  }
  return message;
}

/**
 * Isolates the final `type: "assistant"` turn's text from a raw Claude Code
 * subagent `.jsonl` transcript (one JSON envelope per line). Each line is
 * parsed independently so a truncated leading line from a byte-tail read
 * (`readTranscriptTail`) is skipped rather than aborting the whole scan.
 * Returns `null` when no assistant line exists, or the last one carries no
 * text content (e.g. a final turn that is only a tool call) — a text-less
 * last turn is not a recoverable return, so this deliberately does not fall
 * back to an earlier assistant turn.
 */
export function extractLastAssistantText(jsonl: string): string | null {
  const turns = assistantContentBlocks(jsonl);
  return turns.length > 0 ? turnText(turns[turns.length - 1]) : null;
}

/** The tool a Claude desktop subagent calls to deliver its final report to its caller. */
export const HANDBACK_TOOL_NAME = 'SubagentHandback';

/**
 * Returns the `message` input of the last `SubagentHandback` tool call in a raw
 * subagent `.jsonl` transcript, or `null` when there is none. On the Claude
 * desktop app a worker's return is that tool call's input, never assistant
 * text, so `extractLastAssistantText` alone finds nothing to recover there.
 */
export function extractLastHandbackMessage(jsonl: string): string | null {
  let lastMessage: string | null = null;

  for (const blocks of assistantContentBlocks(jsonl)) {
    lastMessage = turnHandback(blocks) ?? lastMessage;
  }

  return lastMessage;
}

/**
 * The texts that may carry a worker's return in a raw subagent `.jsonl` transcript, most
 * authoritative first. A `SubagentHandback` call in the last assistant turn wins over that
 * turn's text, since the text may only describe or preview the return; otherwise the last
 * turn's text comes first, then the last `SubagentHandback` input of any turn. Empty when
 * the transcript has no assistant turn carrying either.
 */
export function transcriptReturnCandidates(jsonl: string): string[] {
  const turns = assistantContentBlocks(jsonl);
  if (turns.length === 0) {
    return [];
  }

  const last = turns[turns.length - 1];
  const lastHandback = turnHandback(last);
  const ordered = lastHandback !== null
    ? [lastHandback, turnText(last)]
    : [turnText(last), extractLastHandbackMessage(jsonl)];
  return ordered.filter((text): text is string => text !== null);
}

/** True when the text holds at least one `type: "assistant"` JSONL envelope line. */
export function hasAssistantTurn(jsonl: string): boolean {
  return assistantContentBlocks(jsonl).length > 0;
}

/** Bytes read from the end of a transcript; shared by the hook fallback and `--recover-transcript`. */
export const TRANSCRIPT_TAIL_BYTES = 200_000;

export function readTranscriptTail(path: string, maxBytes = TRANSCRIPT_TAIL_BYTES): string | null {
  try {
    const stat = fs.statSync(path);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(path, 'r');
    try {
      const length = stat.size - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

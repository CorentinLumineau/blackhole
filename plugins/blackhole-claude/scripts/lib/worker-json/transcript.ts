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
    content?: TranscriptContentBlock[];
  };
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
function assistantContentBlocks(jsonl: string): TranscriptContentBlock[][] {
  const turns: TranscriptContentBlock[][] = [];

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

    if (parsed.type !== 'assistant') {
      continue;
    }

    const content = parsed.message?.content;
    turns.push(Array.isArray(content) ? content : []);
  }

  return turns;
}

export function extractLastAssistantText(jsonl: string): string | null {
  let lastText: string | null = null;

  for (const blocks of assistantContentBlocks(jsonl)) {
    const text = blocks
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');

    lastText = text.length > 0 ? text : null;
  }

  return lastText;
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
    for (const block of blocks) {
      if (block.type !== 'tool_use' || block.name !== HANDBACK_TOOL_NAME) {
        continue;
      }
      const message = block.input?.message;
      if (typeof message === 'string') {
        lastMessage = message;
      }
    }
  }

  return lastMessage;
}

export function readTranscriptTail(path: string, maxBytes = 64_000): string | null {
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

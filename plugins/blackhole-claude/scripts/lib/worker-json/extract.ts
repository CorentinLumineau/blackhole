import { isObject } from './predicates.ts';

export function parseJsonObject(raw: string, label: string): unknown {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) {
      throw new Error(`${label}: expected JSON object`);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

function extractFencedJson(text: string): unknown | null {
  const match = text.match(/```json\s*\n([\s\S]*?)\n```/i);
  if (!match) {
    return null;
  }
  try {
    return parseJsonObject(match[1].trim(), 'fenced json block');
  } catch {
    return null;
  }
}

interface ObjectSpan {
  start: number;
  end: number;
  body: string;
}

function findBalancedObjectStrings(text: string): ObjectSpan[] {
  const objects: ObjectSpan[] = [];

  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          objects.push({ start, end: i + 1, body: text.slice(start, i + 1) });
          break;
        }
      }
    }
  }

  return objects.sort((a, b) => b.end - a.end || a.start - b.start);
}

/**
 * Tries balanced `{...}` spans latest-ending first, and among spans ending at the same
 * place the outermost first, so a top-level return wins over the objects nested inside
 * it and over an unparsable brace in trailing prose. Every worker return carries a
 * `status` key, so the first parsable span that has one wins over a trailing `{}` or
 * example object in prose; with none, the first parsable span is returned.
 */
function extractBareObject(text: string): unknown | null {
  let firstParsed: unknown | null = null;
  for (const candidate of findBalancedObjectStrings(text)) {
    let parsed: unknown;
    try {
      parsed = parseJsonObject(candidate.body, 'bare object');
    } catch {
      continue;
    }
    if (isObject(parsed) && 'status' in parsed) {
      return parsed;
    }
    firstParsed ??= parsed;
  }
  return firstParsed;
}

export function extractWorkerJson(text: string): unknown {
  const fenced = extractFencedJson(text);
  if (fenced !== null) {
    return fenced;
  }

  const bare = extractBareObject(text);
  if (bare !== null) {
    return bare;
  }

  throw new Error('no worker JSON found in text');
}

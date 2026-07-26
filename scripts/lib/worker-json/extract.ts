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

function findBalancedObjectStrings(text: string): string[] {
  const objects: string[] = [];

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
          objects.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }

  return objects;
}

function extractBareObject(text: string): unknown | null {
  const candidates = findBalancedObjectStrings(text);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return parseJsonObject(candidates[i], 'bare object');
    } catch {
      // try earlier candidate
    }
  }
  return null;
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

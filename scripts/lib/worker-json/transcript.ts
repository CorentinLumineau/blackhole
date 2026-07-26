import * as fs from 'fs';

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

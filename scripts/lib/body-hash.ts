import { createHash } from 'node:crypto';

// Issue #885 — the single canonical implementation of route.body_hash's
// concatenation convention (`queue-dag.md` § `body_hash` algorithm): a plain
// `\n` join of title and body, UTF-8 bytes, no further normalization (no
// trim, no CRLF conversion). Two conventions were live before this pin
// (`title + "\n" + body` vs `title + "\n\n" + body`) — this is the one that
// won (3 of 5 sampled issues, plus #868's pre-corruption value).
export function computeBodyHash(title: string, body: string): string {
  return createHash('sha256').update(`${title}\n${body}`, 'utf-8').digest('hex');
}

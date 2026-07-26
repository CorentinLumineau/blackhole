// Shared verify primitives — `CheckResult` wire type, repo `root`, and `read()` helper.
// Dependency blast-radius (21 direct consumers): documentation/reference/check-utils-blast-radius.md
import * as fs from 'fs';
import * as path from 'path';

export const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

export const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

import * as fs from 'fs';
import * as path from 'path';

export const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

export const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

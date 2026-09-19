import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved from this file rather than from `process.cwd()`. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Everything generated lands here. Git-ignored; Supabase is the real store. */
export const OUT = process.env.DF_OUT_DIR
  ? resolve(process.env.DF_OUT_DIR)
  : resolve(ROOT, 'out');

export function outPath(...parts: string[]): string {
  return resolve(OUT, ...parts);
}

/** Per-day working directory: `out/emissions/2026-09-18/`. */
export function emissionDir(date: string): string {
  return ensureDir(outPath('emissions', date));
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureParent(file: string): string {
  ensureDir(dirname(file));
  return file;
}

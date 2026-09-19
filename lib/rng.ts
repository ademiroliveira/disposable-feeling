/**
 * The one random number generator. Music and poster share a seed, so they must
 * share an implementation too — `Math.random()` anywhere in a generator breaks
 * the promise that a given day is reproducible.
 *
 * This file is duplicated verbatim into the browser bundle in lib/render, so
 * the in-page sketches draw from the same stream. Keep the two in sync.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** Approximately normal, mean 0, sd 1. */
  normal(): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  /** An independent stream, so adding a generator never shifts another's draws. */
  fork(label: string): Rng;
}

/** mulberry32 — small, fast, good enough for art, identical across engines. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    normal: () => {
      // Box-Muller, without the log(0) hazard.
      const u = Math.max(next(), Number.EPSILON);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
    fork: (label) => makeRng(mixSeed(seed, label)),
  };
  return rng;
}

/** Stable hash of a label into a seed, so `fork('poster')` is always the same. */
export function mixSeed(seed: number, label: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

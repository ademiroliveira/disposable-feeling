/**
 * The RNG in lib/rng.ts and the one in lib/render/runtime.js are the same
 * generator written twice — once for Node, once for the page, because the
 * page cannot import TypeScript. If they ever drift, the music and the poster
 * stop sharing a day and nothing else in the repo would notice.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

import { makeRng, mixSeed } from '../lib/rng.ts';
import { ROOT } from '../lib/paths.ts';

interface BrowserRng {
  next(): number;
  fork(label: string): BrowserRng;
}

function loadBrowserRuntime(): {
  makeRng(seed: number): BrowserRng;
  mixSeed(seed: number, label: string): number;
} {
  const source = readFileSync(`${ROOT}/lib/render/runtime.js`, 'utf8');
  const sandbox: Record<string, unknown> = {};
  createContext(sandbox);
  runInContext(source, sandbox);
  return sandbox.DF as ReturnType<typeof loadBrowserRuntime>;
}

test('node and browser RNGs produce identical streams', () => {
  const DF = loadBrowserRuntime();
  for (const seed of [0, 1, 42, 2228233225, 4294967295]) {
    const node = makeRng(seed);
    const browser = DF.makeRng(seed);
    for (let i = 0; i < 500; i++) {
      assert.equal(node.next(), browser.next(), `seed ${seed}, draw ${i}`);
    }
  }
});

test('forked streams match too', () => {
  const DF = loadBrowserRuntime();
  for (const label of ['music', 'poster', 'title']) {
    const node = makeRng(12345).fork(label);
    const browser = DF.makeRng(12345).fork(label);
    for (let i = 0; i < 200; i++) {
      assert.equal(node.next(), browser.next(), `${label}, draw ${i}`);
    }
  }
});

test('mixSeed agrees', () => {
  const DF = loadBrowserRuntime();
  for (const label of ['music', 'poster', '']) {
    assert.equal(mixSeed(99, label), DF.mixSeed(99, label));
  }
});

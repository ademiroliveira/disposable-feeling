/**
 * The signal cache is merged, not replaced.
 *
 * A window day costs minutes of GDELT throttling to collect; a later call for
 * a subset of sources — debugging one fetcher with `--sources markets` — must
 * not quietly drop the rest of that day. `loadHistory` reads the cache
 * directly, so a thinned entry would silently shrink the baseline every live
 * day is scored against.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { DaySignals } from '../schema/mood-vector.ts';

// lib/paths.ts resolves the output directory once, at import time.
const OUT = mkdtempSync(join(tmpdir(), 'df-cache-'));
process.env.DF_OUT_DIR = OUT;
// `weather` is the one fetcher that fails before it touches the network, so
// the test exercises the merge without depending on anything being reachable.
delete process.env.OPENWEATHER_API_KEY;

const { collectSignals, readCachedSignals, signalsCachePath } = await import(
  '../agents/signals/index.ts'
);

const DATE = '2026-09-18';

function seedCache(day: DaySignals): void {
  mkdirSync(join(OUT, 'signals'), { recursive: true });
  writeFileSync(signalsCachePath(DATE), JSON.stringify(day));
}

test('a subset refresh keeps the sources it did not ask for', async () => {
  seedCache({
    date: DATE,
    readings: [
      {
        source: 'sky-ground',
        metric: 'moon_illumination',
        value: 0.42,
        unit: 'fraction',
        affects: { valence: 0.3 },
      },
    ],
    missing: [{ source: 'gdelt', reason: 'refused' }],
  });

  await collectSignals(DATE, { sources: ['weather'], refresh: true });

  const cached = readCachedSignals(DATE);
  assert.ok(cached, 'cache should still exist');
  assert.equal(
    cached.readings.filter((r) => r.source === 'sky-ground').length,
    1,
    'sky-ground reading survived',
  );
  assert.ok(
    cached.missing.some((m) => m.source === 'gdelt'),
    'gdelt still recorded as missing',
  );
  assert.ok(
    cached.missing.some((m) => m.source === 'weather'),
    'weather recorded as missing too',
  );
});

test('a cache covering every requested source is reused', async () => {
  seedCache({
    date: DATE,
    readings: [
      {
        source: 'sky-ground',
        metric: 'moon_phase',
        value: 0.25,
        unit: 'cycle',
        affects: {},
      },
    ],
    missing: [],
  });

  const before = readFileSync(signalsCachePath(DATE), 'utf8');
  const day = await collectSignals(DATE, { sources: ['sky-ground'] });

  assert.equal(day.readings.length, 1);
  assert.equal(
    readFileSync(signalsCachePath(DATE), 'utf8'),
    before,
    'a cache hit does not rewrite the file',
  );
});

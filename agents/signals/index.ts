/**
 * The signal collector.
 *
 * Fetchers run in parallel and fail independently: a day with three of four
 * sources is still a day. What is missing is recorded rather than defaulted to
 * zero, because "no weather" and "average weather" are different facts and the
 * synthesis agent needs to tell them apart.
 *
 * Results are cached per day under `out/signals/`. Backfill re-runs the
 * variance gate constantly and GDELT allows one request every five seconds;
 * without the cache a second run costs nine minutes of waiting for data that
 * has not changed since yesterday.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import type { DaySignals, SignalSource } from '../../schema/mood-vector.ts';
import { addDays, dateRange } from '../../lib/dates.ts';
import { describeError } from '../../lib/http.ts';
import { ensureParent, outPath } from '../../lib/paths.ts';
import { fetchGdelt } from './gdelt.ts';
import { fetchMarkets } from './markets.ts';
import { fetchWeather } from './weather.ts';
import { fetchSkyGround } from './sky-ground.ts';

export interface CollectOptions {
  /** Skip the cache and re-fetch. */
  refresh?: boolean;
  /** Restrict to a subset — the variance gate runs without weather. */
  sources?: SignalSource[];
  /** Pass through to the GDELT fetcher. */
  headlines?: boolean;
}

const ALL_SOURCES: SignalSource[] = ['gdelt', 'markets', 'weather', 'sky-ground'];

const FETCHERS = {
  gdelt: (date: string, o: CollectOptions) => fetchGdelt(date, { headlines: o.headlines }),
  markets: (date: string) => fetchMarkets(date),
  weather: (date: string) => fetchWeather(date),
  'sky-ground': (date: string) => fetchSkyGround(date),
} satisfies Record<SignalSource, (date: string, o: CollectOptions) => Promise<unknown>>;

export function signalsCachePath(date: string): string {
  return outPath('signals', `${date}.json`);
}

export function readCachedSignals(date: string): DaySignals | null {
  const file = signalsCachePath(date);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DaySignals;
  } catch {
    return null;
  }
}

export async function collectSignals(
  date: string,
  opts: CollectOptions = {},
): Promise<DaySignals> {
  const wanted = opts.sources ?? ALL_SOURCES;

  if (!opts.refresh) {
    const cached = readCachedSignals(date);
    // Only reuse a cache that covers everything this call asked for.
    if (cached) {
      const have = new Set([
        ...cached.readings.map((r) => r.source),
        ...cached.missing.map((m) => m.source),
      ]);
      if (wanted.every((s) => have.has(s))) return cached;
    }
  }

  type Outcome =
    | { source: SignalSource; readings: DaySignals['readings'] }
    | { source: SignalSource; error: string };

  const results: Outcome[] = await Promise.all(
    wanted.map(async (source): Promise<Outcome> => {
      try {
        const readings = (await FETCHERS[source](date, opts)) as DaySignals['readings'];
        return { source, readings };
      } catch (err) {
        return { source, error: describeError(err) };
      }
    }),
  );

  const day: DaySignals = {
    date,
    readings: results.flatMap((r) => ('readings' in r ? r.readings : [])),
    missing: results.flatMap((r) =>
      'error' in r ? [{ source: r.source, reason: r.error }] : [],
    ),
  };

  writeFileSync(ensureParent(signalsCachePath(date)), JSON.stringify(day, null, 2));
  return day;
}

/**
 * The previous `days` days of signals, from cache only.
 *
 * Deliberately does not fetch: the daily run must not turn into a thirty-day
 * backfill because the cache was cold, and a short baseline is a recoverable
 * condition — `score()` returns 0 rather than guessing. Warm it with
 * `npm run backfill -- --signals-only`.
 */
export function loadHistory(endDate: string, days = 30): DaySignals[] {
  return dateRange(addDays(endDate, -1), days)
    .map(readCachedSignals)
    .filter((day): day is DaySignals => day !== null);
}

/** Flat map of `source.metric` → value, which is what synthesis scores against. */
export function metricMap(day: DaySignals): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of day.readings) out[`${r.source}.${r.metric}`] = r.value;
  return out;
}

export { fetchGdelt, fetchMarkets, fetchWeather, fetchSkyGround };

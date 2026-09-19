#!/usr/bin/env node
/**
 * Phase 0: re-run historical days and find out whether the world's mood is
 * actually varied enough to be worth building a pipeline on.
 *
 *   npm run backfill -- --days 30 --end 2026-09-18
 *   npm run backfill -- --signals-only          # just warm the cache
 *   npm run backfill -- --seconds 75            # shorter renders, same shapes
 *
 * Weather is excluded by default: OpenWeatherMap's history is a paid plan, so
 * a backfilled day cannot have it and a day that pretends otherwise would
 * poison the baseline every live day is scored against.
 *
 * Signals are fetched day by day rather than in parallel. GDELT allows one
 * request every five seconds and answers a plain-text refusal when you ignore
 * it, so a parallel backfill is a slower backfill with holes in it.
 */

import { writeFileSync } from 'node:fs';

import { collectSignals } from '../agents/signals/index.ts';
import type { Emission, SignalSource } from '../schema/mood-vector.ts';
import { parseFlags } from '../lib/cli.ts';
import { addDays, dateRange, isoDate } from '../lib/dates.ts';
import { describeError } from '../lib/http.ts';
import { ensureParent, outPath } from '../lib/paths.ts';
import { publishSignals, supabaseConfigured } from '../lib/store.ts';
import { openRenderHost } from '../lib/render/host.ts';
import { describeEmission, emit } from './emit.ts';
import { analyse, formatReport } from './variance.ts';

const flags = parseFlags();
const days = flags.num('days', 30);
const end = flags.get('end') ?? addDays(isoDate(), -1);
const sources = (flags.list('sources') as SignalSource[] | undefined) ?? [
  'gdelt',
  'markets',
  'sky-ground',
];
const dates = dateRange(end, days);

if (flags.get('seconds')) process.env.DF_TRACK_SECONDS = flags.get('seconds');

console.log(`backfill ${dates[0]} .. ${dates[dates.length - 1]} (${days} days)`);
console.log(`sources: ${sources.join(', ')}\n`);

/* ------------------------------ 1. signals ------------------------------- */

const missingBySource = new Map<string, number>();
for (const date of dates) {
  const started = Date.now();
  const day = await collectSignals(date, { sources, refresh: flags.bool('refresh') });
  await publishSignals(day);
  for (const missing of day.missing) {
    missingBySource.set(missing.source, (missingBySource.get(missing.source) ?? 0) + 1);
  }
  console.log(
    `  ${date}  ${String(day.readings.length).padStart(2)} readings` +
      (day.missing.length > 0 ? `  missing: ${day.missing.map((m) => m.source).join(', ')}` : '') +
      `  ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

if (missingBySource.size > 0) {
  console.log('\nsources that did not report:');
  for (const [source, count] of missingBySource) {
    console.log(`  ${source}: ${count}/${dates.length} days`);
  }
}

if (flags.bool('signals-only')) {
  console.log(
    supabaseConfigured()
      ? '\nbaseline warm, in the cache and in Supabase.'
      : '\nbaseline warm in the local cache. Set SUPABASE_URL to make it durable.',
  );
  process.exit(0);
}

/* ------------------------- 2. synthesize + render ------------------------ */

console.log('\nrendering:');
const emissions: Emission[] = [];
let host = await openRenderHost();

/** A crashed Chromium looks like this, and it poisons every day after it. */
function isHostFailure(err: unknown): boolean {
  return /Target closed|detached Frame|Session closed|Connection closed|Protocol error/i.test(
    describeError(err),
  );
}

try {
  for (const date of dates) {
    const started = Date.now();

    for (let attempt = 0; attempt < 2; attempt++) {
      if (!host.isAlive()) {
        console.warn('  render host is gone — restarting Chromium');
        await host.close().catch(() => undefined);
        host = await openRenderHost();
      }
      try {
        // Backfilled days are never published: they are a measurement, and
        // the archive should not fill up with days nobody lived through.
        const result = await emit(date, {
          host,
          sources,
          offline: flags.bool('offline'),
          publish: false,
        });
        emissions.push(result.emission);
        console.log(
          `  ${describeEmission(result)}  ${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
        break;
      } catch (err) {
        // One retry, and only for a dead browser: a sketch that throws will
        // throw again, and thirty days of that is thirty wasted renders.
        if (attempt === 0 && isHostFailure(err)) {
          console.warn(`  ${date}  render host failed, retrying once`);
          await host.close().catch(() => undefined);
          host = await openRenderHost();
          continue;
        }
        console.error(`  ${date}  FAILED: ${describeError(err)}`);
        break;
      }
    }
  }
} finally {
  await host.close().catch(() => undefined);
}

if (emissions.length < dates.length) {
  console.warn(
    `\n${dates.length - emissions.length} of ${dates.length} days did not render — ` +
      'the gate below is only as good as what it had to measure',
  );
}

/* ------------------------------ 3. the gate ------------------------------ */

const report = analyse(emissions);
console.log(`\n${formatReport(report)}\n`);

const reportPath = outPath('variance', `${end}-${days}d.json`);
writeFileSync(
  ensureParent(reportPath),
  JSON.stringify({ report, emissions }, null, 2),
);
console.log(`written: ${reportPath}`);

process.exit(report.passed ? 0 : 1);

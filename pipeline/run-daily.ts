#!/usr/bin/env node
/**
 * One day, start to finish: signals → mood → track + poster → archive, then
 * sweep anything that has passed its seven days.
 *
 *   npm run daily
 *   npm run daily -- --date 2026-09-18 --offline
 */

import { parseFlags } from '../lib/cli.ts';
import { openRenderHost } from '../lib/render/host.ts';
import { emissionDate } from '../lib/dates.ts';
import { openStores } from '../lib/store.ts';
import type { SignalSource } from '../schema/mood-vector.ts';
import { describeEmission, emit } from './emit.ts';

/**
 * A day scored against nothing is not an error, and that is the problem.
 *
 * `score()` returns 0 without history, so a cold baseline produces an
 * emission whose every dimension is exactly zero — a valid, publishable,
 * characterless day. The first live run did precisely this and said nothing
 * about it. Left alone it would have taken a fortnight of flat days before
 * anyone wondered why, and those days are not re-renderable once the signal
 * APIs have moved on.
 */
function warnAboutBaseline(days: number): void {
  if (days >= 10) return;
  const rule = '='.repeat(72);
  console.warn(`\n${rule}`);
  console.warn(
    days === 0
      ? '  NO BASELINE. Every dimension scored 0.00 — this day is flat, not calm.'
      : `  THIN BASELINE: ${days} days. Dimensions are damped toward 0.00.`,
  );
  console.warn('  Mood is a deviation from the previous 30 days, and there is');
  console.warn('  little or nothing to deviate from. Run the warm-baseline');
  console.warn('  workflow, then re-run this day to replace it.');
  console.warn(`${rule}\n`);
}

const flags = parseFlags();
// Not today(): a delayed 23:30 slot must still emit for the day it was
// scheduled against. See emissionDate().
const date = flags.get('date') ?? emissionDate();

console.log(`disposable feeling — emission for ${date}`);

const host = await openRenderHost();
try {
  const result = await emit(date, {
    host,
    offline: flags.bool('offline'),
    refreshSignals: flags.bool('refresh'),
    sources: flags.list('sources') as SignalSource[] | undefined,
    publish: !flags.bool('dry-run'),
  });

  console.log(describeEmission(result));
  console.log(`  audio     ${result.audioPath}`);
  console.log(`  poster    ${result.posterPath}`);
  console.log(`  thumbnail ${result.thumbnailPath}`);

  for (const missing of result.signals.missing) {
    console.warn(`  ! ${missing.source} did not report: ${missing.reason}`);
  }

  warnAboutBaseline(result.mood.provenance.baselineDays);
} finally {
  await host.close();
}

if (!flags.bool('no-expire')) {
  for (const store of openStores()) {
    const expired = await store.expire();
    if (expired.length > 0) {
      console.log(`  expired in ${store.name}: ${expired.join(', ')}`);
    }
  }
}

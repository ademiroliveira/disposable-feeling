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

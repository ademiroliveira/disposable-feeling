#!/usr/bin/env node
/**
 * Fetch and print one day of signals. Useful on its own when a source starts
 * misbehaving, and it warms the cache the backfill reads.
 *
 *   npm run signals -- --date 2026-09-18 --refresh
 */

import { collectSignals } from '../agents/signals/index.ts';
import type { SignalSource } from '../schema/mood-vector.ts';
import { parseFlags } from '../lib/cli.ts';
import { isoDate } from '../lib/dates.ts';

const flags = parseFlags();
const date = flags.get('date') ?? isoDate();

const day = await collectSignals(date, {
  refresh: flags.bool('refresh'),
  sources: flags.list('sources') as SignalSource[] | undefined,
  headlines: !flags.bool('no-headlines'),
});

console.log(`\n${date} — ${day.readings.length} readings`);
for (const r of day.readings) {
  const value = r.metric === 'headlines' ? `${r.value}` : r.value.toFixed(3);
  console.log(`  ${`${r.source}.${r.metric}`.padEnd(28)} ${value.padStart(12)} ${r.unit}`);
  if (r.note) console.log(`  ${' '.repeat(28)} ${r.note.slice(0, 120)}`);
}
for (const m of day.missing) {
  console.log(`  ! ${m.source}: ${m.reason}`);
}

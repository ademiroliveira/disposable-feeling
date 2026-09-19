#!/usr/bin/env node
/**
 * Re-run the Phase 0 gate without rendering anything. Useful after changing
 * the mood vector, the baseline window or the thresholds.
 *
 *   npm run variance                 # the newest backfill
 *   npm run variance -- --store      # the published archive instead
 *   npm run variance -- --from out/variance/2026-09-18-30d.json
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Emission } from '../schema/mood-vector.ts';
import { parseFlags } from '../lib/cli.ts';
import { outPath } from '../lib/paths.ts';
import { localStore } from '../lib/store.ts';
import { analyse, formatReport } from './variance.ts';

const flags = parseFlags();

/** Backfilled days are measurements, not emissions, so they are not published. */
function newestBackfill(): string | null {
  const dir = outPath('variance');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  return files.length > 0 ? join(dir, files[files.length - 1]!) : null;
}

async function loadEmissions(): Promise<{ emissions: Emission[]; from: string }> {
  if (flags.bool('store')) {
    return { emissions: await localStore.list(flags.num('days', 30)), from: 'archive' };
  }

  const file = flags.get('from') ?? newestBackfill();
  if (file) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { emissions: Emission[] };
    return { emissions: parsed.emissions ?? [], from: file };
  }

  return { emissions: await localStore.list(flags.num('days', 30)), from: 'archive' };
}

const { emissions, from } = await loadEmissions();

if (emissions.length < 2) {
  console.error(
    `nothing to compare in ${from} — run \`npm run backfill\` first`,
  );
  process.exit(2);
}

console.log(`source: ${from}\n`);
const report = analyse(emissions);
console.log(formatReport(report));
process.exit(report.passed ? 0 : 1);

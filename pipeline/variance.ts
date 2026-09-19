/**
 * The Phase 0 gate, as arithmetic.
 *
 * The question is not "are these numbers different" — floating point
 * guarantees that — but "would a listener tell Tuesday from Wednesday". So the
 * report measures three things and all three have to pass:
 *
 *   1. Mood distance between days. If the vectors cluster, everything
 *      downstream clusters.
 *   2. Spread within each dimension. A dimension that never moves is a
 *      dimension that is not earning its place in the contract.
 *   3. Spread of the render parameters the generators actually chose. Two
 *      different mood vectors that both land on "8 partials, aeolian" produce
 *      two tracks that sound the same, and that is the failure the gate exists
 *      to catch.
 */

import type { Emission, MoodDimension, MoodVector } from '../schema/mood-vector.ts';
import { MOOD_DIMENSIONS, moodDistance } from '../schema/mood-vector.ts';

/** Below this, two days are "the same day" for listening purposes. */
export const TOO_CLOSE = 0.12;
/** The mean pairwise distance a set of days has to clear. */
export const MIN_MEAN_DISTANCE = 0.25;
/** A dimension flatter than this is not contributing. */
export const MIN_DIMENSION_SD = 0.08;
/** At most this share of pairs may be indistinguishable. */
export const MAX_CLOSE_SHARE = 0.1;

export interface Pair {
  a: string;
  b: string;
  distance: number;
}

export interface VarianceReport {
  days: number;
  meanDistance: number;
  minDistance: number;
  maxDistance: number;
  closestPairs: Pair[];
  closeShare: number;
  dimensionSd: Record<MoodDimension, number>;
  /** Distinct values seen for each render parameter, e.g. `music.mode`. */
  renderSpread: Record<string, number>;
  distinctTitles: number;
  failures: string[];
  passed: boolean;
}

function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1),
  );
}

/** Render parameters worth checking for collapse. Continuous ones are bucketed. */
const RENDER_KEYS: Array<{ key: string; bucket?: number }> = [
  { key: 'music.mode' },
  { key: 'music.partials' },
  { key: 'music.rootHz', bucket: 1 },
  { key: 'music.eventsPerMinute', bucket: 2 },
  { key: 'poster.cols' },
  { key: 'poster.accents' },
  { key: 'poster.inverted' },
  { key: 'poster.baseHue', bucket: 15 },
];

function renderValue(emission: Emission, key: string): unknown {
  const [group, name] = key.split('.') as ['music' | 'poster', string];
  return emission.render?.[group]?.[name];
}

export function analyse(emissions: Emission[]): VarianceReport {
  const moods: MoodVector[] = emissions.map((e) => e.mood);
  const failures: string[] = [];

  const pairs: Pair[] = [];
  for (let i = 0; i < moods.length; i++) {
    for (let j = i + 1; j < moods.length; j++) {
      pairs.push({
        a: moods[i]!.date,
        b: moods[j]!.date,
        distance: moodDistance(moods[i]!, moods[j]!),
      });
    }
  }
  pairs.sort((x, y) => x.distance - y.distance);

  const distances = pairs.map((p) => p.distance);
  const meanDistance =
    distances.length > 0 ? distances.reduce((a, b) => a + b, 0) / distances.length : 0;
  const closeShare =
    distances.length > 0
      ? distances.filter((d) => d < TOO_CLOSE).length / distances.length
      : 0;

  const dimensionSd = {} as Record<MoodDimension, number>;
  for (const dim of MOOD_DIMENSIONS) {
    dimensionSd[dim] = sd(moods.map((m) => m[dim]));
  }

  const renderSpread: Record<string, number> = {};
  const haveRenderNotes = emissions.some((e) => e.render);
  if (haveRenderNotes) {
    for (const { key, bucket } of RENDER_KEYS) {
      const seen = new Set<string>();
      for (const emission of emissions) {
        const value = renderValue(emission, key);
        if (value === undefined) continue;
        seen.add(
          bucket && typeof value === 'number'
            ? String(Math.round(value / bucket))
            : String(value),
        );
      }
      renderSpread[key] = seen.size;
    }
  }

  if (meanDistance < MIN_MEAN_DISTANCE) {
    failures.push(
      `mean mood distance ${meanDistance.toFixed(3)} < ${MIN_MEAN_DISTANCE}`,
    );
  }
  if (closeShare > MAX_CLOSE_SHARE) {
    failures.push(
      `${(closeShare * 100).toFixed(0)}% of day pairs are closer than ${TOO_CLOSE}`,
    );
  }
  for (const dim of MOOD_DIMENSIONS) {
    if (dimensionSd[dim] < MIN_DIMENSION_SD) {
      failures.push(`${dim} barely moves (sd ${dimensionSd[dim].toFixed(3)})`);
    }
  }
  for (const [key, count] of Object.entries(renderSpread)) {
    if (count <= 1 && emissions.length > 3) {
      failures.push(`every day rendered the same ${key}`);
    }
  }

  const distinctTitles = new Set(moods.map((m) => m.title)).size;
  if (moods.length > 3 && distinctTitles < moods.length * 0.6) {
    failures.push(
      `only ${distinctTitles} distinct titles across ${moods.length} days`,
    );
  }

  return {
    days: moods.length,
    meanDistance,
    minDistance: distances[0] ?? 0,
    maxDistance: distances[distances.length - 1] ?? 0,
    closestPairs: pairs.slice(0, 5),
    closeShare,
    dimensionSd,
    renderSpread,
    distinctTitles,
    failures,
    passed: failures.length === 0,
  };
}

export function formatReport(report: VarianceReport): string {
  const lines: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  lines.push(`Phase 0 variance gate — ${report.days} days`);
  lines.push('');
  lines.push(
    `  mood distance   mean ${report.meanDistance.toFixed(3)}   ` +
      `min ${report.minDistance.toFixed(3)}   max ${report.maxDistance.toFixed(3)}`,
  );
  lines.push(
    `  pairs under ${TOO_CLOSE}  ${pct(report.closeShare)} (limit ${pct(MAX_CLOSE_SHARE)})`,
  );
  lines.push(`  distinct titles ${report.distinctTitles} of ${report.days}`);
  lines.push('');
  lines.push('  dimension spread (sd across days)');
  for (const [dim, value] of Object.entries(report.dimensionSd)) {
    const flag = value < MIN_DIMENSION_SD ? '  <- flat' : '';
    lines.push(`    ${dim.padEnd(12)} ${value.toFixed(3)}${flag}`);
  }
  if (Object.keys(report.renderSpread).length > 0) {
    lines.push('');
    lines.push('  distinct render choices');
    for (const [key, count] of Object.entries(report.renderSpread)) {
      lines.push(`    ${key.padEnd(22)} ${count}`);
    }
  }
  lines.push('');
  lines.push('  closest pairs');
  for (const pair of report.closestPairs) {
    lines.push(`    ${pair.a}  ${pair.b}   ${pair.distance.toFixed(3)}`);
  }
  lines.push('');
  if (report.passed) {
    lines.push('  PASS — the days are distinguishable. Phase 1 is unblocked.');
  } else {
    lines.push('  FAIL — the mood vector needs more dimensions before anything');
    lines.push('         else gets built:');
    for (const failure of report.failures) lines.push(`    - ${failure}`);
  }
  return lines.join('\n');
}

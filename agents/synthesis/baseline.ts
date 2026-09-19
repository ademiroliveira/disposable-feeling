/**
 * The rolling baseline.
 *
 * Absolute values are almost useless here: GDELT tone is negative nearly every
 * day, Kp sits at 2 most of the time, and crypto is always "volatile". Scored
 * against the last thirty days, "mildly anxious" becomes the zero point and
 * the differences that do exist stop averaging out.
 */

import type { DaySignals, MoodDimension } from '../../schema/mood-vector.ts';
import { MOOD_DIMENSIONS, clamp, score } from '../../schema/mood-vector.ts';
import { metricMap } from '../signals/index.ts';

export type Baseline = Map<string, number[]>;

export function buildBaseline(history: DaySignals[]): Baseline {
  const baseline: Baseline = new Map();
  for (const day of history) {
    for (const [key, value] of Object.entries(metricMap(day))) {
      const bucket = baseline.get(key);
      if (bucket) bucket.push(value);
      else baseline.set(key, [value]);
    }
  }
  return baseline;
}

export interface ScoredMetric {
  key: string;
  raw: number;
  unit: string;
  /** Deviation from baseline, in [-1, 1]. */
  z: number;
  affects: Partial<Record<MoodDimension, number>>;
  note?: string;
}

export function scoreDay(day: DaySignals, baseline: Baseline): ScoredMetric[] {
  return day.readings
    .filter((r) => Object.keys(r.affects).length > 0)
    .map((r) => {
      const key = `${r.source}.${r.metric}`;
      return {
        key,
        raw: r.value,
        unit: r.unit,
        z: score(r.value, baseline.get(key) ?? []),
        affects: r.affects,
        note: r.note,
      };
    });
}

/**
 * Collapse scored metrics into the four numeric dimensions.
 *
 * This is the arithmetic the Claude call is asked to adjust rather than
 * replace — it is also the whole synthesizer when no API key is present, which
 * is how Phase 0's variance gate runs for free.
 */
export function reduceDimensions(
  scored: ScoredMetric[],
): Record<MoodDimension, number> {
  const out = {} as Record<MoodDimension, number>;

  for (const dim of MOOD_DIMENSIONS) {
    let weighted = 0;
    let total = 0;
    for (const metric of scored) {
      const weight = metric.affects[dim];
      if (weight === undefined || weight === 0) continue;
      weighted += metric.z * weight;
      total += Math.abs(weight);
    }
    // Averaging a handful of weak, partly-correlated signals pulls everything
    // toward zero, so open the result back up before clamping. Without this,
    // thirty days of mood vectors all sit inside ±0.2 and sound identical.
    out[dim] = total === 0 ? 0 : clamp(Math.tanh((weighted / total) * 2.2));
  }

  return out;
}

/** The metrics that moved most, for the prompt and for the archive. */
export function notableMetrics(scored: ScoredMetric[], count = 6): ScoredMetric[] {
  return [...scored].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, count);
}

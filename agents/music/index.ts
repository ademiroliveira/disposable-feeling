/**
 * The music agent.
 *
 * Owns the parameters and the file; the actual composition is sketch.js,
 * which runs inside the shared render host because Tone.js needs Web Audio.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MoodVector } from '../../schema/mood-vector.ts';
import { clamp } from '../../schema/mood-vector.ts';
import { emissionDir } from '../../lib/paths.ts';
import type { PublishResult, RenderHost } from '../../lib/render/host.ts';

const SKETCH = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'sketch.js'),
  'utf8',
);

export const SAMPLE_RATE = 44_100;

export interface MusicMeta extends PublishResult {
  peak: number;
  /** Descriptors measured from the rendered audio; the variance gate reads them. */
  rms: number;
  crest: number;
  zcr: number;
  lowRatio: number;
  mode: string;
  rootHz: number;
  partials: number;
  eventsPerMinute: number;
  phaseRatio: number;
}

export interface MusicResult {
  /** The rendered WAV. Mastering to a delivery format happens downstream. */
  path: string;
  durationSeconds: number;
  meta: MusicMeta;
}

/**
 * Calm days get long tracks and agitated ones get short. Seven of these make
 * an EP, so the range is kept inside something you would actually sit through.
 */
export function trackSeconds(mood: MoodVector): number {
  const override = Number(process.env.DF_TRACK_SECONDS);
  if (Number.isFinite(override) && override > 0) return override;
  const arousal = clamp(mood.arousal);
  return Math.round(270 - arousal * 75);
}

export async function renderMusic(
  mood: MoodVector,
  host: RenderHost,
): Promise<MusicResult> {
  const durationSeconds = trackSeconds(mood);
  const outFile = join(emissionDir(mood.date), 'track.wav');

  const { files, meta } = await host.renderToFiles<MusicMeta>({
    label: `music ${mood.date}`,
    libraries: ['tone'],
    sketch: SKETCH,
    args: { mood, durationSeconds, sampleRate: SAMPLE_RATE },
    outFiles: { track: outFile },
    // Offline rendering beats realtime comfortably, but a nine-partial drone
    // with reverb over five minutes is still not instant.
    timeoutMs: 12 * 60_000,
  });

  if (meta.peak < 0.02) {
    throw new Error(
      `music ${mood.date}: rendered near-silence (peak ${meta.peak.toFixed(4)})`,
    );
  }

  return { path: files.track!, durationSeconds, meta };
}

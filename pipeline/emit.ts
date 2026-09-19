/**
 * One emission, end to end. Both `run-daily` and `backfill` go through here so
 * a backfilled day and a live day are produced by exactly the same code.
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { collectSignals } from '../agents/signals/index.ts';
import { synthesizeMood } from '../agents/synthesis/index.ts';
import { renderMusic } from '../agents/music/index.ts';
import { renderPoster } from '../agents/poster/index.ts';
import type {
  DaySignals,
  Emission,
  MoodVector,
  SignalSource,
} from '../schema/mood-vector.ts';
import { findFfmpeg, masterToMp3 } from '../lib/ffmpeg.ts';
import { emissionDir } from '../lib/paths.ts';
import type { RenderHost } from '../lib/render/host.ts';
import { expiresAt, loadSignalHistory, publishEmission, publishSignals } from '../lib/store.ts';

export interface EmitOptions {
  host: RenderHost;
  /** Sources to ask for. Backfill drops `weather` — its history is paid. */
  sources?: SignalSource[];
  /** Skip the Claude call even when a key is present. */
  offline?: boolean;
  refreshSignals?: boolean;
  /** Publish to the stores. Off for dry runs and the variance gate. */
  publish?: boolean;
  baselineDays?: number;
}

export interface EmitResult {
  emission: Emission;
  mood: MoodVector;
  /** What the day was actually built from, including what was missing. */
  signals: DaySignals;
  audioPath: string;
  posterPath: string;
  thumbnailPath: string;
}

export async function emit(date: string, opts: EmitOptions): Promise<EmitResult> {
  const history = await loadSignalHistory(date, opts.baselineDays ?? 30);
  const signals = await collectSignals(date, {
    refresh: opts.refreshSignals,
    sources: opts.sources,
  });

  // The day's own signals are part of tomorrow's baseline, so they are stored
  // whether or not the emission itself is published.
  await publishSignals(signals);

  const mood = await synthesizeMood(signals, { history, offline: opts.offline });

  const music = await renderMusic(mood, opts.host);
  const poster = await renderPoster(mood, opts.host);

  // Mastering is a nicety, not a gate: on a machine without ffmpeg the WAV is
  // still a playable, archivable track.
  let audioPath = music.path;
  if (findFfmpeg()) {
    const mp3 = join(emissionDir(date), 'track.mp3');
    await masterToMp3(music.path, mp3, {
      title: mood.title,
      album: 'Disposable Feeling',
      date,
      comment: mood.themes.join(', '),
    });
    if (existsSync(mp3)) {
      rmSync(music.path, { force: true });
      audioPath = mp3;
    }
  }

  const emission: Emission = {
    date,
    title: mood.title,
    mood,
    audioPath,
    posterPath: poster.path,
    thumbnailPath: poster.thumbnailPath,
    durationSeconds: music.durationSeconds,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt(date),
    render: { music: music.meta, poster: poster.meta },
  };

  const stored =
    opts.publish === false
      ? emission
      : await publishEmission(emission, {
          audio: audioPath,
          poster: poster.path,
          thumbnail: poster.thumbnailPath,
        });

  return {
    emission: stored,
    mood,
    signals,
    audioPath,
    posterPath: poster.path,
    thumbnailPath: poster.thumbnailPath,
  };
}

/** One line per day, in the same shape everywhere. */
export function describeEmission(result: EmitResult): string {
  const m = result.mood;
  const num = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);
  return (
    `${m.date}  "${m.title}"  ` +
    `val ${num(m.valence)} aro ${num(m.arousal)} vol ${num(m.volatility)} coh ${num(m.coherence)}  ` +
    `[${m.themes.join(', ')}]  via ${m.provenance.synthesizer}`
  );
}

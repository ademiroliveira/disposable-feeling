/**
 * EP assembly.
 *
 * Seven tracks, one per day of the expiry window — the most the seven-day
 * expiry allows, and the reason assembly has to run inside that window rather
 * than whenever someone gets round to it.
 *
 * Sequenced for contrast, not by date. Playing a week in order means playing
 * seven days that mostly resemble each other in the order they resembled each
 * other; ordering by distance in mood space puts the quiet day next to the
 * loud one, which is the only thing that makes a flat week listenable.
 */

import { existsSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Emission, MoodVector } from '../../schema/mood-vector.ts';
import { EP_TRACKS, moodDistance } from '../../schema/mood-vector.ts';
import { audioDuration, ffmpeg, masterToMp3 } from '../../lib/ffmpeg.ts';
import { ensureDir, outPath } from '../../lib/paths.ts';

/** Crossfade between tracks, in seconds. Long, because everything is slow. */
const CROSSFADE_SECONDS = 6;

export interface EpTrack {
  date: string;
  title: string;
  /** Position in the sequence, 1-based. */
  position: number;
  /** Seconds from the start of the EP. */
  startsAt: number;
  durationSeconds: number;
  mood: MoodVector;
}

export interface Ep {
  id: string;
  /** The window the EP covers, inclusive. */
  from: string;
  to: string;
  audioPath: string;
  durationSeconds: number;
  tracks: EpTrack[];
  assembledAt: string;
}

/**
 * Greedy contrast ordering: open with the most extreme day, then always go to
 * whichever unplayed day is furthest from the one just played.
 *
 * Greedy rather than optimal on purpose — the optimal ordering of seven items
 * is a travelling-salesman problem solved for an audience of one, and greedy
 * already guarantees no two adjacent tracks are the closest pair available.
 */
export function sequenceForContrast(moods: MoodVector[]): MoodVector[] {
  if (moods.length <= 2) return [...moods];

  const remaining = [...moods];
  const magnitude = (m: MoodVector) =>
    Math.hypot(m.valence, m.arousal, m.volatility, m.coherence);

  let current = remaining.reduce((a, b) => (magnitude(b) > magnitude(a) ? b : a));
  remaining.splice(remaining.indexOf(current), 1);
  const ordered = [current];

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = -1;
    remaining.forEach((candidate, index) => {
      const distance = moodDistance(current, candidate);
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    current = remaining.splice(bestIndex, 1)[0]!;
    ordered.push(current);
  }

  return ordered;
}

export interface AssembleOptions {
  /** Defaults to the emission's own audio path. */
  resolveAudio?: (emission: Emission) => string | null;
  crossfadeSeconds?: number;
  /**
   * Defaults to the last playable day. Pass the window's end instead, so an
   * EP whose final day already expired is still named after the week it
   * covers rather than after the last track that survived.
   */
  id?: string;
}

export async function assembleEp(
  emissions: Emission[],
  opts: AssembleOptions = {},
): Promise<Ep> {
  const resolveAudio = opts.resolveAudio ?? ((e: Emission) => e.audioPath);
  const crossfade = opts.crossfadeSeconds ?? CROSSFADE_SECONDS;

  const playable = emissions.filter((e) => {
    const audio = resolveAudio(e);
    return audio !== null && existsSync(audio);
  });

  if (playable.length < 2) {
    throw new Error(
      `EP needs at least two playable emissions, found ${playable.length} — ` +
        'audio expires after seven days, so assembly must run inside the window',
    );
  }
  if (playable.length < EP_TRACKS) {
    console.warn(
      `ep: only ${playable.length} of ${EP_TRACKS} days are still playable`,
    );
  }

  const byDate = new Map(playable.map((e) => [e.date, e]));
  const ordered = sequenceForContrast(playable.map((e) => e.mood));

  const inputs = ordered.map((mood) => resolveAudio(byDate.get(mood.date)!)!);
  const durations = await Promise.all(inputs.map(audioDuration));

  const dates = playable.map((e) => e.date).sort();
  const id = opts.id ?? `ep-${dates[dates.length - 1]}`;
  const dir = ensureDir(outPath('eps', id));
  const audioPath = join(dir, `${id}.mp3`);

  // Chain acrossfade pairwise: [0][1] -> a1, [a1][2] -> a2, and so on.
  const filters: string[] = [];
  let label = '[0:a]';
  for (let i = 1; i < inputs.length; i++) {
    const next = i === inputs.length - 1 ? '[mix]' : `[a${i}]`;
    filters.push(
      `${label}[${i}:a]acrossfade=d=${crossfade}:c1=tri:c2=tri${next}`,
    );
    label = next;
  }

  await ffmpeg([
    ...inputs.flatMap((input) => ['-i', input]),
    '-filter_complex', filters.join(';'),
    '-map', '[mix]',
    '-c:a', 'libmp3lame',
    '-q:a', '2',
    '-metadata', `album=Disposable Feeling — ${id}`,
    '-metadata', `title=${id}`,
    audioPath,
  ]);

  let cursor = 0;
  const tracks: EpTrack[] = ordered.map((mood, index) => {
    const startsAt = cursor;
    cursor += durations[index]! - (index < inputs.length - 1 ? crossfade : 0);
    return {
      date: mood.date,
      title: mood.title,
      position: index + 1,
      startsAt: Math.round(startsAt * 1000) / 1000,
      durationSeconds: Math.round(durations[index]! * 1000) / 1000,
      mood,
    };
  });

  const ep: Ep = {
    id,
    from: dates[0]!,
    to: dates[dates.length - 1]!,
    audioPath,
    durationSeconds: await audioDuration(audioPath),
    tracks,
    assembledAt: new Date().toISOString(),
  };

  writeFileSync(join(dir, `${id}.json`), JSON.stringify(ep, null, 2));
  return ep;
}

export { masterToMp3 };

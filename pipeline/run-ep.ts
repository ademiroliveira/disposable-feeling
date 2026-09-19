#!/usr/bin/env node
/**
 * Assemble the week's EP. Must run inside the seven-day window — after that
 * the audio is gone and only the residue remains.
 *
 *   npm run ep
 *   npm run ep -- --end 2026-09-18
 *
 * Reads the published archive when Supabase is configured, because the runner
 * that assembles the EP is not the runner that rendered the days.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { assembleEp } from '../agents/ep-assembly/index.ts';
import type { Emission } from '../schema/mood-vector.ts';
import { EP_TRACKS } from '../schema/mood-vector.ts';
import { parseFlags } from '../lib/cli.ts';
import { dateRange } from '../lib/dates.ts';
import { describeError, download } from '../lib/http.ts';
import { ensureDir, outPath } from '../lib/paths.ts';
import { publishEp, readStore, today } from '../lib/store.ts';

const flags = parseFlags();
const end = flags.get('end') ?? today();
const window = new Set(dateRange(end, EP_TRACKS));

const store = readStore();
const emissions = (await store.list()).filter((emission) => window.has(emission.date));

if (emissions.length === 0) {
  console.error(`no emissions in ${dateRange(end, EP_TRACKS)[0]} .. ${end} (${store.name})`);
  process.exit(2);
}

/**
 * Bring every track onto this disk first. Supabase hands back public URLs and
 * ffmpeg's acrossfade chain wants local inputs it can seek in.
 */
const sourceDir = ensureDir(outPath('eps', `ep-${end}`, 'source'));
const localAudio = new Map<string, string>();

for (const emission of emissions) {
  const path = emission.audioPath;
  if (!path) {
    console.warn(`  ${emission.date}: already expired, leaving it out`);
    continue;
  }
  if (!/^https?:\/\//.test(path)) {
    if (existsSync(path)) localAudio.set(emission.date, path);
    else console.warn(`  ${emission.date}: ${path} is gone`);
    continue;
  }
  const dest = join(sourceDir, `${emission.date}.mp3`);
  try {
    await download(path, dest);
    localAudio.set(emission.date, dest);
  } catch (err) {
    console.warn(`  ${emission.date}: could not fetch audio (${describeError(err)})`);
  }
}

const ep = await publishEp(
  await assembleEp(emissions, {
    resolveAudio: (emission: Emission) => localAudio.get(emission.date) ?? null,
  }),
);

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

console.log(
  `${ep.id}  ${ep.from} .. ${ep.to}  ${(ep.durationSeconds / 60).toFixed(1)} min  ` +
    `${ep.tracks.length} tracks, sequenced for contrast`,
);
for (const track of ep.tracks) {
  console.log(
    `  ${String(track.position).padStart(2)}. ${mmss(track.startsAt)}  ` +
      `${track.date}  ${track.title}`,
  );
}
console.log(`\n  ${ep.audioPath}`);

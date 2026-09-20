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

/**
 * An archive younger than one EP is a stage every archive passes through, not
 * a failure. This runs chained to Sunday's emission, so throwing here turns a
 * successful day red for the whole of the first week — and a red build nobody
 * can act on is a red build people learn to ignore.
 *
 * `--require` is for when you do want the non-zero exit: re-running a week
 * that should have worked.
 */
function giveUp(reason: string): never {
  if (flags.bool('require')) {
    console.error(reason);
    process.exit(1);
  }
  console.log(`${reason} — skipping.`);
  process.exit(0);
}

if (emissions.length === 0) {
  giveUp(`no emissions in ${dateRange(end, EP_TRACKS)[0]} .. ${end} (${store.name})`);
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

if (localAudio.size < 2) {
  giveUp(
    `only ${localAudio.size} of ${emissions.length} days in ${dateRange(end, EP_TRACKS)[0]} .. ${end} ` +
      'still have audio; an EP needs at least two',
  );
}

const ep = await publishEp(
  await assembleEp(emissions, {
    id: `ep-${end}`,
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

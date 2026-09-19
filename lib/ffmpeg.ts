/**
 * ffmpeg, found rather than bundled.
 *
 * It is the one part of the pipeline that is not JavaScript, and it is not
 * always present — a dev machine may not have it, GitHub Actions does. Nothing
 * here throws until ffmpeg is actually needed, so a day can still be rendered
 * and archived as WAV on a machine without it.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);

let cached: string | null | undefined;

export function findFfmpeg(): string | null {
  if (cached !== undefined) return cached;
  const explicit = process.env.FFMPEG_PATH;
  if (explicit) {
    cached = existsSync(explicit) ? explicit : null;
    return cached;
  }
  for (const candidate of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']) {
    if (existsSync(candidate)) {
      cached = candidate;
      return cached;
    }
  }
  cached = null;
  return cached;
}

export function requireFfmpeg(): string {
  const path = findFfmpeg();
  if (!path) {
    throw new Error(
      'ffmpeg not found — install it or set FFMPEG_PATH (see README, "Requirements")',
    );
  }
  return path;
}

function ffprobePath(): string {
  return requireFfmpeg().replace(/ffmpeg$/, 'ffprobe');
}

export async function ffmpeg(args: string[]): Promise<void> {
  // ffmpeg writes its banner and progress to stderr, so a non-zero exit is the
  // only signal that matters; the message is carried up with the error.
  await exec(requireFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    maxBuffer: 8 * 1024 * 1024,
  });
}

export async function audioDuration(file: string): Promise<number> {
  const { stdout } = await exec(ffprobePath(), [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`could not read duration of ${file}`);
  return seconds;
}

/** Loudness target. Quiet enough for a drone, loud enough to hear on a phone. */
export const TARGET_LUFS = -16;

/**
 * WAV in, delivery MP3 out, loudness-normalized.
 *
 * Single-pass loudnorm: the two-pass version is more accurate and needs the
 * whole file analysed first, which doubles the cost of a step that runs seven
 * times a week on tracks that are all made the same way.
 */
export async function masterToMp3(
  input: string,
  output: string,
  metadata: Record<string, string> = {},
): Promise<void> {
  const tags = Object.entries(metadata).flatMap(([key, value]) => [
    '-metadata',
    `${key}=${value}`,
  ]);
  await ffmpeg([
    '-i', input,
    '-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`,
    '-c:a', 'libmp3lame',
    '-q:a', '2',
    ...tags,
    output,
  ]);
}

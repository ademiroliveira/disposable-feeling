/**
 * The poster agent.
 *
 * Owns the sizes and the files; the drawing is sketch.js, which runs in the
 * shared render host beside the music so the two cannot drift apart on seed.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MoodVector } from '../../schema/mood-vector.ts';
import { emissionDir } from '../../lib/paths.ts';
import type { PublishResult, RenderHost } from '../../lib/render/host.ts';

const SKETCH = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'sketch.js'),
  'utf8',
);

/** 5:7, which prints without cropping and reads as a poster rather than a wallpaper. */
export const POSTER_WIDTH = 2000;
export const POSTER_HEIGHT = 2800;
/** The residue. Small enough that a decade of them is still a free Supabase tier. */
export const THUMBNAIL_WIDTH = 480;

export interface PosterMeta extends PublishResult {
  cols: number;
  rows: number;
  accents: number;
  inverted: boolean;
  baseHue: number;
  alignment: number;
}

export interface PosterResult {
  path: string;
  thumbnailPath: string;
  meta: PosterMeta;
}

export async function renderPoster(
  mood: MoodVector,
  host: RenderHost,
): Promise<PosterResult> {
  const dir = emissionDir(mood.date);

  const { files, meta } = await host.renderToFiles<PosterMeta>({
    label: `poster ${mood.date}`,
    libraries: ['p5'],
    sketch: SKETCH,
    args: {
      mood,
      width: POSTER_WIDTH,
      height: POSTER_HEIGHT,
      thumbnailWidth: THUMBNAIL_WIDTH,
    },
    outFiles: {
      poster: join(dir, 'poster.png'),
      thumbnail: join(dir, 'thumbnail.png'),
    },
    timeoutMs: 4 * 60_000,
  });

  return {
    path: files.poster!,
    thumbnailPath: files.thumbnail!,
    meta,
  };
}

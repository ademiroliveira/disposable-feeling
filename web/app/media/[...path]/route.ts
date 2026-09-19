/**
 * Serves the pipeline's local output during development.
 *
 * A deployed site reads Supabase and never reaches this route — the local
 * store keeps absolute file paths that a browser cannot open, and this is what
 * makes `npm run dev` useful straight after a backfill. Paths are resolved
 * against the output directory and anything that escapes it is refused.
 */

import { createReadStream, statSync } from 'node:fs';
import { normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

const OUT = resolve(process.cwd(), process.env.DF_OUT_DIR ?? '../out');

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.json': 'application/json',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const target = resolve(OUT, normalize(path.join('/')));

  if (target !== OUT && !target.startsWith(OUT + sep)) {
    return new Response('not found', { status: 404 });
  }

  let size: number;
  try {
    const stats = statSync(target);
    if (!stats.isFile()) return new Response('not found', { status: 404 });
    size = stats.size;
  } catch {
    return new Response('not found', { status: 404 });
  }

  const extension = target.slice(target.lastIndexOf('.'));
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;

  return new Response(stream, {
    headers: {
      'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'content-length': String(size),
      'cache-control': 'public, max-age=60',
    },
  });
}

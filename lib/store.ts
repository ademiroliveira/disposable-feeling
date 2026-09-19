/**
 * Where emissions live, and where they stop living.
 *
 * Two stores, always in the same order: the local one is the working copy that
 * the pipeline and the variance gate read, and Supabase is the published copy
 * the site reads. Running without Supabase configured is a supported mode —
 * that is how Phase 0 runs.
 *
 * Expiry is the load-bearing part. Audio and poster are deleted after seven
 * days and a record survives: date, mood vector, title, thumbnail. Storage
 * stays flat forever, which is the whole reason the free tier holds.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { Ep } from '../agents/ep-assembly/index.ts';
import type { Emission } from '../schema/mood-vector.ts';
import { EXPIRY_DAYS } from '../schema/mood-vector.ts';
import { isoDate } from './dates.ts';
import { ensureParent, outPath } from './paths.ts';

export interface EmissionFiles {
  audio?: string | null;
  poster?: string | null;
  thumbnail?: string | null;
}

export interface Store {
  readonly name: string;
  save(emission: Emission, files: EmissionFiles): Promise<Emission>;
  list(limit?: number): Promise<Emission[]>;
  get(date: string): Promise<Emission | null>;
  /** Delete expired audio and posters; returns the dates it touched. */
  expire(now?: Date): Promise<string[]>;
}

export function expiresAt(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + EXPIRY_DAYS);
  return at.toISOString();
}

/* ------------------------------- local store ------------------------------ */

const INDEX = () => outPath('emissions', 'index.json');

function readIndex(): Emission[] {
  const file = INDEX();
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Emission[];
  } catch {
    return [];
  }
}

function writeIndex(emissions: Emission[]): void {
  const sorted = [...emissions].sort((a, b) => b.date.localeCompare(a.date));
  writeFileSync(ensureParent(INDEX()), JSON.stringify(sorted, null, 2));
}

export const localStore: Store = {
  name: 'local',

  async save(emission, files) {
    const record: Emission = {
      ...emission,
      audioPath: files.audio ?? null,
      posterPath: files.poster ?? null,
      thumbnailPath: files.thumbnail ?? null,
      expiresAt: expiresAt(emission.date),
    };
    const all = readIndex().filter((e) => e.date !== record.date);
    all.push(record);
    writeIndex(all);
    return record;
  },

  async list(limit) {
    const all = readIndex();
    return limit ? all.slice(0, limit) : all;
  },

  async get(date) {
    return readIndex().find((e) => e.date === date) ?? null;
  },

  async expire(now = new Date()) {
    const all = readIndex();
    const touched: string[] = [];
    for (const emission of all) {
      if (new Date(emission.expiresAt) > now) continue;
      if (!emission.audioPath && !emission.posterPath) continue;
      for (const path of [emission.audioPath, emission.posterPath]) {
        if (path && existsSync(path)) rmSync(path, { force: true });
      }
      emission.audioPath = null;
      emission.posterPath = null;
      touched.push(emission.date);
    }
    if (touched.length > 0) writeIndex(all);
    return touched;
  },
};

/* ----------------------------- supabase store ---------------------------- */

const BUCKETS = {
  audio: 'emission-audio',
  poster: 'emission-posters',
  thumbnail: 'emission-thumbnails',
  ep: 'ep-audio',
} as const;

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY),
  );
}

/**
 * Loaded lazily: `@supabase/supabase-js` opens a websocket client on import,
 * and a Phase 0 run that never touches Supabase should not pay for it.
 */
async function client() {
  const { createClient } = await import('@supabase/supabase-js');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  return createClient(process.env.SUPABASE_URL!, key, {
    auth: { persistSession: false },
  });
}

interface EmissionRow {
  date: string;
  title: string;
  mood: Emission['mood'];
  audio_path: string | null;
  poster_path: string | null;
  thumbnail_path: string | null;
  duration_seconds: number;
  created_at: string;
  expires_at: string;
  render: Emission['render'] | null;
}

function toEmission(row: EmissionRow): Emission {
  return {
    date: row.date,
    title: row.title,
    mood: row.mood,
    audioPath: row.audio_path,
    posterPath: row.poster_path,
    thumbnailPath: row.thumbnail_path,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    render: row.render ?? undefined,
  };
}

async function upload(
  bucket: string,
  date: string,
  file: string | null | undefined,
  contentType: string,
): Promise<string | null> {
  if (!file || !existsSync(file)) return null;
  const supabase = await client();
  const key = `${date}/${basename(file)}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(key, readFileSync(file), { contentType, upsert: true });
  if (error) throw new Error(`supabase upload ${bucket}/${key}: ${error.message}`);
  return supabase.storage.from(bucket).getPublicUrl(key).data.publicUrl;
}

export const supabaseStore: Store = {
  name: 'supabase',

  async save(emission, files) {
    const supabase = await client();
    const record: Emission = {
      ...emission,
      audioPath: await upload(BUCKETS.audio, emission.date, files.audio, 'audio/mpeg'),
      posterPath: await upload(BUCKETS.poster, emission.date, files.poster, 'image/png'),
      thumbnailPath: await upload(
        BUCKETS.thumbnail,
        emission.date,
        files.thumbnail,
        'image/png',
      ),
      expiresAt: expiresAt(emission.date),
    };

    const row: EmissionRow = {
      date: record.date,
      title: record.title,
      mood: record.mood,
      audio_path: record.audioPath,
      poster_path: record.posterPath,
      thumbnail_path: record.thumbnailPath,
      duration_seconds: record.durationSeconds,
      created_at: record.createdAt,
      expires_at: record.expiresAt,
      render: record.render ?? null,
    };
    const { error } = await supabase.from('emissions').upsert(row, { onConflict: 'date' });
    if (error) throw new Error(`supabase upsert ${record.date}: ${error.message}`);
    return record;
  },

  async list(limit = 365) {
    const supabase = await client();
    const { data, error } = await supabase
      .from('emissions')
      .select('*')
      .order('date', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`supabase list: ${error.message}`);
    return (data ?? []).map((row) => toEmission(row as EmissionRow));
  },

  async get(date) {
    const supabase = await client();
    const { data, error } = await supabase
      .from('emissions')
      .select('*')
      .eq('date', date)
      .maybeSingle();
    if (error) throw new Error(`supabase get ${date}: ${error.message}`);
    return data ? toEmission(data as EmissionRow) : null;
  },

  async expire(now = new Date()) {
    const supabase = await client();
    const { data, error } = await supabase
      .from('emissions')
      .select('*')
      .lte('expires_at', now.toISOString())
      .not('audio_path', 'is', null);
    if (error) throw new Error(`supabase expire query: ${error.message}`);

    const touched: string[] = [];
    for (const row of (data ?? []) as EmissionRow[]) {
      // The thumbnail is deliberately left alone — it is the residue.
      for (const [bucket, path] of [
        [BUCKETS.audio, row.audio_path],
        [BUCKETS.poster, row.poster_path],
      ] as const) {
        if (!path) continue;
        const key = path.split(`/${bucket}/`)[1];
        if (key) await supabase.storage.from(bucket).remove([key]);
      }
      const { error: updateError } = await supabase
        .from('emissions')
        .update({ audio_path: null, poster_path: null })
        .eq('date', row.date);
      if (updateError) throw new Error(`supabase expire ${row.date}: ${updateError.message}`);
      touched.push(row.date);
    }
    return touched;
  },
};

/* ----------------------------------- EPs --------------------------------- */

/**
 * Publish an assembled EP.
 *
 * `assembleEp` has already written the audio and the tracklist locally; this
 * is the copy the site links to. Nothing expires an EP — it is the thing the
 * seven-day window exists to produce.
 */
export async function publishEp(ep: Ep): Promise<Ep> {
  if (!supabaseConfigured()) return ep;

  const supabase = await client();
  const audioPath = await upload(BUCKETS.ep, ep.id, ep.audioPath, 'audio/mpeg');

  const { error } = await supabase.from('eps').upsert(
    {
      id: ep.id,
      from_date: ep.from,
      to_date: ep.to,
      audio_path: audioPath,
      duration_seconds: ep.durationSeconds,
      tracks: ep.tracks,
      assembled_at: ep.assembledAt,
    },
    { onConflict: 'id' },
  );
  if (error) throw new Error(`supabase upsert ${ep.id}: ${error.message}`);

  return { ...ep, audioPath: audioPath ?? ep.audioPath };
}

/* --------------------------------- façade -------------------------------- */

/** Local first, then Supabase when it is configured. */
export function openStores(): Store[] {
  return supabaseConfigured() ? [localStore, supabaseStore] : [localStore];
}

/**
 * The store that knows about days this machine did not render.
 *
 * The local index is empty on a fresh CI runner, so the weekly EP job has to
 * read the published archive rather than the working copy.
 */
export function readStore(): Store {
  return supabaseConfigured() ? supabaseStore : localStore;
}

export async function publishEmission(
  emission: Emission,
  files: EmissionFiles,
): Promise<Emission> {
  let record = emission;
  for (const store of openStores()) {
    record = await store.save(record, files);
  }
  return record;
}

/** Today's date, or the date under test. Keeps `isoDate` off every caller. */
export function today(): string {
  return process.env.DF_TODAY ?? isoDate();
}

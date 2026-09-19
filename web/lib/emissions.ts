/**
 * Where the site gets its days.
 *
 * Supabase when it is configured, and the pipeline's local output when it is
 * not — so `npm run dev` after a backfill shows a real archive instead of an
 * empty page. The local path is a development convenience; a deployed site
 * always reads Supabase.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Emission } from '../../schema/mood-vector.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const usingSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

const LOCAL_INDEX = resolve(
  process.cwd(),
  process.env.DF_OUT_DIR ?? '../out',
  'emissions/index.json',
);

interface EmissionRow {
  date: string;
  title: string;
  mood: Emission['mood'];
  render?: Emission['render'];
  audio_path: string | null;
  poster_path: string | null;
  thumbnail_path: string | null;
  duration_seconds: number;
  created_at: string;
  expires_at: string;
}

function fromRow(row: EmissionRow): Emission {
  return {
    date: row.date,
    title: row.title,
    mood: row.mood,
    render: row.render,
    audioPath: row.audio_path,
    posterPath: row.poster_path,
    thumbnailPath: row.thumbnail_path,
    durationSeconds: Number(row.duration_seconds),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

async function fromSupabase(): Promise<Emission[]> {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase
    .from('emissions')
    .select('*')
    .order('date', { ascending: false });
  if (error) throw new Error(`supabase: ${error.message}`);
  return (data ?? []).map((row) => fromRow(row as EmissionRow));
}

async function fromLocal(): Promise<Emission[]> {
  try {
    const raw = await readFile(LOCAL_INDEX, 'utf8');
    return (JSON.parse(raw) as Emission[]).sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

export async function listEmissions(): Promise<Emission[]> {
  return usingSupabase ? fromSupabase() : fromLocal();
}

export async function getEmission(date: string): Promise<Emission | null> {
  const all = await listEmissions();
  return all.find((emission) => emission.date === date) ?? null;
}

/**
 * Supabase stores public URLs; the local store stores absolute file paths,
 * which the browser cannot open. Route those through /media instead.
 */
export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const marker = '/emissions/';
  const index = path.indexOf(marker);
  if (index === -1) return null;
  return `/media/emissions/${path.slice(index + marker.length)}`;
}

export function isPlayable(emission: Emission): boolean {
  return Boolean(emission.audioPath);
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

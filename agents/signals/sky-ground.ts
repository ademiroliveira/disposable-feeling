/**
 * Sky and ground — the uncorrelated variance.
 *
 * News, markets and weather all move together on a big day; a geomagnetic
 * storm does not care what the news thinks. These three replaced Reddit and
 * Google Trends (ToS and rate-limit risk) and are the reason the mood vector
 * has anything to say on a quiet Tuesday.
 *
 *  - Planetary K index: NOAA SWPC for the last week, GFZ Potsdam for history.
 *  - Earthquakes: USGS FDSN, complete back to the 1970s.
 *  - Moon phase: computed, no network at all.
 */

import type { SignalReading } from '../../schema/mood-vector.ts';
import { parseIsoDate } from '../../lib/dates.ts';
import { getJson } from '../../lib/http.ts';
import { describeError } from '../../lib/http.ts';

/* ---------------------------------- Kp ---------------------------------- */

const NOAA_KP = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const GFZ_KP = 'https://kp.gfz.de/app/json/';

interface NoaaKpRow {
  time_tag?: string;
  Kp?: number | string;
}

interface GfzKp {
  Kp?: number[];
  datetime?: string[];
}

async function kpFromNoaa(date: string): Promise<number[]> {
  const rows = await getJson<NoaaKpRow[]>(NOAA_KP, { retries: 2 });
  return rows
    .filter((r) => typeof r.time_tag === 'string' && r.time_tag.startsWith(date))
    .map((r) => Number(r.Kp))
    .filter(Number.isFinite);
}

async function kpFromGfz(date: string): Promise<number[]> {
  const url = `${GFZ_KP}?start=${date}T00:00:00Z&end=${date}T23:59:59Z&index=Kp`;
  const res = await getJson<GfzKp>(url, { retries: 2 });
  return (res.Kp ?? []).map(Number).filter(Number.isFinite);
}

/** NOAA first — it is the named source — then GFZ, which has the archive. */
async function fetchKp(date: string): Promise<number[]> {
  try {
    const noaa = await kpFromNoaa(date);
    if (noaa.length > 0) return noaa;
  } catch {
    // fall through
  }
  return kpFromGfz(date);
}

/* ------------------------------ Earthquakes ------------------------------ */

const USGS = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const MIN_MAGNITUDE = 4.5;

interface UsgsResponse {
  features?: Array<{ properties?: { mag?: number; place?: string } }>;
}

async function fetchQuakes(date: string): Promise<{
  count: number;
  maxMag: number;
  energy: number;
  biggestPlace: string | null;
}> {
  const end = new Date(parseIsoDate(date).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const url =
    `${USGS}?format=geojson&starttime=${date}&endtime=${end}` +
    `&minmagnitude=${MIN_MAGNITUDE}&orderby=magnitude`;
  const res = await getJson<UsgsResponse>(url, { retries: 2, timeoutMs: 30_000 });
  const quakes = (res.features ?? [])
    .map((f) => ({ mag: Number(f.properties?.mag), place: f.properties?.place ?? null }))
    .filter((q) => Number.isFinite(q.mag));

  // Gutenberg-Richter: energy goes as 10^(1.5 M), so one M7 outweighs a
  // hundred M5s. Summing magnitudes would flatten exactly the days we care about.
  const energy = quakes.reduce((sum, q) => sum + 10 ** (1.5 * q.mag), 0);
  return {
    count: quakes.length,
    maxMag: quakes.length > 0 ? Math.max(...quakes.map((q) => q.mag)) : 0,
    energy,
    biggestPlace: quakes[0]?.place ?? null,
  };
}

/* ------------------------------- Moon phase ------------------------------ */

const SYNODIC_MONTH = 29.530588853;
/** A known new moon: 2000-01-06 18:14 UTC. */
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / 86_400_000;

/** Fraction of the synodic month elapsed, 0 = new, 0.5 = full. */
export function moonPhase(date: string): number {
  const days = parseIsoDate(date).getTime() / 86_400_000 + 0.5;
  const phase = ((days - REFERENCE_NEW_MOON) / SYNODIC_MONTH) % 1;
  return phase < 0 ? phase + 1 : phase;
}

/** Illuminated fraction of the disc, 0..1. */
export function moonIllumination(date: string): number {
  return (1 - Math.cos(2 * Math.PI * moonPhase(date))) / 2;
}

export function moonPhaseName(date: string): string {
  const p = moonPhase(date);
  const names = [
    'new moon',
    'waxing crescent',
    'first quarter',
    'waxing gibbous',
    'full moon',
    'waning gibbous',
    'last quarter',
    'waning crescent',
  ];
  return names[Math.round(p * 8) % 8]!;
}

/* -------------------------------- Collector ------------------------------ */

export async function fetchSkyGround(date: string): Promise<SignalReading[]> {
  const readings: SignalReading[] = [];
  const failures: string[] = [];

  try {
    const kp = await fetchKp(date);
    if (kp.length === 0) throw new Error('no Kp samples for that day');
    readings.push({
      source: 'sky-ground',
      metric: 'kp_max',
      value: Math.max(...kp),
      unit: 'Kp',
      // A storm is an agitated, unsettled day whatever the news says.
      affects: { arousal: 1, volatility: 0.8 },
    });
    readings.push({
      source: 'sky-ground',
      metric: 'kp_mean',
      value: kp.reduce((a, b) => a + b, 0) / kp.length,
      unit: 'Kp',
      affects: { arousal: 0.5 },
    });
  } catch (err) {
    failures.push(`kp: ${describeError(err)}`);
  }

  try {
    const q = await fetchQuakes(date);
    readings.push({
      source: 'sky-ground',
      metric: 'quake_count',
      value: q.count,
      unit: `count >=M${MIN_MAGNITUDE}`,
      affects: { arousal: 0.5, volatility: 0.5 },
    });
    readings.push({
      source: 'sky-ground',
      metric: 'quake_energy_log',
      value: q.energy > 0 ? Math.log10(q.energy) : 0,
      unit: 'log10 energy',
      affects: { arousal: 0.8, valence: -0.5 },
      note: q.biggestPlace ? `largest: M${q.maxMag} ${q.biggestPlace}` : undefined,
    });
  } catch (err) {
    failures.push(`quakes: ${describeError(err)}`);
  }

  // Never fails, never rate-limited, and it is the one signal with a known
  // period — it keeps a dead-flat news week from producing identical days.
  readings.push({
    source: 'sky-ground',
    metric: 'moon_illumination',
    value: moonIllumination(date),
    unit: 'fraction',
    affects: { valence: 0.3, coherence: 0.3 },
    note: moonPhaseName(date),
  });
  readings.push({
    source: 'sky-ground',
    metric: 'moon_phase',
    value: moonPhase(date),
    unit: 'cycle',
    affects: {},
  });

  if (readings.length <= 2 && failures.length > 0) {
    throw new Error(`sky-ground: only the moon answered (${failures.join('; ')})`);
  }
  return readings;
}

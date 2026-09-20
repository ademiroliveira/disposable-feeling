/**
 * GDELT — global news tone and volume, from the raw export files.
 *
 * Caveat worth keeping in front of you (and stated on the site): this is the
 * feeling of *the news*, not of the world. English-language coverage, weighted
 * by how much of it there is. Everything downstream inherits that bias.
 *
 * This reads GDELT's 15-minute event exports rather than the DOC 2.0 API,
 * which was measured and found unusable here for two separate reasons:
 *
 *   - Rate limiting. A 30-day warm-up from a runner with its own egress IP got
 *     2 days out of 30, with backoff up to 96 seconds per attempt. It refuses
 *     roughly nine requests in ten regardless of how politely they are spaced.
 *   - Lag. Two ranged requests with different windows both stopped at the same
 *     date, a week behind: the API has no settled data for the day the
 *     pipeline is actually emitting. No amount of retrying fixes that.
 *
 * The export files have neither problem. They are static objects on a CDN,
 * published every 15 minutes, 40–130 KB each, with history back to 2015 —
 * which is also what GDELT's own rate-limit notice tells you to switch to.
 *
 * One consequence: tone here is per *event* rather than per article, so its
 * absolute level differs from the API's. That is invisible downstream, because
 * every metric is scored as a deviation from its own rolling baseline — but a
 * baseline built from API values cannot be compared with these.
 */

import { unzipSync } from 'fflate';

import type { SignalReading } from '../../schema/mood-vector.ts';
import { getBuffer, getText, describeError } from '../../lib/http.ts';
import { gdeltStamp } from '../../lib/dates.ts';
import { makeThrottle } from '../../lib/throttle.ts';

const EXPORT_BASE = 'https://data.gdeltproject.org/gdeltv2';

/** GDELT publishes a file every 15 minutes: 96 slots a day. */
const SLOTS_IN_DAY = 96;

/**
 * How many of those 96 to read. Hourly is plenty for a daily average and
 * keeps a day's download to a couple of megabytes.
 */
const SLOTS_PER_DAY = Math.max(2, Number(process.env.GDELT_SLOTS_PER_DAY ?? 24));

/** Columns in the GDELT 2.0 event schema, zero-indexed. */
const COL_NUM_ARTICLES = 32;
const COL_AVG_TONE = 33;

/** Download a few at a time: no rate limit to respect, but no need to burst. */
const CONCURRENCY = 6;

export interface GdeltOptions {
  /** Fetch article titles too. Best-effort; the API this uses usually refuses. */
  headlines?: boolean;
  query?: string;
}

interface Slot {
  stamp: string;
  tones: number[];
  articles: number;
}

/** Every 15-minute slot of a day, oldest first. */
export function slotsForDate(date: string): string[] {
  const day = date.replace(/-/g, '');
  return Array.from({ length: SLOTS_IN_DAY }, (_, i) => {
    const minutes = i * 15;
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `${day}${hh}${mm}00`;
  });
}

/**
 * The slots to actually read: evenly spread across the day, and never ahead of
 * the clock — a run at 23:30 has 94 of the day's 96 slots to choose from, and
 * asking for the other two is just two 404s.
 */
export function sampleSlots(date: string, now: Date = new Date()): string[] {
  const published = slotsForDate(date).filter((stamp) => stamp <= gdeltStamp2(now));
  if (published.length === 0) return [];
  const step = published.length / Math.min(SLOTS_PER_DAY, published.length);
  const picked: string[] = [];
  for (let i = 0; i < published.length; i += step) {
    picked.push(published[Math.floor(i)]!);
  }
  return [...new Set(picked)];
}

/** `YYYYMMDDHHMMSS` for an instant, which is how the files are named. */
function gdeltStamp2(at: Date): string {
  return at.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

async function fetchSlot(stamp: string): Promise<Slot> {
  const zipped = await getBuffer(`${EXPORT_BASE}/${stamp}.export.CSV.zip`, { retries: 2 });
  const entries = unzipSync(new Uint8Array(zipped));
  const name = Object.keys(entries)[0];
  if (!name) throw new Error(`${stamp}: empty archive`);

  const text = Buffer.from(entries[name]!).toString('utf8');
  const tones: number[] = [];
  let articles = 0;

  for (const line of text.split('\n')) {
    if (!line) continue;
    const columns = line.split('\t');
    if (columns.length <= COL_AVG_TONE) continue;
    const tone = Number(columns[COL_AVG_TONE]);
    if (Number.isFinite(tone)) tones.push(tone);
    const count = Number(columns[COL_NUM_ARTICLES]);
    if (Number.isFinite(count)) articles += count;
  }

  if (tones.length === 0) throw new Error(`${stamp}: no tone values`);
  return { stamp, tones, articles };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export async function fetchGdelt(
  date: string,
  opts: GdeltOptions = {},
): Promise<SignalReading[]> {
  const wanted = sampleSlots(date);
  if (wanted.length === 0) {
    throw new Error(`no GDELT slots published yet for ${date}`);
  }

  const slots: Slot[] = [];
  const failures: string[] = [];
  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      wanted.slice(i, i + CONCURRENCY).map(async (stamp) => {
        try {
          return await fetchSlot(stamp);
        } catch (err) {
          failures.push(`${stamp}: ${describeError(err)}`);
          return null;
        }
      }),
    );
    for (const slot of batch) if (slot) slots.push(slot);
  }

  // A couple of missing slots is nothing; a day that is mostly holes is not a
  // reading of that day.
  if (slots.length < Math.max(2, wanted.length / 3)) {
    throw new Error(
      `only ${slots.length}/${wanted.length} slots for ${date}` +
        (failures[0] ? ` (${failures[0]})` : ''),
    );
  }

  const slotMeans = slots.map((slot) => mean(slot.tones));
  const slotArticles = slots.map((slot) => slot.articles);
  const allTones = slots.flatMap((slot) => slot.tones);

  const readings: SignalReading[] = [
    {
      source: 'gdelt',
      metric: 'tone_mean',
      value: mean(allTones),
      unit: 'tone',
      // Event-level tone, so the absolute level differs from the DOC API's.
      // The baseline is what makes this meaningful, not the sign.
      affects: { valence: 1 },
    },
    {
      source: 'gdelt',
      metric: 'tone_spread',
      value: stdev(slotMeans),
      unit: 'tone sd',
      // A day where coverage disagrees with itself is a fragmented day.
      affects: { volatility: 1, coherence: -1 },
    },
    {
      source: 'gdelt',
      metric: 'volume',
      value: mean(slotArticles),
      unit: 'articles/15min',
      affects: { arousal: 1 },
    },
    {
      source: 'gdelt',
      metric: 'volume_swing',
      value: stdev(slotArticles) / Math.max(mean(slotArticles), 1e-6),
      unit: 'cv',
      affects: { volatility: 1 },
    },
  ];

  if (opts.headlines !== false) {
    const titles = await fetchHeadlines(date, opts.query);
    if (titles.length > 0) {
      readings.push({
        source: 'gdelt',
        metric: 'headlines',
        value: titles.length,
        unit: 'count',
        affects: {},
        note: titles.join(' | '),
      });
    }
  }

  return readings;
}

/* -------------------------------- headlines ------------------------------- */

/**
 * Article titles, for the synthesis prompt's themes.
 *
 * The export files carry event codes and source URLs but not headlines, so
 * this is the one thing still asking the DOC API — which refuses most of the
 * time and has nothing for recent dates. It is best-effort on purpose: losing
 * it costs themes some specificity and nothing else, and once
 * ANTHROPIC_API_KEY is set Claude writes them from the signals regardless.
 */
const DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const DEFAULT_QUERY =
  process.env.GDELT_QUERY ?? '(world OR people OR government OR market OR city) sourcelang:eng';
const throttled = makeThrottle(Number(process.env.GDELT_MIN_INTERVAL_MS ?? 6000));

interface ArtListResponse {
  articles?: Array<{ title?: string }>;
}

async function fetchHeadlines(date: string, query?: string): Promise<string[]> {
  const params = new URLSearchParams({
    query: query ?? DEFAULT_QUERY,
    format: 'json',
    mode: 'artlist',
    maxrecords: '25',
    sort: 'hybridrel',
    startdatetime: gdeltStamp(date),
    enddatetime: gdeltStamp(date, true),
  });

  try {
    const text = await throttled(() =>
      getText(`${DOC_API}?${params.toString()}`, { retries: 1, timeoutMs: 20_000 }),
    );
    // The rate-limit notice arrives with HTTP 200, so sniff the body.
    if (text.trimStart()[0] !== '{') return [];
    const list = JSON.parse(text) as ArtListResponse;
    return (list.articles ?? [])
      .map((article) => (article.title ?? '').trim())
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    return [];
  }
}

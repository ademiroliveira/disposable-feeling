/**
 * GDELT — global news tone and volume.
 *
 * Caveat worth keeping in front of you (and stated on the site): this is the
 * feeling of *the news*, not of the world. English-language coverage, weighted
 * by how much of it there is. Everything downstream inherits that bias.
 *
 * GDELT asks for one request every five seconds and answers a plain-text
 * scolding — with HTTP 200 — when you ignore it, so requests here go through a
 * module-level throttle and the response is sniffed before it is parsed.
 */

import type { SignalReading } from '../../schema/mood-vector.ts';
import { gdeltStamp } from '../../lib/dates.ts';
import { getText } from '../../lib/http.ts';

const BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

/**
 * A deliberately broad slice of English coverage. Narrow it and you are
 * measuring a topic, not a mood; widen it past GDELT's stopword list and you
 * get nothing back.
 */
const DEFAULT_QUERY =
  process.env.GDELT_QUERY ?? '(world OR people OR government OR market OR city) sourcelang:eng';

const MIN_INTERVAL_MS = Number(process.env.GDELT_MIN_INTERVAL_MS ?? 6000);

let lastRequestAt = 0;

/** Serializes GDELT calls and keeps them at least MIN_INTERVAL_MS apart. */
let queue: Promise<unknown> = Promise.resolve();

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive even when one call rejects.
  queue = run.catch(() => undefined);
  return run;
}

interface TimelinePoint {
  date: string;
  value: number;
}

interface TimelineResponse {
  timeline?: Array<{ series?: string; data?: TimelinePoint[] }>;
}

interface ArtListResponse {
  articles?: Array<{ title?: string; domain?: string; seendate?: string }>;
}

/** GDELT answers its rate-limit notice with HTTP 200, so sniff the body. */
function isRefusal(text: string): boolean {
  const head = text.trimStart().slice(0, 1);
  return head !== '{' && head !== '[';
}

const RATE_LIMIT_RETRIES = Number(process.env.GDELT_RATE_LIMIT_RETRIES ?? 4);

async function gdeltJson<T>(params: Record<string, string>): Promise<T> {
  const url = `${BASE}?${new URLSearchParams(params).toString()}`;
  let refusal = 'empty response';

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    if (attempt > 0) {
      // The notice is shared across everyone on this egress IP, so backing
      // off further than the documented five seconds is the only cure.
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS * 2 ** attempt));
    }
    const text = await throttled(() => getText(url, { retries: 2, timeoutMs: 30_000 }));
    if (!isRefusal(text)) return JSON.parse(text) as T;
    refusal = text.trim().slice(0, 140);
    // A malformed query is refused identically every time; don't burn retries.
    if (!/limit requests/i.test(refusal)) break;
  }
  throw new Error(`GDELT refused: ${refusal}`);
}

function seriesPoints(res: TimelineResponse): number[] {
  const series = res.timeline?.[0]?.data ?? [];
  return series.map((p) => Number(p.value)).filter((n) => Number.isFinite(n));
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export interface GdeltOptions {
  /** Fetch article titles too. Costs one more throttled request. */
  headlines?: boolean;
  query?: string;
}

export async function fetchGdelt(
  date: string,
  opts: GdeltOptions = {},
): Promise<SignalReading[]> {
  const query = opts.query ?? DEFAULT_QUERY;
  const window = {
    query,
    format: 'json',
    startdatetime: gdeltStamp(date),
    enddatetime: gdeltStamp(date, true),
  };

  const tone = await gdeltJson<TimelineResponse>({ ...window, mode: 'timelinetone' });
  const tonePoints = seriesPoints(tone);
  if (tonePoints.length === 0) throw new Error('GDELT returned no tone points');

  const volume = await gdeltJson<TimelineResponse>({ ...window, mode: 'timelinevolraw' });
  const volumePoints = seriesPoints(volume);

  const readings: SignalReading[] = [
    {
      source: 'gdelt',
      metric: 'tone_mean',
      value: mean(tonePoints),
      unit: 'tone',
      // GDELT tone is negative-leaning almost always; the baseline is what
      // makes this meaningful, not the sign.
      affects: { valence: 1 },
    },
    {
      source: 'gdelt',
      metric: 'tone_spread',
      value: stdev(tonePoints),
      unit: 'tone sd',
      // A day where coverage disagrees with itself is a fragmented day.
      affects: { volatility: 1, coherence: -1 },
    },
  ];

  if (volumePoints.length > 0) {
    readings.push({
      source: 'gdelt',
      metric: 'volume',
      value: mean(volumePoints),
      unit: 'articles/15min',
      affects: { arousal: 1 },
    });
    readings.push({
      source: 'gdelt',
      metric: 'volume_swing',
      value: stdev(volumePoints) / Math.max(mean(volumePoints), 1e-6),
      unit: 'cv',
      affects: { volatility: 1 },
    });
  }

  if (opts.headlines !== false) {
    try {
      const list = await gdeltJson<ArtListResponse>({
        ...window,
        mode: 'artlist',
        maxrecords: '25',
        sort: 'hybridrel',
      });
      const titles = (list.articles ?? [])
        .map((a) => (a.title ?? '').trim())
        .filter(Boolean)
        .slice(0, 20);
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
    } catch {
      // Headlines are colour for the synthesis prompt, not a dimension.
      // Losing them costs themes some specificity and nothing else.
    }
  }

  return readings;
}

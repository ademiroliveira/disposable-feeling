/**
 * THE contract.
 *
 * Every agent in this repo imports this file and nothing else imports it from
 * the outside. Signal agents produce `SignalReading`s, the synthesis agent
 * reduces a day's readings to one `MoodVector`, and the music and poster
 * agents read that vector — and only that vector — to decide what a day sounds
 * and looks like. If a generator needs a new input, it goes here first.
 */

/** Six dimensions, as agreed in the build plan. */
export const MOOD_DIMENSIONS = [
  'valence',
  'arousal',
  'volatility',
  'coherence',
] as const;

export type MoodDimension = (typeof MOOD_DIMENSIONS)[number];

/**
 * The four numeric dimensions, plus themes and seed, make the six.
 *
 * All four numbers are *deviations from a rolling 30-day baseline*, clamped to
 * [-1, 1]. Zero is not "neutral" in the abstract — it is "same as the last
 * thirty days". A world that is permanently mildly anxious reads as 0, and a
 * genuinely calm Tuesday reads positive. This is the whole reason the days are
 * distinguishable; see `score()` below.
 */
export interface MoodVector {
  /** ISO date (UTC) the vector describes: `YYYY-MM-DD`. */
  date: string;
  /** Pleasant ← → unpleasant, relative to baseline. */
  valence: number;
  /** Energy: still ← → agitated, relative to baseline. */
  arousal: number;
  /** How much the day's signals moved, relative to baseline. */
  volatility: number;
  /** Consensus ← → fragmentation. Positive means the signals agree. */
  coherence: number;
  /** Exactly three free-text themes, lowercase, one or two words each. */
  themes: [string, string, string];
  /** Two to six words. Becomes the poster's typography and the track title. */
  title: string;
  /** Drives every generator. Derived from the date so a day is reproducible. */
  seed: number;
  /** Where the numbers came from, for the archive and for debugging. */
  provenance: MoodProvenance;
}

export interface MoodProvenance {
  /** `claude` when the synthesis agent called the API, `offline` otherwise. */
  synthesizer: 'claude' | 'offline';
  /** Model id when `synthesizer === 'claude'`. */
  model?: string;
  /** Signal sources that actually returned data for this day. */
  sources: string[];
  /** Sources that were asked and failed or were skipped, with the reason. */
  missing: Array<{ source: string; reason: string }>;
  /** How many days of history the baseline was computed over. */
  baselineDays: number;
  /** ISO timestamp the vector was synthesized at. */
  synthesizedAt: string;
}

/* ------------------------------------------------------------------ *
 * Signals
 * ------------------------------------------------------------------ */

/** A source is one fetcher: `gdelt`, `markets`, `weather`, `sky-ground`. */
export type SignalSource = 'gdelt' | 'markets' | 'weather' | 'sky-ground';

/**
 * One measured quantity for one day.
 *
 * `value` is in the metric's own units — Kp index, degrees Celsius, percent
 * change. Normalization against the baseline happens in synthesis, not here,
 * so a fetcher never has to know what "high" means.
 */
export interface SignalReading {
  source: SignalSource;
  /** Stable key, e.g. `tone`, `btc_volatility_pct`, `kp_max`. */
  metric: string;
  value: number;
  /** Units, for the archive. Free text: `°C`, `%`, `Kp`, `count`. */
  unit: string;
  /**
   * Which mood dimensions this metric is allowed to influence, and in which
   * direction. Synthesis uses this when it has to work offline, and the
   * Claude prompt uses it as a hint rather than a rule.
   */
  affects: Partial<Record<MoodDimension, number>>;
  /** Anything the synthesis prompt can quote as context: headlines, place names. */
  note?: string;
}

/** Everything known about one day, before it becomes a mood. */
export interface DaySignals {
  date: string;
  readings: SignalReading[];
  missing: Array<{ source: string; reason: string }>;
}

/* ------------------------------------------------------------------ *
 * Emissions
 * ------------------------------------------------------------------ */

/** What the generators chose, kept for the archive and for the variance gate. */
export interface RenderNotes {
  music: Record<string, unknown>;
  poster: Record<string, unknown>;
}

/**
 * What a day produces. Audio and poster are disposable; everything else here
 * is the residue that outlives them.
 */
export interface Emission {
  date: string;
  title: string;
  mood: MoodVector;
  /** Null once the seven-day window has passed and the audio was deleted. */
  audioPath: string | null;
  /** Null once the seven-day window has passed and the poster was deleted. */
  posterPath: string | null;
  /** Survives forever: a small still of the poster. */
  thumbnailPath: string | null;
  durationSeconds: number;
  createdAt: string;
  /** When audio and poster become unplayable. */
  expiresAt: string;
  /** Survives expiry: it is how a deleted day can still be explained. */
  render?: RenderNotes;
}

/** How long an emission stays playable. The EP must be assembled inside this. */
export const EXPIRY_DAYS = 7;

/** Tracks per EP: one per day of the window, which is the most expiry allows. */
export const EP_TRACKS = EXPIRY_DAYS;

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

export function clamp(value: number, min = -1, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Score a raw value as a deviation from a baseline window.
 *
 * Returns a z-score squashed into [-1, 1]. A flat baseline (every day
 * identical, or fewer than two days of history) returns 0 rather than
 * dividing by zero — a day with no history to compare against is, correctly,
 * "no different from usual".
 */
export function score(value: number, baseline: number[]): number {
  const history = baseline.filter((n) => Number.isFinite(n));
  if (history.length < 2) return 0;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance =
    history.reduce((a, b) => a + (b - mean) ** 2, 0) / (history.length - 1);
  const sd = Math.sqrt(variance);
  if (sd < 1e-9) return 0;
  // tanh(z / 2) keeps ±2 sd inside about ±0.76 and never saturates hard.
  return clamp(Math.tanh((value - mean) / sd / 2));
}

/**
 * How far apart two days are, in mood space. Used by the Phase 0 variance gate
 * and by EP sequencing, which orders tracks for contrast rather than by date.
 */
export function moodDistance(a: MoodVector, b: MoodVector): number {
  const numeric = Math.sqrt(
    MOOD_DIMENSIONS.reduce((sum, dim) => sum + (a[dim] - b[dim]) ** 2, 0) /
      MOOD_DIMENSIONS.length,
  );
  const shared = a.themes.filter((t) => b.themes.includes(t)).length;
  const thematic = shared / a.themes.length;
  return numeric * 0.75 + (1 - thematic) * 0.25;
}

/** Deterministic seed for a date, so re-running a day reproduces it exactly. */
export function seedForDate(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Throws if a vector is not something the generators can safely consume. */
export function assertMoodVector(v: MoodVector): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
    throw new Error(`mood vector: bad date ${v.date}`);
  }
  for (const dim of MOOD_DIMENSIONS) {
    const n = v[dim];
    if (!Number.isFinite(n) || n < -1 || n > 1) {
      throw new Error(`mood vector: ${dim} out of range (${n})`);
    }
  }
  if (v.themes.length !== 3 || v.themes.some((t) => !t.trim())) {
    throw new Error('mood vector: needs exactly three non-empty themes');
  }
  const words = v.title.trim().split(/\s+/).length;
  if (words < 2 || words > 6) {
    throw new Error(`mood vector: title must be 2-6 words, got ${words}`);
  }
  if (!Number.isInteger(v.seed) || v.seed < 0) {
    throw new Error(`mood vector: seed must be a non-negative integer`);
  }
}

/**
 * The mood synthesis agent.
 *
 * One call per day: a day of signals in, one `MoodVector` out. Everything
 * downstream reads the vector and never the signals, so this is the only place
 * that decides what a day *means*.
 *
 * The arithmetic runs first and always (see baseline.ts). Claude is asked to
 * adjust it within a bounded range and to supply the things arithmetic cannot:
 * three themes and a two-to-six word title. If there is no API key, or the
 * call fails, the arithmetic stands on its own and provenance records it.
 */

import Anthropic from '@anthropic-ai/sdk';

import type {
  DaySignals,
  MoodDimension,
  MoodVector,
} from '../../schema/mood-vector.ts';
import {
  MOOD_DIMENSIONS,
  assertMoodVector,
  clamp,
  seedForDate,
} from '../../schema/mood-vector.ts';
import { describeError } from '../../lib/http.ts';
import { buildBaseline, notableMetrics, reduceDimensions, scoreDay } from './baseline.ts';
import { makeTitle, pickThemes } from './offline.ts';

const MODEL = process.env.DF_SYNTHESIS_MODEL ?? 'claude-haiku-4-5-20251001';

/** How far Claude may move a computed dimension. The data still leads. */
const MAX_ADJUSTMENT = 0.35;

export interface SynthesisOptions {
  /** Past days, most recent first or last — order does not matter. */
  history?: DaySignals[];
  /** Force the arithmetic path even when a key is present. */
  offline?: boolean;
}

export async function synthesizeMood(
  day: DaySignals,
  opts: SynthesisOptions = {},
): Promise<MoodVector> {
  const history = (opts.history ?? []).filter((d) => d.date !== day.date);
  const baseline = buildBaseline(history);
  const scored = scoreDay(day, baseline);
  const computed = reduceDimensions(scored);
  const seed = seedForDate(day.date);

  const base: MoodVector = {
    date: day.date,
    ...computed,
    themes: pickThemes(scored, computed, seed),
    title: makeTitle(computed, seed),
    seed,
    provenance: {
      synthesizer: 'offline',
      sources: [...new Set(day.readings.map((r) => r.source))],
      missing: day.missing,
      baselineDays: history.length,
      synthesizedAt: new Date().toISOString(),
    },
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (opts.offline || !apiKey) {
    assertMoodVector(base);
    return base;
  }

  try {
    const refined = await askClaude(apiKey, day, scored, computed, base);
    assertMoodVector(refined);
    return refined;
  } catch (err) {
    // A missed API call is not a missed day.
    console.warn(`synthesis: falling back to offline (${describeError(err)})`);
    assertMoodVector(base);
    return base;
  }
}

/* --------------------------------- Claude -------------------------------- */

interface ClaudeReply {
  valence?: number;
  arousal?: number;
  volatility?: number;
  coherence?: number;
  themes?: string[];
  title?: string;
}

function buildPrompt(
  day: DaySignals,
  scored: ReturnType<typeof scoreDay>,
  computed: Record<MoodDimension, number>,
): string {
  const notable = notableMetrics(scored, 8).map(
    (m) =>
      `- ${m.key}: ${m.raw.toFixed(3)} ${m.unit} (${m.z >= 0 ? '+' : ''}${m.z.toFixed(2)} vs 30-day baseline)` +
      (m.note ? `\n  note: ${m.note.slice(0, 400)}` : ''),
  );
  const missing = day.missing.map((m) => `- ${m.source}: ${m.reason}`);

  return [
    `Date: ${day.date}`,
    '',
    'Computed dimensions (deviation from a rolling 30-day baseline, -1..1):',
    ...MOOD_DIMENSIONS.map((d) => `- ${d}: ${computed[d].toFixed(3)}`),
    '',
    'Signals that moved most today:',
    ...notable,
    ...(missing.length > 0 ? ['', 'Sources that did not report:', ...missing] : []),
  ].join('\n');
}

const SYSTEM = `You name the mood of a single day for a generative art pipeline. One day in, one small JSON object out.

The four numbers are already computed from the data. Adjust each by at most ${MAX_ADJUSTMENT} when the signals clearly warrant it — a large earthquake or a genuinely calm news day — and otherwise return them unchanged. You are a second opinion on arithmetic, not a replacement for it.

Then supply what the arithmetic cannot:
- themes: exactly three, lowercase, one or two words each, drawn from what actually happened that day. Concrete beats abstract: "flooded rail line" over "disruption". Never name a person.
- title: two to six words, lowercase, evocative rather than descriptive. It is set as typography on a poster and used as a track title. No colons, no quotation marks, no date.

Respond with JSON only, no prose and no code fence:
{"valence":0.0,"arousal":0.0,"volatility":0.0,"coherence":0.0,"themes":["","",""],"title":""}`;

async function askClaude(
  apiKey: string,
  day: DaySignals,
  scored: ReturnType<typeof scoreDay>,
  computed: Record<MoodDimension, number>,
  base: MoodVector,
): Promise<MoodVector> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 1,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(day, scored, computed) }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  const reply = parseReply(text);

  const dimensions = {} as Record<MoodDimension, number>;
  for (const dim of MOOD_DIMENSIONS) {
    const suggested = reply[dim];
    dimensions[dim] =
      typeof suggested === 'number' && Number.isFinite(suggested)
        ? clamp(
            computed[dim] +
              clamp(suggested - computed[dim], -MAX_ADJUSTMENT, MAX_ADJUSTMENT),
          )
        : computed[dim];
  }

  const themes = (reply.themes ?? [])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase())
    .slice(0, 3);
  const title = (reply.title ?? '').trim().toLowerCase().replace(/["':]/g, '');
  const titleWords = title.split(/\s+/).filter(Boolean).length;

  return {
    ...base,
    ...dimensions,
    themes: themes.length === 3 ? (themes as [string, string, string]) : base.themes,
    title: titleWords >= 2 && titleWords <= 6 ? title : base.title,
    provenance: { ...base.provenance, synthesizer: 'claude', model: MODEL },
  };
}

/** Models sometimes wrap JSON in a fence or a sentence; take the object. */
function parseReply(text: string): ClaudeReply {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(text.slice(start, end + 1)) as ClaudeReply;
}

export { buildBaseline, scoreDay, reduceDimensions } from './baseline.ts';

/**
 * The offline synthesizer.
 *
 * Phase 0 is a gate you want to be able to run on an afternoon without
 * plumbing an API key through, and a pipeline that dies because one HTTP call
 * failed is a pipeline that misses a day. So the numbers are computed
 * arithmetically, and themes and title are drawn from the day's own headlines
 * and a seeded word bank.
 *
 * It is deliberately blunter than the Claude path: the vocabulary is fixed, so
 * two days with the same shape get similar titles. That is fine for a gate and
 * wrong for a release — `synthesizer: 'offline'` is recorded in provenance so
 * the archive can say which one it was.
 */

import type { MoodDimension } from '../../schema/mood-vector.ts';
import { makeRng } from '../../lib/rng.ts';
import type { ScoredMetric } from './baseline.ts';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'has', 'have', 'are',
  'was', 'were', 'will', 'its', 'his', 'her', 'their', 'says', 'said', 'new',
  'after', 'over', 'into', 'out', 'about', 'more', 'than', 'what', 'when',
  'how', 'why', 'who', 'you', 'your', 'our', 'one', 'two', 'can', 'could',
  'would', 'should', 'may', 'amid', 'against', 'com', 'org', 'www', 'news',
  'update', 'updates', 'report', 'reports', 'live', 'watch', 'video', 'photos',
  'here', 'been', 'but', 'not', 'all', 'why', 'get', 'now', 'top', 'first',
  'last', 'year', 'years', 'day', 'days', 'week', 'today',
]);

/** Frequent, non-trivial words from the day's headlines. */
export function themesFromHeadlines(headlines: string, count = 3): string[] {
  const counts = new Map<string, number>();
  for (const raw of headlines.toLowerCase().split(/[^a-z']+/)) {
    const word = raw.replace(/^'+|'+$/g, '');
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([word]) => word);
}

/** Themes the sky and ground can supply when the news gives nothing. */
function fallbackThemes(scored: ScoredMetric[]): string[] {
  const themes: string[] = [];
  const moon = scored.find((m) => m.key === 'sky-ground.moon_illumination');
  if (moon?.note) themes.push(moon.note);
  const quake = scored.find((m) => m.key === 'sky-ground.quake_energy_log');
  if (quake && quake.z > 0.3) themes.push('shaken ground');
  const kp = scored.find((m) => m.key === 'sky-ground.kp_max');
  if (kp && kp.z > 0.3) themes.push('geomagnetic storm');
  return [...themes, 'ordinary weather', 'held breath', 'distant traffic'];
}

export function pickThemes(scored: ScoredMetric[]): [string, string, string] {
  const headlines = scored.find((m) => m.key === 'gdelt.headlines')?.note ?? '';
  const fromNews = headlines ? themesFromHeadlines(headlines) : [];
  const pool = [...fromNews, ...fallbackThemes(scored)];
  const chosen: string[] = [];
  for (const theme of pool) {
    if (chosen.length === 3) break;
    if (!chosen.includes(theme)) chosen.push(theme);
  }
  return chosen as [string, string, string];
}

/* --------------------------------- Titles -------------------------------- */

/**
 * Word bank indexed by the valence/arousal quadrant. Five or six of each so
 * the seed has something to choose between; the shape of the title comes from
 * the templates below.
 */
const VOCAB = {
  calmPleasant: {
    adj: ['slow', 'pale', 'soft', 'wide', 'quiet', 'level'],
    noun: ['morning', 'harbour', 'field', 'glass', 'shallows', 'meadow'],
  },
  calmUnpleasant: {
    adj: ['grey', 'flat', 'long', 'cold', 'low', 'empty'],
    noun: ['corridor', 'waiting room', 'tide', 'fog', 'ledger', 'afternoon'],
  },
  agitatedPleasant: {
    adj: ['bright', 'loud', 'quick', 'open', 'hot', 'restless'],
    noun: ['signal', 'crowd', 'engine', 'carnival', 'wire', 'current'],
  },
  agitatedUnpleasant: {
    adj: ['sharp', 'iron', 'hard', 'thin', 'burnt', 'split'],
    noun: ['alarm', 'fracture', 'static', 'siren', 'rupture', 'grid'],
  },
} as const;

const TEMPLATES = [
  '{adj} {noun}',
  'the {adj} {noun}',
  '{noun} in the {adj} hours',
  '{noun} and {noun2}',
  'nothing but {adj} {noun}',
  'a {adj} kind of {noun}',
] as const;

function quadrant(d: Record<MoodDimension, number>): keyof typeof VOCAB {
  const pleasant = d.valence >= 0;
  const agitated = d.arousal >= 0;
  if (agitated) return pleasant ? 'agitatedPleasant' : 'agitatedUnpleasant';
  return pleasant ? 'calmPleasant' : 'calmUnpleasant';
}

export function makeTitle(
  dimensions: Record<MoodDimension, number>,
  seed: number,
): string {
  const rng = makeRng(seed).fork('title');
  const bank = VOCAB[quadrant(dimensions)];
  const template = rng.pick(TEMPLATES);
  const noun = rng.pick(bank.noun);
  const title = template
    .replace('{adj}', rng.pick(bank.adj))
    .replace('{noun2}', rng.pick(bank.noun.filter((n) => n !== noun)))
    .replace('{noun}', noun);

  // The contract says two to six words, and "{noun} and {noun2}" can produce
  // a two-word noun on each side. Trim rather than risk a throw.
  const words = title.split(/\s+/);
  return words.length <= 6 ? title : words.slice(0, 6).join(' ');
}

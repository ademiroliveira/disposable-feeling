import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertMoodVector,
  moodDistance,
  score,
  seedForDate,
} from '../schema/mood-vector.ts';
import type { MoodVector } from '../schema/mood-vector.ts';
import { sequenceForContrast } from '../agents/ep-assembly/index.ts';
import { dateRange, daysBetween, addDays } from '../lib/dates.ts';

function mood(date: string, overrides: Partial<MoodVector> = {}): MoodVector {
  return {
    date,
    valence: 0,
    arousal: 0,
    volatility: 0,
    coherence: 0,
    themes: ['one', 'two', 'three'],
    title: 'a quiet day',
    seed: seedForDate(date),
    provenance: {
      synthesizer: 'offline',
      sources: [],
      missing: [],
      baselineDays: 0,
      synthesizedAt: '2026-09-18T00:00:00.000Z',
    },
    ...overrides,
  };
}

test('score is a deviation, not an absolute', () => {
  // A permanently negative metric reads as zero when today matches the norm.
  assert.equal(score(-5, [-5, -5, -5, -5]), 0);
  assert.ok(score(-1, [-5, -5.2, -4.8, -5.1]) > 0.5);
  assert.ok(score(-9, [-5, -5.2, -4.8, -5.1]) < -0.5);
});

test('score refuses to guess without history', () => {
  assert.equal(score(3, []), 0);
  assert.equal(score(3, [1]), 0);
});

test('mood distance counts themes as well as numbers', () => {
  const a = mood('2026-09-01', { valence: 1, themes: ['x', 'y', 'z'] });
  const b = mood('2026-09-02', { valence: 1, themes: ['x', 'y', 'z'] });
  const c = mood('2026-09-03', { valence: 1, themes: ['p', 'q', 'r'] });
  assert.equal(moodDistance(a, b), 0);
  assert.ok(moodDistance(a, c) > 0.2);
});

test('seeds are stable and date-specific', () => {
  assert.equal(seedForDate('2026-09-18'), seedForDate('2026-09-18'));
  assert.notEqual(seedForDate('2026-09-18'), seedForDate('2026-09-19'));
});

test('assertMoodVector rejects what generators cannot use', () => {
  assert.throws(() => assertMoodVector(mood('2026-09-01', { valence: 4 })), /valence/);
  assert.throws(() => assertMoodVector(mood('2026-09-01', { title: 'one' })), /2-6 words/);
  assert.throws(
    () => assertMoodVector(mood('2026-09-01', { themes: ['a', '', 'c'] })),
    /three non-empty themes/,
  );
});

test('EP sequencing opens with the most extreme day and alternates', () => {
  const moods = [
    mood('2026-09-01', { valence: 0.05 }),
    mood('2026-09-02', { valence: 0.9, arousal: 0.9, volatility: 0.9, coherence: 0.9 }),
    mood('2026-09-03', { valence: -0.9, arousal: -0.9, volatility: -0.9, coherence: -0.9 }),
  ];
  const ordered = sequenceForContrast(moods);
  assert.equal(ordered.length, 3);
  assert.equal(ordered[0]!.date, '2026-09-02');
  assert.equal(ordered[1]!.date, '2026-09-03');
  // Every day appears exactly once.
  assert.equal(new Set(ordered.map((m) => m.date)).size, 3);
});

test('date helpers are UTC and inclusive', () => {
  assert.deepEqual(dateRange('2026-01-02', 3), ['2025-12-31', '2026-01-01', '2026-01-02']);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

/**
 * Slot selection for GDELT's 15-minute export files.
 *
 * The daily job runs at 23:30 for the day it is emitting, so most of the
 * interesting behaviour is about a day that is not over yet: asking for slots
 * the clock has not reached is just a handful of 404s, and a run delayed past
 * midnight must not silently read a day with two slots in it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.GDELT_SLOTS_PER_DAY = '24';
const { sampleSlots, slotsForDate } = await import('../agents/signals/gdelt.ts');

const DATE = '2026-09-18';

test('a day has 96 slots, on 15-minute boundaries', () => {
  const slots = slotsForDate(DATE);
  assert.equal(slots.length, 96);
  assert.equal(slots[0], '20260918000000');
  assert.equal(slots[1], '20260918001500');
  assert.equal(slots[4], '20260918010000');
  assert.equal(slots.at(-1), '20260918234500');
});

test('a finished day samples the requested number, spread across it', () => {
  const picked = sampleSlots(DATE, new Date('2026-09-19T12:00:00Z'));
  assert.equal(picked.length, 24);
  assert.equal(picked[0], '20260918000000');
  // Evenly spread means the last pick is late in the day, not clustered early.
  assert.ok(picked.at(-1)! > '20260918220000', `last pick was ${picked.at(-1)}`);
  assert.deepEqual([...picked].sort(), picked, 'slots come back in order');
});

test('never asks for slots the clock has not reached', () => {
  const midMorning = sampleSlots(DATE, new Date('2026-09-18T09:07:00Z'));
  assert.ok(midMorning.length > 0);
  for (const stamp of midMorning) {
    assert.ok(stamp <= '20260918090700', `${stamp} is in the future`);
  }
});

test('a day with fewer slots than asked for is not padded out with 404s', () => {
  // 02:00 has published 9 slots; asking for 24 must not invent the other 15.
  const early = sampleSlots(DATE, new Date('2026-09-18T02:00:00Z'));
  assert.equal(early.length, 9);
  assert.equal(early.at(-1), '20260918020000');
});

test('a day with nothing published yet returns nothing to fetch', () => {
  assert.deepEqual(sampleSlots(DATE, new Date('2026-09-17T23:00:00Z')), []);
});

test('samples are distinct', () => {
  const picked = sampleSlots(DATE, new Date('2026-09-18T02:00:00Z'));
  assert.equal(new Set(picked).size, picked.length);
});

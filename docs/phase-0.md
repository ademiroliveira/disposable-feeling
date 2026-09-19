# Phase 0 — the variance gate

**PASS.** Thirty backfilled days, 2026-08-20 to 2026-09-18, are distinguishable
from each other. Phase 1 is unblocked.

Run on 2026-09-19 against `edc82be`, offline synthesizer, full length renders.
Reproduce with:

```bash
npm run backfill -- --days 30 --end 2026-09-18
npm run variance                    # re-scores the same days without rendering
```

The raw report is written to `out/variance/2026-09-18-30d.json`, which is
git-ignored. This file is the record, and [phase-0-days.md](phase-0-days.md)
has all thirty days individually.

## Why this ran first

If thirty days all look and sound alike, the mood vector needs more dimensions
before anything else gets built. That is an afternoon's work to find out,
versus discovering it after the whole pipeline exists. The gate exits non-zero
on a fail, so it is a check rather than a thing you read and nod at.

## What was measured

Three things, all of which had to pass:

| Measure | Threshold | Result |
| --- | --- | --- |
| Mean mood distance between days | ≥ 0.25 | **0.579** |
| Share of day-pairs closer than 0.12 | ≤ 10% | **0%** |
| Standard deviation, each dimension | ≥ 0.08 | **0.278 – 0.400** |
| Distinct titles | — | 28 of 30 |

Closest pair of days: 2026-09-01 and 2026-09-02, at 0.166 — still above the
0.12 line at which two days count as the same day. Furthest: 1.065.

Per dimension, across the thirty days:

| Dimension | sd | range |
| --- | --- | --- |
| valence | 0.384 | −0.54 … +0.81 |
| arousal | 0.349 | −0.51 … +0.74 |
| volatility | 0.400 | −0.66 … +0.86 |
| coherence | 0.278 | −0.29 … +0.48 |

The third measure is the one that matters most and the easiest to skip. Two
different mood vectors that both land on "eight partials, aeolian, sixteen
columns" produce two outputs that are the same to a listener, so the gate also
checks what the generators actually chose, and what the audio actually
measured:

```
music.mode             5 of 5 modes used   aeolian 9, dorian 8, major 5, lydian 5, phrygian 3
music.partials         5 distinct
music.rootHz           9 distinct (1 Hz buckets)
music.eventsPerMinute  8 distinct
music.zcr              8 distinct   measured from the rendered audio
music.lowRatio         8 distinct   measured from the rendered audio
music.crest           14 distinct   measured from the rendered audio
poster.cols            7 distinct
poster.baseHue         8 distinct (15° buckets)
poster.inverted        2            one day of the thirty inverted to ink-on-dark
```

Track lengths ran 215 s to 308 s, which is arousal driving duration.

## The caveat, stated plainly

**GDELT did not report on any of the thirty days.** Its rate limit applies to
the egress IP rather than to the client, and the machine that ran this was
behind a shared one; it refuses with HTTP 200 and a plain-text notice however
politely requests are spaced. Weather was excluded by design — OpenWeatherMap's
history is a paid plan, and a faked past day would poison the baseline that
every live day is scored against.

So this gate passed on **markets and sky-and-ground alone**: CoinGecko hourly
returns and realized volatility, NOAA/GFZ planetary K, USGS earthquake energy,
and moon phase.

Two readings of that, both worth keeping:

- It is *evidence for* the decision to add sky and ground. Those signals were
  added because they are uncorrelated with the news, and they carried a
  thirty-day run on their own. News, markets and weather all move together on a
  big day; a geomagnetic storm does not care what the news thinks.
- It is *not* a test of the full signal set. Adding GDELT can only add
  variance, not remove it, so the pass should hold — but the run that proves
  it has not happened yet. **Re-run this gate from a host with its own egress
  IP before treating the news tone as verified.** That is the first CI run on
  GitHub Actions, where the runner has its own address.

## Known weaknesses this run exposed

- **Two titles repeated** ("an open kind of carnival", "tide and ledger").
  Both come from the offline synthesizer's seeded word bank, which is a fixed
  vocabulary — two days with the same quadrant and a similar seed draw can
  collide. With `ANTHROPIC_API_KEY` set, titles and themes come from Claude and
  the collision goes away. It is a limitation of the free path, not of the
  mood vector.
- **Coherence is the narrowest dimension** (sd 0.278, and it only reaches
  +0.48). It has the fewest inputs: asset agreement, GDELT tone spread — which
  was absent — and moon illumination. It passes, but it is the dimension to
  watch, and the one that would most benefit from the news tone returning.
- **Every day used the offline synthesizer.** The Claude path is implemented
  and bounded to ±0.35 per dimension, but it has not been exercised over a
  thirty-day run.

## What would invalidate this

Re-run the gate after any of: a change to the mood vector's dimensions, a
change to `reduceDimensions` or the baseline window, a new or removed signal
source, or a change to how music or poster parameters are derived. The
thresholds live in `pipeline/variance.ts` and are the arguable part — they were
chosen before this run, and they should not be loosened to make a later run
pass.

# Disposable Feeling

A daily generative art release built by a swarm of agents that read the mood of
the world and turn it into music, a poster, and an EP.

Signal agents scan external sources and reduce them to a single mood vector —
valence, arousal, volatility, coherence, three themes, a title, a seed. Every
generation agent works from that same vector and seed, so a day's track and a
day's poster stay coherent with each other. The output is disposable by design:
audio and poster are playable for seven days and then deleted, leaving a record
of a moment you either caught or did not.

```
Signal agents ──▶ Mood synthesis ──┬──▶ Music agent ──▶ EP assembly ──┐
                                   │                                  ├──▶ Archive
                                   └──▶ Poster agent ─────────────────┘
```

## Requirements

- **Node 22.18+**. TypeScript runs natively — there is no build step for the
  pipeline. `node pipeline/run-daily.ts` is the real command.
- **Chromium or Chrome.** Tone.js needs Web Audio and p5 needs a canvas, so
  both renderers run in one headless browser. `puppeteer-core` never downloads
  one: it finds Playwright's, then `PUPPETEER_EXECUTABLE_PATH`, then PATH.
- **ffmpeg**, for mastering and for the EP. Without it, tracks stay as WAV and
  the daily run still completes; the EP does not.

```bash
npm install
cp .env.example .env     # every value is optional — see below
npm test                 # unit tests, including RNG parity
npm run typecheck
```

`.env` is read by Node itself (`--env-file-if-exists`), so there is no dotenv
dependency and the scripts work unchanged in CI, where the values come from
repository secrets instead.

## Phase 0 first

Phase 0 is a gate, not a warm-up. If thirty backfilled days all look and sound
alike, the mood vector needs more dimensions before anything else gets built —
that is an afternoon's work to find out, versus discovering it after the whole
pipeline exists.

```bash
npm run backfill -- --days 30 --end 2026-09-18
```

That fetches thirty historical days, synthesizes each against a rolling
baseline of the others, renders all of them, and prints a verdict:

```
Phase 0 variance gate — 30 days

  mood distance   mean 0.412   min 0.104   max 0.883
  pairs under 0.12  1% (limit 10%)
  distinct titles 24 of 30

  dimension spread (sd across days)
    valence      0.381
    arousal      0.402
    ...
  PASS — the days are distinguishable. Phase 1 is unblocked.
```

It exits non-zero on a fail, so it works as a check rather than as a thing you
read and nod at. The run that unblocked Phase 1 is written up in
[docs/phase-0.md](docs/phase-0.md), including what it did *not* get to test;
`docs/index.html` is the same thirty days as a page you can look at and sort.
Point GitHub Pages at `docs/` to publish it — note that Pages only serves a
private repository on a paid plan. `npm run variance` re-runs the analysis over whatever is
already in the archive without rendering anything — useful after changing the
mood vector or the baseline window.

The gate measures three things, and all three have to pass: distance between
days in mood space, spread within each dimension, and spread of the parameters
the generators actually chose. The third one matters most. Two different mood
vectors that both land on "eight partials, aeolian, sixteen columns" produce
two outputs that are the same to a listener, and that is the failure the gate
exists to catch.

## Running a day

```bash
npm run daily                          # today
npm run daily -- --date 2026-09-18     # a specific day
npm run daily -- --offline             # skip the Claude call
npm run daily -- --dry-run             # render but do not archive
npm run signals -- --date 2026-09-18   # just look at the inputs
npm run ep                             # assemble the week
npm run expire                         # sweep anything past seven days
```

## The contract

`schema/mood-vector.ts` is the only thing every agent imports. If a generator
needs a new input, it goes there first.

The four numbers are **deviations from a rolling 30-day baseline**, not
absolute values. GDELT's tone is negative nearly every day, Kp sits at 2 most
of the time, and crypto is always "volatile"; scored against the last thirty
days, "mildly anxious" becomes the zero point and the differences that do exist
stop averaging out. A day with no history to compare against scores zero, which
is the honest answer rather than a guess.

Synthesis runs the arithmetic first and always. When `ANTHROPIC_API_KEY` is
set, Claude is then asked to adjust each dimension by at most ±0.35 and to
supply the three themes and the two-to-six word title — the things arithmetic
cannot do. Without a key, or if the call fails, the arithmetic stands on its
own and the titles come from a seeded word bank. Which path a day took is
recorded in `mood.provenance.synthesizer`, so the archive never has to guess.

## Signals

| Source | Key | History | Notes |
| --- | --- | --- | --- |
| GDELT | no | full | 15-minute export files, ~40–130 KB each; 24 sampled per day |
| CoinGecko | optional | 365 days | Crypto because it trades at weekends |
| OpenWeatherMap | yes | **paid** | Present day only; backfill goes without it |
| NOAA space weather | no | 7 days | GFZ Potsdam is the fallback for older days |
| USGS earthquakes | no | full | Energy summed as 10^(1.5M), not magnitudes |
| Moon phase | no | full | Computed; no network at all |

Sky and ground replaced Reddit and Google Trends (ToS and rate-limit risk).
They are free, carry no ToS risk, and — the point — they are uncorrelated with
the news, so they inject the variance the mood vector is short of. News,
markets and weather all move together on a big day; a geomagnetic storm does
not care what the news thinks.

Fetchers fail independently. A day with three of four sources is still a day,
and what is missing is recorded rather than defaulted to zero, because "no
weather" and "average weather" are different facts.

**GDELT gives you the feeling of the news, not of the world.** English-language
coverage, weighted by how much of it there is. This is stated on the site
rather than quietly assumed.

**GDELT is read from the raw export files, not the DOC 2.0 API**, and that is
worth explaining because the API is the obvious choice and it does not work
here. Measured, not assumed:

- **It refuses about nine requests in ten.** A 30-day warm-up from a GitHub
  runner with its own egress IP got 2 days out of 30, backing off up to 96
  seconds per attempt. The rate limit is not about your spacing.
- **It lags about a week.** Two ranged requests with different windows both
  stopped at the same date, seven days back. The API has no settled data for
  the day this pipeline is emitting, so no retry strategy could have helped.

The export files have neither problem: static objects on a CDN, published every
15 minutes, 40–130 KB each, history back to 2015. The fetcher samples 24 slots
across the day (`GDELT_SLOTS_PER_DAY`), which is a couple of megabytes and
gives a better `tone_spread` than the API did — dispersion measured across
individual events rather than across pre-averaged buckets. It is also what
GDELT's own rate-limit notice tells high-traffic users to do.

Two consequences. Tone is now per *event* rather than per article, so its
absolute level differs; that is invisible downstream, because every metric is
scored against its own rolling baseline, but a baseline built from API values
cannot be compared with these. And headlines are the one thing the export files
do not carry, so themes fall back to the seeded word bank until
`ANTHROPIC_API_KEY` is set — at which point Claude writes them from the signals
anyway.

**Until regions arrive in phase 4 there is one weather location**, set by
`DF_WEATHER_PLACE`. The default is Reykjavík: high-latitude, fast-moving
weather, so the signal actually moves day to day instead of reporting a
fortnight of the same cloudless afternoon. A city whose weather never changes
is a dimension that never changes.

## Storage and expiry

Without Supabase configured, everything lands in `./out` and the site reads it
from there — that is how Phase 0 runs. With it, the same emission is also
published to Postgres and three public buckets.

Each day's raw signals go to Postgres too, and that is not a nicety. The
baseline is read from `out/signals/`, which on CI is a GitHub Actions cache —
evicted after seven days unused. Losing it raises nothing: `score()` returns 0
without history, so the pipeline would publish a month of characterless days
and say so nowhere. The table is what makes the baseline durable; the cache
stays as the fast path.

Expiry is the load-bearing part. After seven days, audio and poster are
deleted; the date, the mood vector, the title, the render parameters and the
thumbnail survive. Storage stays flat forever, so the free tier holds
indefinitely, and the archive is a record of moments rather than a catalogue.

The constraint this creates: **EP assembly must run inside the seven-day
window.** Seven tracks, one per day, is the most the expiry allows. They are
sequenced for contrast rather than by date — playing a week in order means
playing seven days that mostly resemble each other in the order they resembled
each other.

## Deployment

- **GitHub Actions** runs the pipeline. Rendering audio, a poster and an EP
  takes minutes, well past Vercel's serverless function limits.
  - `daily.yml` at **23:30 UTC**, emitting for that same day. Late because an
    emission is dated for the day it reads: run it in the morning and every day
    is read from its first few hours, which is not what Phase 0 scored.
    Emitting for yesterday instead would fix that and break weather, whose
    history is a paid plan.
  - The date comes from the *slot*, not the clock. GitHub delays scheduled runs
    routinely — the first live run arrived two hours late, at 01:30 — and a run
    that slips past midnight would otherwise date itself for a day ninety
    minutes old. `emissionDate()` anchors it; drift costs weather and nothing
    else.
  - The **EP rides Sunday's run** rather than its own cron. Seven tracks over a
    seven-day expiry leaves no slack, so an independently scheduled Monday job
    would race the sweep by minutes. `weekly-ep.yml` is the manual re-run path.
  - `warm-baseline.yml` fills the rolling baseline before the first emission —
    run it once before turning the daily job on. Without it the first fortnight
    scores every dimension at zero and publishes flat days without complaining.
- **Supabase** holds the emissions and the media: `psql "$SUPABASE_DB_URL" -f
  supabase/schema.sql`.
- **Vercel** hosts `web/` and nothing else. Note that the Hobby plan is
  personal, non-commercial only — relevant if this becomes a public release
  rather than a personal experiment.

## Layout

```
schema/mood-vector.ts   THE contract — every agent imports this
agents/
  signals/              fetchers: news, markets, weather, sky + ground
  synthesis/            mood vector agent (Claude API call, with a fallback)
  music/                procedural composition, offline render
  poster/               Flow Grid-based visual generation
  ep-assembly/          ffmpeg sequencing and mastering
pipeline/
  run-daily.ts          orchestrates one full emission
  backfill.ts           re-runs historical days for variance testing
  emit.ts               the shared one-day path
  variance.ts           the Phase 0 gate, as arithmetic
lib/                    shared: seeded RNG, dates, HTTP, store, render host
web/                    Next.js archive site
supabase/schema.sql     emissions table, storage buckets
test/                   unit tests, including Node/browser RNG parity
```

Two notes on where this differs from the build plan. `lib/` is an addition: the
render host, the store and the seeded RNG are shared infrastructure rather than
agents, and burying them in one agent's folder would have meant the other agent
importing from it. And the poster is a fresh implementation of the Flow Grid
idea — a grid of cells each carrying a streamline through a shared field —
because the original sketch is not in this repo. If you have it, `agents/poster/
sketch.js` is the only file that needs to change; it receives the mood vector
and the seed and returns PNG bytes.

## The seed

`makeRng` exists twice: once in `lib/rng.ts` for Node, once in
`lib/render/runtime.js` for the page, which cannot import TypeScript. They are
the same generator written twice, and `test/rng-parity.test.ts` asserts that
they produce identical streams. If they ever drift, the music and the poster
stop sharing a day and nothing else in the repo would notice.

A day is reproducible, with one measured caveat. Re-rendering the same date
gives a byte-identical poster; the audio comes back with the same composition
and the same descriptors, but around 0.7% of samples differ by one LSB — about
−90 dBFS, which is floating-point rounding inside Chromium's audio graph
rather than a different piece of music. That is why the variance gate compares
descriptors and not file hashes.

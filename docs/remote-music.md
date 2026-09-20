# Remote music generation — Suno and the alternatives

**No, and specifically not via Suno.** There is no Suno API to integrate. If
remote generation happens later, it runs *beside* the procedural track as a
second artifact that is allowed to fail, never as a replacement for it.

Checked 2026-09-20. Prices and access terms move; the structural argument in
[the gate is the cost](#the-gate-is-the-cost) does not.

## There is no Suno API

As of mid-2026 Suno has no developer console, no self-serve key page, no public
SDK and no published endpoints. Suno's CPO said in July the company was
exploring a developer product starting with a curated group of partners —
an intake form, with no launch date and no pricing.

So "use the Suno API" today means a third-party reseller pooling Suno accounts
and driving the web app. Suno's [terms](https://suno.com/terms-of-service)
prohibit scraping, data mining and automated extraction, and reserve account
termination for it. That makes the pipeline's music depend on somebody else's
ToS violation, with no commercial-rights story for the output and no defence
against an upstream change removing the feature overnight.

This project already made that call once, at the signal layer: Reddit and
Google Trends were dropped for ToS and rate-limit risk, in favour of sources
that carry neither. A reseller is a larger version of the same problem, sitting
closer to the centre of the pipeline.

The only non-violating route to Suno specifically is the partner intake form.

## The gate is the cost

Money is not the deciding factor here — see [the prices](#the-prices), where
every option costs between fifty cents and twenty-one dollars a month. These
are the real costs.

**Four of the seven music keys in the variance gate stop existing.**
`pipeline/variance.ts` checks `music.mode`, `music.partials`, `music.rootHz`
and `music.eventsPerMinute`; a remote track has none of them. Only `music.zcr`,
`music.lowRatio` and `music.crest` survive, because those are measured from the
rendered audio rather than read off the parameters. [phase-0.md](phase-0.md)
is explicit that the parameter spread is the measure that matters most: two
mood vectors that both land on "eight partials, aeolian" produce two outputs
that are identical to a listener, and that is the failure the gate exists to
catch. Handing generation to a text prompt deletes the evidence.

**Determinism goes.** Everything hangs off `mood.seed` and `lib/rng.ts`, with a
Node/browser parity test to keep it honest. `npm run backfill -- --days 30`
currently reproduces thirty identical days for nothing. Against an API it is
thirty unreproducible days that cost money every time they are re-run, which
also ends `npm run variance` as a cheap re-scoring tool.

**Track and poster stop agreeing.** The premise is one vector and one seed
feeding every agent, so a day's music and poster are the same day. A text
prompt carries no seed. The poster would stay procedural and the track would
become a roll of the dice next to it.

**A network call enters the emission's critical path.** Today the only remote
call is synthesis, and it degrades to arithmetic when it fails. Generation is
local CPU. Remote generation adds job submission, polling and timeouts to a
GitHub Actions run that already takes minutes, in the one place where failure
means no emission at all.

**Length.** `trackSeconds` is `270 − arousal × 75`, so 3:15 to 4:52. Eleven
Music takes that range directly. Stable Audio caps around three minutes, so
the range would have to shrink to fit the generator — the tail wagging the
mood vector. Suno needs a second call to extend every track.

## The prices

One track a day, thirty a month.

| Route | Unit | Per month | Notes |
| --- | --- | ---: | --- |
| Suno, via reseller | $0.014–$0.111/song | $0.42–$3.33 | ToS violation; no commercial rights; needs an extend to reach 4:30 |
| Eleven Music | $0.15/min | ~$21 | Official API, commercial rights on paid plans, `music_length_ms` up to 10 min |
| Stable Audio 2.5 | $0.20/generation, flat | $6.00 | Official API, instrumental-native, sub-2s inference, ~3 min ceiling |

Legitimacy costs about twenty dollars a month at this volume. Whether Eleven
Music sells pure pay-as-you-go without a plan was not confirmed; if it is
plan-gated, the tier covering ~137 minutes a month is $99 rather than $21.

## The shape that keeps the gate

If this is built, build it as an addition:

- The procedural renderer stays canonical. It is deterministic, free, and the
  only one the gate can fully measure.
- The remote track is a second artifact — the day as a model hears it — and it
  fails independently, the way the signal fetchers already do. A day with no
  remote track is still a day.
- `music.*` keys in the gate keep coming from the procedural render, so Phase 0
  stays reproducible and re-scorable.

What it touches:

1. `schema/mood-vector.ts` gains `stylePrompt`. The contract goes first — that
   rule is older than this note. [suno-prompts.md](suno-prompts.md) is the
   hand-written prototype of that field, including which dimension should put
   which phrase in the string.
2. The synthesis agent already calls Claude with the vector and already writes
   the title and themes; the style prompt joins them, with the seeded word bank
   as the offline fallback.
3. A new `agents/music-remote/` returning the existing `MusicResult` shape with
   only the measured descriptors filled in.
4. Polling and backoff on `lib/http.ts` and `lib/throttle.ts`; the key as an
   Actions secret beside `ANTHROPIC_API_KEY`.
5. Nothing new for storage, mastering or expiry. `store.ts`, `masterToMp3` and
   the seven-day sweep do not care where an audio file came from.

## What would change this decision

- Suno opens self-serve access with published terms covering commercial use.
- The gate gets a replacement for the parameter-spread measure that works on
  audio alone — at which point remote generation stops costing the thing that
  Phase 0 was built to protect.
- The project stops caring about reproducing a past day, which is a bigger
  change to what this is than to how it is built.

## Sources

- [Is there an official Suno API yet?](https://gptproto.com/blog/suno-api)
- [Suno API pricing in 2026](https://sunor.cc/blog/suno-api-pricing-2026)
- [Suno terms of service](https://suno.com/terms-of-service)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) ·
  [Eleven Music API](https://elevenlabs.io/eleven-music-api)
- [Stable Audio on the Stability developer platform](https://github.com/api-evangelist/stability-audio)

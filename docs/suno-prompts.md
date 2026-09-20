# Suno prompts — the last three days

Hand-written style prompts for [Suno](https://suno.com), one per emission, for
the last three days of the Phase 0 backfill: 2026-09-16, 17 and 18.

Nothing in the pipeline reads this file and nothing writes it. The rendered
audio for these days is gone — disposable by design, and the machine that made
it is gone too — so this is a record of what a mood vector sounds like when a
different generator is holding the brush. It is also a crude check on the
variance gate: if three consecutive days can be told apart in a paragraph of
plain English, they were probably distinguishable as audio.

Whether any of this should be wired into the pipeline is a separate question,
answered in [remote-music.md](remote-music.md). The short version is no: there
is no Suno API to wire.

## What the renderer chose

From [phase-0-days.md](phase-0-days.md) and the parameter derivations in
`agents/music/sketch.js`. Cutoff, detune, width and figure length are not
published in the table, so they are recomputed here through `DF.fromMood`.

| date | mode | root | partials | cutoff | detune | width | phase | figure |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-09-16 | dorian | 46.2 Hz (F♯1) | 6 | 1560 Hz | 17.8 ¢ | 0.43 | 1.035 | 5 notes |
| 2026-09-17 | phrygian | 55.0 Hz (A1) | 5 | 900 Hz | 17.0 ¢ | 0.29 | 1.022 | 4 notes |
| 2026-09-18 | lydian | 51.9 Hz (G♯1) | 6 | 2310 Hz | 16.2 ¢ | 0.51 | 1.042 | 5 notes |

Valence sets the mode and the filter cutoff, which is why the prompts below
argue about brightness twice — once as a mode name and once as a production
word. Volatility sets both the stereo width and how far the two voices' step
lengths differ, so a volatile day is wide *and* drifting; the 17th is neither,
and reads as claustrophobic for that reason rather than because it is dark.

## The prompts

Turn the **Instrumental** toggle on for all three. Do not rely on the prompt
text to do it.

### field and morning — 2026-09-18

The bright one. Widest phase drift of the three, so the two voices pull apart
audibly over four minutes.

```
bright ambient drone, G# lydian, no percussion — airy sub-bass, six
shimmering detuned partials, a five-note figure slowly phasing apart,
open sunlit reverb, spacious and still, clean air
```

| phrase | why it is there |
| --- | --- |
| `bright`, `sunlit`, `airy` | valence +0.75 puts the cutoff at 2310 Hz, near the top of the 320–2600 range |
| `G# lydian` | valence above +0.45 selects lydian, the brightest mode in the set; the root is G♯1 because low arousal sits the drone low |
| `six shimmering detuned partials` | 6 partials, detuned 16.2 ¢ — coherence is only −0.05, so they shimmer rather than beat |
| `five-note figure slowly phasing apart` | figure length 5, phase ratio 1.042, the furthest from 1 of the three days |
| `spacious` | stereo width 0.51, mid-range |
| `clean air` | the day's own theme, kept verbatim |

### glass and meadow — 2026-09-16

The neutral one. A third of the steps are left empty, so the events are sparse
against a drone that never stops.

```
slow ambient drone, F# dorian, no percussion — warm sine sub-bass,
six partials beating against each other, sparse triangle bells drifting
out of phase, wide hall reverb, patient, still water
```

| phrase | why it is there |
| --- | --- |
| `slow`, `sparse` | 14.0 events per minute is one note every four seconds, and a third of those steps are dropped outright |
| `F# dorian` | valence +0.09 lands inside the −0.15…+0.15 band, which is dorian — the mode for a day on which nothing happened |
| `warm sine sub-bass` | the first two partials are always sine waves, over a 46.2 Hz root |
| `beating against each other` | 17.8 ¢ of detune, the most of the three days; audible as beating, not as shimmer |
| `triangle bells` | the first of the two phasing voices is a triangle oscillator |
| `wide hall reverb` | low arousal opens the room to 0.76 and the wet mix to 0.56 |
| `still water` | the day's own theme, kept verbatim |

### nothing but burnt fracture — 2026-09-17

The dark one. Lowest cutoff, narrowest image, and a phase ratio close enough
to 1 that the two voices nearly lock — a four-note motif repeating with the
interference barely moving.

```
dark ambient drone, A phrygian, no percussion — muffled low-passed
sub-bass, five beating partials, a four-note motif repeating almost in
lockstep, narrow stereo image, heavy damp reverb, tense and airless
```

| phrase | why it is there |
| --- | --- |
| `dark`, `muffled low-passed` | valence −0.49 drops the cutoff to 900 Hz, and clears the −0.45 line into phrygian by four hundredths |
| `A phrygian` | the ♭2 mode, and a 55.0 Hz root — the highest of the three, because this day has the highest arousal |
| `five beating partials` | the fewest of the three: partial count follows arousal and volatility, and volatility is −0.60 |
| `four-note motif` / `almost in lockstep` | figure length 4 and phase ratio 1.022, both from that same low volatility — the motif is short *and* it barely moves |
| `narrow stereo image` | width 0.29, volatility again |
| `tense and airless` | two different dimensions: the tension is the mode and the cutoff, the airlessness is the width |

It is also the loudest and most continuous of the three — rms 0.082, crest 7.2,
both measured from the rendered audio rather than from the parameters. That is
why it reads as pressure rather than as an empty room, and it is the one place
where the descriptors caught something the parameter list alone would have
missed.

## Two things that matter more than the wording

**Exclude styles: `drums, percussion, beat, vocals, arpeggio`.** Suno's
instinct on "ambient" is to slide a pulse underneath it. The 17th is where it
fights hardest, because dark and slow reads to the model as a build.

**Keep the spine identical.** All three open with `<brightness> ambient drone,
<key>, no percussion —` and the instrumentation words never change. Only the
mode, the brightness words and the density move. That is what makes them sound
like one EP rather than three unrelated generations, and it is the same trick
the pipeline pulls by handing one seed to every agent.

The source tracks run 4:27 to 4:40, so expect one extend to match length.
Track length is set by arousal alone — `270 − arousal × 75` seconds, calm
days long and agitated ones short — which is why the three barely differ.

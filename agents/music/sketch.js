/**
 * The music sketch. Runs inside the render host's page, where `Tone` and `DF`
 * are already loaded. Evaluated as a function expression — keep it one.
 *
 * The form: a tuned drone with a slow minimalist cycle over it. Two voices run
 * the same short figure at slightly different step lengths so they drift in
 * and out of phase over several minutes. Mood controls four things and nothing
 * else moves:
 *
 *   arousal    → event rate, and how many partials the drone carries
 *   coherence  → detuning between partials, i.e. how much the drone beats
 *   volatility → how far the two voices' step lengths differ, and stereo width
 *   valence    → mode, register, and filter brightness
 *
 * A flat day is a quiet, narrow, slow drone rather than silence — that is the
 * graceful degradation the build plan asked for.
 */
async (args) => {
  const { mood, durationSeconds, sampleRate } = args;
  const rng = DF.makeRng(mood.seed).fork('music');
  const { valence, arousal, volatility, coherence } = mood;

  /* ----------------------------- parameters ----------------------------- */

  // Brighter modes for a better-than-usual day, darker ones for worse.
  const MODES = {
    lydian: [0, 2, 4, 6, 7, 9, 11],
    major: [0, 2, 4, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
  };
  const modeName =
    valence > 0.45 ? 'lydian'
    : valence > 0.15 ? 'major'
    : valence > -0.15 ? 'dorian'
    : valence > -0.45 ? 'aeolian'
    : 'phrygian';
  const scale = MODES[modeName];

  // Low root: this is a drone, not a melody. Calmer days sit lower.
  const rootMidi = Math.round(DF.fromMood(arousal, 26, 38)) + rng.int(-1, 1);
  const rootHz = 440 * Math.pow(2, (rootMidi - 69) / 12);

  const partials = Math.round(DF.fromMood(arousal * 0.6 + volatility * 0.4, 3, 9));
  const detuneCents = DF.fromMood(-coherence, 3, 28);
  const eventsPerMinute = DF.fromMood(arousal, 5, 26);
  const stepSeconds = 60 / eventsPerMinute;
  // The phase offset. At zero the two voices lock; a volatile day pulls them
  // apart fast enough to hear the interference move.
  const phaseRatio = 1 + DF.fromMood(volatility, 0.008, 0.075);
  const cutoff = DF.fromMood(valence, 320, 2600);
  const width = DF.fromMood(volatility, 0.15, 0.85);
  const reverbRoom = DF.fromMood(-arousal, 0.55, 0.92);

  /* ------------------------------- render ------------------------------- */

  const buffer = await Tone.Offline(
    ({ transport }) => {
      const limiter = new Tone.Limiter(-1).toDestination();
      const master = new Tone.Gain(0).connect(limiter);
      const reverb = new Tone.Freeverb({
        roomSize: reverbRoom,
        dampening: DF.fromMood(-valence, 1200, 4200),
      }).connect(master);
      reverb.wet.value = DF.fromMood(-arousal, 0.35, 0.72);

      const filter = new Tone.Filter({
        type: 'lowpass',
        frequency: cutoff,
        Q: 0.8,
      }).connect(reverb);

      // A very slow sweep so a six-minute drone is not six minutes of the
      // same spectrum.
      const sweep = new Tone.LFO({
        frequency: 1 / Math.max(45, durationSeconds / 3),
        min: cutoff * 0.6,
        max: cutoff * 1.7,
      }).connect(filter.frequency);
      sweep.start(0);

      /* drone */
      const droneGain = new Tone.Gain(0.36 / Math.sqrt(partials)).connect(filter);
      const oscillators = [];
      for (let i = 0; i < partials; i++) {
        // Odd partials thin out first: it keeps the low end clean as density
        // rises instead of turning into mud.
        const ratio = i === 0 ? 1 : 1 + i * (i % 2 === 0 ? 1 : 0.5);
        const osc = new Tone.Oscillator({
          frequency: rootHz * ratio,
          type: i < 2 ? 'sine' : rng.chance(0.5) ? 'sine' : 'triangle',
          detune: rng.normal() * detuneCents,
          volume: -6 - i * 2.2,
        });
        const pan = new Tone.Panner(rng.range(-width, width)).connect(droneGain);
        osc.connect(pan);
        osc.start(rng.range(0, 1.5));
        oscillators.push(osc);
      }

      /* two phasing voices */
      const voices = [0, 1].map((index) => {
        const synth = new Tone.Synth({
          oscillator: { type: index === 0 ? 'triangle' : 'sine' },
          envelope: {
            attack: DF.fromMood(-arousal, 0.01, 0.9),
            decay: 0.4,
            sustain: 0.12,
            release: DF.fromMood(-arousal, 1.2, 6),
          },
          volume: -14,
        });
        const pan = new Tone.Panner(index === 0 ? -width * 0.7 : width * 0.7);
        synth.connect(pan);
        pan.connect(filter);
        return synth;
      });

      // The figure both voices play. Short, so the phasing is audible.
      const figureLength = 3 + Math.round(DF.fromMood(volatility, 0, 4));
      const figure = Array.from({ length: figureLength }, () => {
        const degree = rng.int(0, scale.length - 1);
        const octave = rng.chance(0.3) ? 24 : 12;
        return rootMidi + octave + scale[degree];
      });

      voices.forEach((synth, index) => {
        const step = index === 0 ? stepSeconds : stepSeconds * phaseRatio;
        let position = 0;
        transport.scheduleRepeat(
          (time) => {
            const note = figure[position % figure.length];
            position++;
            // Leave gaps on calm days rather than filling every step.
            if (rng.next() > DF.fromMood(arousal, 0.45, 0.95)) return;
            synth.triggerAttackRelease(
              440 * Math.pow(2, (note - 69) / 12),
              Math.min(step * 0.9, 2.5),
              time,
            );
          },
          step,
          index === 0 ? 0 : step * 0.5,
        );
      });

      /* one long breath in and out */
      const fade = Math.min(18, durationSeconds * 0.12);
      master.gain.setValueAtTime(0, 0);
      master.gain.linearRampToValueAtTime(0.85, fade);
      master.gain.setValueAtTime(0.85, durationSeconds - fade);
      master.gain.linearRampToValueAtTime(0, durationSeconds);

      transport.start(0);
    },
    durationSeconds,
    2,
    sampleRate,
  );

  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const left = channels[0];
  const right = channels[1];

  /*
   * Descriptors of what actually came out, not of what was asked for.
   *
   * The Phase 0 gate needs to know that two different mood vectors produced
   * two different-sounding tracks, and the surest way to be wrong about that
   * is to measure the parameters instead of the audio. These four are cheap
   * enough to compute here, while the buffer is still in memory:
   *
   *   rms       how loud it ended up
   *   crest     peak over rms — a drone and a sequence of events differ here
   *   zcr       zero crossings per second, a brightness proxy
   *   lowRatio  share of energy under ~150 Hz, via a one-pole lowpass
   */
  const onePole = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  let squared = 0;
  let peak = 0;
  let crossings = 0;
  let previous = 0;
  let lowSquared = 0;
  let lowpass = 0;

  for (let i = 0; i < left.length; i++) {
    // Peak is taken per channel, not from the mono sum: the drone is panned
    // wide, and a wide stereo image partly cancels when summed. Measuring the
    // sum would make a perfectly loud track look like near-silence to the
    // check below.
    const l = Math.abs(left[i]);
    const r = Math.abs(right[i]);
    if (l > peak) peak = l;
    if (r > peak) peak = r;

    const sample = (left[i] + right[i]) * 0.5;
    squared += sample * sample;
    if (i > 0 && sample >= 0 !== previous >= 0) crossings++;
    previous = sample;
    lowpass += onePole * (sample - lowpass);
    lowSquared += lowpass * lowpass;
  }

  const rms = Math.sqrt(squared / left.length);

  return {
    published: { track: DF.publish(DF.encodeWav(channels, sampleRate), 'track') },
    peak: peak,
    rms: rms,
    crest: rms > 0 ? peak / rms : 0,
    zcr: crossings / durationSeconds,
    lowRatio: squared > 0 ? lowSquared / squared : 0,
    mode: modeName,
    rootHz: rootHz,
    partials: partials,
    eventsPerMinute: eventsPerMinute,
    phaseRatio: phaseRatio,
  };
}

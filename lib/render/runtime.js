/**
 * Injected into every render page, before Tone.js or p5.
 *
 * Plain JavaScript on purpose: it is read off disk and handed to the browser
 * as-is, so it must not need a compile step. `makeRng` here is a verbatim copy
 * of the one in lib/rng.ts — the two are checked against each other in
 * test/rng-parity.test.ts, because a drift between them would silently stop
 * the music and the poster from sharing a day.
 */
globalThis.DF = (function () {
  function mixSeed(seed, label) {
    let h = seed >>> 0;
    for (let i = 0; i < label.length; i++) {
      h ^= label.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    let state = seed >>> 0;
    const next = function () {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rng = {
      next: next,
      range: function (min, max) {
        return min + next() * (max - min);
      },
      int: function (min, max) {
        return Math.floor(min + next() * (max - min + 1));
      },
      normal: function () {
        const u = Math.max(next(), Number.EPSILON);
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
      },
      pick: function (items) {
        return items[Math.floor(next() * items.length)];
      },
      chance: function (p) {
        return next() < p;
      },
      fork: function (label) {
        return makeRng(mixSeed(seed, label));
      },
    };
    return rng;
  }

  /** Linear interpolation, and the -1..1 → a..b remap every generator wants. */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function fromMood(value, min, max) {
    return lerp(min, max, (Math.max(-1, Math.min(1, value)) + 1) / 2);
  }

  /** Float32 channels → a 16-bit PCM WAV, as bytes. */
  function encodeWav(channels, sampleRate) {
    const channelCount = channels.length;
    const frames = channels[0].length;
    const bytes = new ArrayBuffer(44 + frames * channelCount * 2);
    const view = new DataView(bytes);

    const ascii = function (offset, text) {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };

    ascii(0, 'RIFF');
    view.setUint32(4, 36 + frames * channelCount * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * 2, true);
    view.setUint16(32, channelCount * 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, frames * channelCount * 2, true);

    let offset = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channelCount; c++) {
        const sample = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Uint8Array(bytes);
  }

  /**
   * Park bytes under a name where the Node side can pull them out in slices.
   * A three-minute stereo render is ~30 MB; base64-ing that through a single
   * evaluate() call is how you make Chromium fall over. A sketch may publish
   * several blobs — the poster publishes its full size and its thumbnail.
   */
  function publish(bytes, key) {
    if (!globalThis.__dfBytes) globalThis.__dfBytes = {};
    globalThis.__dfBytes[key || 'main'] = bytes;
    return bytes.length;
  }

  function slice(key, start, length) {
    const bytes = (globalThis.__dfBytes || {})[key];
    if (!bytes) throw new Error('nothing published under "' + key + '"');
    const end = Math.min(start + length, bytes.length);
    let binary = '';
    for (let i = start; i < end; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  /**
   * The first of `candidates` the browser actually has.
   *
   * p5's textFont() quotes whatever it is given as a single family name, so a
   * CSS font stack silently resolves to the default serif. Measuring against a
   * family that cannot exist is the only reliable way to tell a real hit from
   * a fallback, and which fonts are installed differs between a dev container
   * and a CI runner.
   */
  function pickFont(candidates, fallback) {
    const ctx = document.createElement('canvas').getContext('2d');
    const probe = 'mmmmmmmmmmlliWWW';
    const missing = '"df-definitely-not-a-font"';
    ctx.font = '72px ' + missing;
    const baseline = ctx.measureText(probe).width;
    for (let i = 0; i < candidates.length; i++) {
      ctx.font = '72px "' + candidates[i] + '", ' + missing;
      if (Math.abs(ctx.measureText(probe).width - baseline) > 0.5) return candidates[i];
    }
    return fallback || 'sans-serif';
  }

  /** A data: URL from a canvas, decoded to the bytes the host transfers. */
  function canvasBytes(canvas) {
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  return {
    makeRng: makeRng,
    mixSeed: mixSeed,
    lerp: lerp,
    fromMood: fromMood,
    encodeWav: encodeWav,
    pickFont: pickFont,
    canvasBytes: canvasBytes,
    publish: publish,
    slice: slice,
  };
})();

/**
 * The poster sketch — Flow Grid, extended.
 *
 * A grid of cells, each carrying a streamline through a shared flow field, and
 * the day's title set as typography under it. The grid is what keeps it
 * legible; the field is what makes two days look different.
 *
 * It reads the same mood vector and the same seed as the music, so a day that
 * beats and clashes in the drone also clashes here:
 *
 *   arousal    → grid density and stroke weight
 *   coherence  → how much every cell agrees with one global direction
 *   volatility → turbulence, and how far marks stray from their cell
 *   valence    → palette, and whether it is ink on paper or the reverse
 *
 * Runs inside the render host's page with `p5` and `DF` already loaded.
 */
async (args) => {
  const { mood, width, height, thumbnailWidth } = args;
  const { valence, arousal, volatility, coherence } = mood;
  const rng = DF.makeRng(mood.seed).fork('poster');

  /* ------------------------------ palette ------------------------------- */

  // Cool for a worse-than-usual day, warm for better. The jitter stops a run
  // of similar days from producing the same blue twice.
  const baseHue = (DF.fromMood(valence, 205, 45) + rng.range(-18, 18) + 360) % 360;
  const inverted = valence < -0.5;
  const paper = inverted
    ? { h: baseHue, s: DF.fromMood(arousal, 10, 30), b: DF.fromMood(volatility, 8, 17) }
    : { h: baseHue, s: DF.fromMood(arousal, 4, 16), b: DF.fromMood(-volatility, 97, 88) };

  // Low coherence pulls the accents apart on the wheel; a day that agrees with
  // itself gets an analogous palette, a fragmented one gets a clash.
  const spread = DF.fromMood(-coherence, 18, 155);
  const accentCount = 2 + Math.round(DF.fromMood(arousal, 0, 2));
  const accents = [];
  for (let i = 0; i < accentCount; i++) {
    accents.push({
      h: (baseHue + spread * (i - (accentCount - 1) / 2) + 360) % 360,
      s: DF.fromMood(arousal, 28, 82),
      b: inverted ? DF.fromMood(arousal, 70, 96) : DF.fromMood(-arousal, 42, 22),
    });
  }
  const ink = inverted
    ? { h: baseHue, s: 6, b: 94 }
    : { h: baseHue, s: 22, b: 14 };

  /* ------------------------------- layout ------------------------------- */

  const margin = Math.round(width * 0.085);
  const cols = Math.round(DF.fromMood(arousal, 6, 18));
  const cellW = (width - margin * 2) / cols;
  // Reserve the bottom third-ish for type; the grid fills whole cells above it.
  const fieldHeight = height - margin * 2 - height * 0.19;
  const rows = Math.max(3, Math.round(fieldHeight / cellW));
  const cellH = fieldHeight / rows;

  const noiseScale = DF.fromMood(volatility, 0.0016, 0.0085);
  const turbulence = DF.fromMood(volatility, 0.6, 2.6);
  const alignment = (DF.fromMood(coherence, 0, 1) + 1) / 2; // 0.5..1 of one direction
  const globalAngle = rng.range(0, Math.PI * 2);
  const steps = Math.round(DF.fromMood(arousal, 60, 22));
  const stepLength = cellW / DF.fromMood(-arousal, 6, 16);
  const strokeBase = cellW * DF.fromMood(arousal, 0.035, 0.11);
  const strayRadius = cellW * DF.fromMood(volatility, 0.08, 0.42);

  const sketch = (p) => {
    p.setup = () => {
      p.createCanvas(width, height);
      p.pixelDensity(1);
      p.noLoop();
      p.colorMode(p.HSB, 360, 100, 100, 1);
      p.noiseSeed(mood.seed);
      p.randomSeed(mood.seed);

      p.background(paper.h, paper.s, paper.b);

      /* the grid, barely there */
      p.stroke(ink.h, ink.s, ink.b, 0.12);
      p.strokeWeight(Math.max(1, width * 0.0006));
      for (let c = 0; c <= cols; c++) {
        const x = margin + c * cellW;
        p.line(x, margin, x, margin + rows * cellH);
      }
      for (let r = 0; r <= rows; r++) {
        const y = margin + r * cellH;
        p.line(margin, y, margin + cols * cellW, y);
      }

      /* one streamline per cell */
      p.noFill();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const accent = accents[rng.int(0, accents.length - 1)];
          // A few cells stay empty on calm days. Emptiness is a texture.
          if (rng.next() > DF.fromMood(arousal, 0.62, 0.99)) continue;

          let x = margin + (c + 0.5) * cellW + rng.range(-strayRadius, strayRadius);
          let y = margin + (r + 0.5) * cellH + rng.range(-strayRadius, strayRadius);
          const alpha = rng.range(0.35, 0.92);

          p.stroke(accent.h, accent.s, accent.b, alpha);
          p.beginShape();
          for (let s = 0; s < steps; s++) {
            p.strokeWeight(strokeBase * (1 - s / steps) + strokeBase * 0.25);
            p.vertex(x, y);
            const field = p.noise(x * noiseScale, y * noiseScale) * Math.PI * 2 * turbulence;
            const angle = globalAngle * alignment + field * (1 - alignment * 0.7);
            x += Math.cos(angle) * stepLength;
            y += Math.sin(angle) * stepLength;
            if (x < margin * 0.4 || x > width - margin * 0.4) break;
            if (y < margin * 0.4 || y > margin + rows * cellH + cellH * 0.5) break;
          }
          p.endShape();
        }
      }

      /* ---------------------------- typography --------------------------- */

      const baseline = margin + rows * cellH;
      const ctx = p.drawingContext;
      p.noStroke();

      // Title. Lowercase, letter-spaced, wrapped to at most two lines.
      const titleFont = DF.pickFont(
        ['Liberation Sans', 'DejaVu Sans', 'Helvetica Neue', 'Arial'],
        'sans-serif',
      );
      let titleSize = width * 0.082;
      p.textFont(titleFont);
      p.textAlign(p.LEFT, p.TOP);
      try {
        ctx.letterSpacing = `${Math.round(width * 0.002)}px`;
      } catch (err) {
        // Older Chromium: no canvas letter-spacing. The poster still sets.
      }

      const maxWidth = width - margin * 2;
      const words = String(mood.title).toLowerCase().split(/\s+/);
      let lines = [];
      const layout = () => {
        p.textSize(titleSize);
        lines = [];
        let line = '';
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (p.textWidth(candidate) > maxWidth && line) {
            lines.push(line);
            line = word;
          } else {
            line = candidate;
          }
        }
        if (line) lines.push(line);
      };
      layout();
      while (lines.length > 2 && titleSize > width * 0.03) {
        titleSize *= 0.9;
        layout();
      }

      p.fill(ink.h, ink.s, ink.b, 0.95);
      const titleTop = baseline + height * 0.035;
      lines.forEach((line, i) => {
        p.text(line, margin, titleTop + i * titleSize * 1.12);
      });

      // Metadata: the contract, printed. Small enough to ignore, present
      // enough that the archive is self-describing.
      try {
        ctx.letterSpacing = '0px';
      } catch (err) {
        /* ignore */
      }
      const monoFont = DF.pickFont(
        ['Liberation Mono', 'DejaVu Sans Mono', 'Courier New'],
        'monospace',
      );
      p.textFont(monoFont);
      p.textSize(width * 0.0135);
      p.fill(ink.h, ink.s, ink.b, 0.55);

      const metaTop = titleTop + lines.length * titleSize * 1.12 + height * 0.018;
      const num = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
      p.text(mood.date, margin, metaTop);
      p.text(mood.themes.join('  ·  '), margin, metaTop + width * 0.022);
      p.textAlign(p.RIGHT, p.TOP);
      p.text(
        `val ${num(valence)}   aro ${num(arousal)}   vol ${num(volatility)}   coh ${num(coherence)}`,
        width - margin,
        metaTop,
      );
      p.text(`seed ${mood.seed}`, width - margin, metaTop + width * 0.022);

      done(p);
    };
  };

  let done;
  const finished = new Promise((resolve) => {
    done = resolve;
  });
  new p5(sketch);
  const instance = await finished;

  const canvas = instance.canvas;
  const published = { poster: DF.publish(DF.canvasBytes(canvas), 'poster') };

  // The thumbnail is the residue: it outlives the poster by design, so it is
  // made here rather than by re-rendering something subtly different later.
  const thumbHeight = Math.round((thumbnailWidth / width) * height);
  const thumb = document.createElement('canvas');
  thumb.width = thumbnailWidth;
  thumb.height = thumbHeight;
  const thumbCtx = thumb.getContext('2d');
  thumbCtx.imageSmoothingEnabled = true;
  thumbCtx.imageSmoothingQuality = 'high';
  thumbCtx.drawImage(canvas, 0, 0, thumbnailWidth, thumbHeight);
  published.thumbnail = DF.publish(DF.canvasBytes(thumb), 'thumbnail');

  instance.remove();

  return {
    published: published,
    cols: cols,
    rows: rows,
    accents: accents.length,
    inverted: inverted,
    baseHue: Math.round(baseHue),
    alignment: alignment,
  };
}

/**
 * One headless Chromium session, shared by the music and poster agents.
 *
 * Tone.js needs Web Audio and p5 needs a canvas, and Node has neither. Rather
 * than run two different renderers, both agents hand a sketch to this host: it
 * launches Chromium once per emission, injects the shared RNG runtime, and
 * pulls bytes back out. Sharing the session is also what keeps them honest
 * about sharing a seed — they run in the same page context, from the same
 * mood vector, minutes apart.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';

import { ensureParent } from '../paths.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(HERE, 'runtime.js');
const TONE = resolve(HERE, '../../node_modules/tone/build/Tone.js');
const P5 = resolve(HERE, '../../node_modules/p5/lib/p5.min.js');

/** Transferred back from the page in 4 MB slices. */
const SLICE_BYTES = 4 * 1024 * 1024;

export type Library = 'tone' | 'p5';

export interface RenderHost {
  /** Run a sketch and write every blob it published to the matching path. */
  renderToFiles<T extends PublishResult>(
    options: SketchOptions & { outFiles: Record<string, string> },
  ): Promise<{ files: Record<string, string>; meta: T }>;
  /** Run a sketch that returns a plain value instead of bytes. */
  evaluate<T>(options: SketchOptions): Promise<T>;
  close(): Promise<void>;
}

/**
 * What a byte-publishing sketch returns: the length of each blob it published,
 * keyed by name, plus whatever it wants to report about how it got there.
 */
export interface PublishResult {
  published: Record<string, number>;
  [key: string]: unknown;
}

export interface SketchOptions {
  /** Shows up in log lines and in page errors. */
  label: string;
  libraries?: Library[];
  /**
   * Source of a function `(args) => ...`, evaluated in the page. It may use
   * `DF` (the shared runtime) and any library listed in `libraries`.
   * For `renderToFile` it must end by calling `DF.publish(bytes)`.
   */
  sketch: string;
  args: unknown;
  /** Sketches that render audio take minutes; the default is generous. */
  timeoutMs?: number;
}

/**
 * Chromium, in order of preference: an explicit path, Playwright's download
 * (which is what CI and this repo's dev containers already have), then
 * whatever is on PATH. Never downloads — `puppeteer-core` has no browser of
 * its own, which is the point.
 */
export function resolveChromium(): string {
  const explicit =
    process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_PATH ?? null;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`Chromium not found at ${explicit}`);
    }
    return explicit;
  }

  const pwRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (existsSync(pwRoot)) {
    const candidates = readdirSync(pwRoot)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse()
      .map((name) => join(pwRoot, name, 'chrome-linux', 'chrome'));
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }

  for (const candidate of [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ]) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    'no Chromium found — set PUPPETEER_EXECUTABLE_PATH, or install one (see README)',
  );
}

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}</style>
<script src="/runtime.js"></script>
</head><body></body></html>`;

/**
 * Chromium only gives AudioWorklet to a secure context, and Tone.js builds its
 * comb filters — everything Freeverb is made of — on worklets. A page loaded
 * with setContent() is not secure and the reverb quietly disappears, so the
 * page is served over loopback instead: 127.0.0.1 counts as trustworthy.
 */
function serveRenderAssets(): Promise<{ origin: string; server: Server }> {
  const files: Record<string, { path: string; type: string }> = {
    '/runtime.js': { path: RUNTIME, type: 'text/javascript' },
    '/tone.js': { path: TONE, type: 'text/javascript' },
    '/p5.js': { path: P5, type: 'text/javascript' },
  };

  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]!;
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE_HTML);
      return;
    }
    if (url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    const file = files[url];
    if (!file || !existsSync(file.path)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': file.type });
    res.end(readFileSync(file.path));
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({ origin: `http://127.0.0.1:${port}`, server });
    });
  });
}

export async function openRenderHost(): Promise<RenderHost> {
  const { origin, server } = await serveRenderAssets();

  const browser: Browser = await puppeteer.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: [
      // Containers and CI runners have no sandbox available and a 64 MB
      // /dev/shm, which a long offline audio render will happily exhaust.
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--force-device-scale-factor=1',
    ],
  });

  const page: Page = await browser.newPage();
  page.on('pageerror', (err: unknown) =>
    console.error(`  [page] ${err instanceof Error ? err.message : String(err)}`),
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warn') {
      console.error(`  [page:${msg.type()}] ${msg.text()}`);
    }
  });
  await page.goto(`${origin}/`, { waitUntil: 'load' });

  const loaded = new Set<Library>();
  async function ensureLibraries(libraries: Library[] = []): Promise<void> {
    for (const lib of libraries) {
      if (loaded.has(lib)) continue;
      const path = lib === 'tone' ? TONE : P5;
      if (!existsSync(path)) {
        throw new Error(`${lib} bundle missing at ${path} — run npm install`);
      }
      await page.addScriptTag({ url: `${origin}/${lib}.js` });
      loaded.add(lib);
    }
  }

  const secure = await page.evaluate(() => globalThis.isSecureContext === true);
  if (!secure) {
    throw new Error('render page is not a secure context — AudioWorklet unavailable');
  }

  async function run<T>(options: SketchOptions): Promise<T> {
    await ensureLibraries(options.libraries);
    const timeout = options.timeoutMs ?? 10 * 60_000;
    page.setDefaultTimeout(timeout);
    return (await page.evaluate(
      // eslint-disable-next-line no-new-func
      async (source: string, args: unknown) =>
        await (0, eval)(`(${source})`)(args),
      options.sketch,
      options.args,
    )) as T;
  }

  return {
    async evaluate<T>(options: SketchOptions): Promise<T> {
      return run<T>(options);
    },

    async renderToFiles<T extends PublishResult>(
      options: SketchOptions & { outFiles: Record<string, string> },
    ): Promise<{ files: Record<string, string>; meta: T }> {
      const meta = await run<T>(options);
      const published = meta?.published ?? {};
      const files: Record<string, string> = {};

      for (const [key, outFile] of Object.entries(options.outFiles)) {
        const length = published[key];
        if (!Number.isFinite(length) || (length ?? 0) <= 0) {
          throw new Error(`${options.label}: sketch published nothing for "${key}"`);
        }
        const parts: Buffer[] = [];
        for (let start = 0; start < length!; start += SLICE_BYTES) {
          const base64 = await page.evaluate(
            (name: string, from: number, size: number) =>
              (
                globalThis as unknown as {
                  DF: { slice(k: string, a: number, b: number): string };
                }
              ).DF.slice(name, from, size),
            key,
            start,
            SLICE_BYTES,
          );
          parts.push(Buffer.from(base64, 'base64'));
        }
        const bytes = Buffer.concat(parts);
        if (bytes.length !== length) {
          throw new Error(
            `${options.label}: transferred ${bytes.length} of ${length} bytes for "${key}"`,
          );
        }
        writeFileSync(ensureParent(outFile), bytes);
        files[key] = outFile;
      }

      // Drop the references so a long pipeline does not hold every render.
      await page.evaluate(() => {
        delete (globalThis as unknown as Record<string, unknown>).__dfBytes;
      });
      return { files, meta };
    },

    async close(): Promise<void> {
      await browser.close();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

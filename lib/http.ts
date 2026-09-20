/** Fetch with a timeout and a couple of polite retries. Every signal agent uses it. */

import { writeFileSync } from 'node:fs';

import { ensureParent } from './paths.ts';

export class FetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

export interface GetOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

const USER_AGENT =
  'disposable-feeling/0.1 (daily generative art; https://github.com/ademiroliveira/disposable-feeling)';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const { timeoutMs = 25_000, retries = 3, headers = {} } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, ...headers },
      });
      if (res.status === 429 || res.status >= 500) {
        // Rate limits and upstream hiccups are worth another attempt; GDELT
        // in particular answers 429 under load and then serves fine.
        throw new FetchError(`${res.status} from ${hostOf(url)}`, res.status);
      }
      if (!res.ok) throw new FetchError(`${res.status} from ${hostOf(url)}`, res.status);
      return await res.text();
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof FetchError
          ? err.status === 429 || (err.status ?? 0) >= 500
          : true;
      if (!retryable) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new FetchError(`failed to fetch ${hostOf(url)}`);
}

export async function getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
  const text = await getText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FetchError(`non-JSON response from ${hostOf(url)}`);
  }
}

/** Fetch bytes. Used for GDELT's zipped export files. */
export async function getBuffer(url: string, opts: GetOptions = {}): Promise<Buffer> {
  const { timeoutMs = 45_000, retries = 2, headers = {} } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, ...headers },
      });
      if (!res.ok) throw new FetchError(`${res.status} from ${hostOf(url)}`, res.status);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      // A missing slot is a permanent 404; only transient failures are worth another go.
      if (err instanceof FetchError && err.status === 404) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new FetchError(`failed to fetch ${hostOf(url)}`);
}

/** Fetch a URL straight to disk. Used to pull expiring audio back for the EP. */
export async function download(url: string, dest: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new FetchError(`${res.status} downloading ${hostOf(url)}`, res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(ensureParent(dest), bytes);
  return dest;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

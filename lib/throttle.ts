/**
 * A serialized minimum-interval gate.
 *
 * Both free APIs this project depends on rate-limit by IP and both punish a
 * burst harder than they punish patience: GDELT answers a plain-text refusal,
 * CoinGecko answers 429. A backfill is thirty days of the same two calls, so
 * the fix is to space them rather than to retry into the wall.
 */

export type Throttle = <T>(fn: () => Promise<T>) => Promise<T>;

export function makeThrottle(minIntervalMs: number): Throttle {
  let queue: Promise<unknown> = Promise.resolve();
  let lastStartedAt = 0;

  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = lastStartedAt + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastStartedAt = Date.now();
      return fn();
    });
    // Keep the chain alive even when one call rejects, or every later call
    // inherits the failure.
    queue = run.catch(() => undefined);
    return run;
  };
}

/** UTC date helpers. Everything in this repo is keyed on `YYYY-MM-DD` in UTC. */

export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`expected YYYY-MM-DD, got "${date}"`);
  }
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = parseIsoDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** The `count` days ending on `end`, oldest first. */
export function dateRange(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(end, i - count + 1));
}

/** Whole days between two dates, `b - a`. */
export function daysBetween(a: string, b: string): number {
  const ms = parseIsoDate(b).getTime() - parseIsoDate(a).getTime();
  return Math.round(ms / 86400000);
}

/**
 * The day an emission belongs to, which is not the same as the day it runs.
 *
 * The daily job is scheduled for 23:30 UTC so it reads a nearly complete day,
 * but GitHub queues scheduled workflows on a best-effort basis and delays of
 * an hour or more are routine. A run that slips past midnight would otherwise
 * be dated for the new day and read it from its first ninety minutes — exactly
 * the flaw the late slot exists to avoid, reintroduced silently.
 *
 * So the date comes from the slot rather than from the clock: late in the day
 * means today, any earlier means yesterday. That covers drift of up to six
 * hours, and past that "yesterday" is the right answer anyway, because a day
 * barely begun has nothing to read.
 *
 * The cost when it drifts is weather, whose history is a paid plan and so only
 * resolves for the current date. One source of four, recorded as missing
 * rather than guessed — a fair trade against dating a day by 1% of itself.
 */
export function emissionDate(now: Date = new Date()): string {
  return now.getUTCHours() >= 18 ? isoDate(now) : addDays(isoDate(now), -1);
}

/** `YYYYMMDDHHMMSS`, which is what GDELT wants. */
export function gdeltStamp(date: string, endOfDay = false): string {
  return date.replace(/-/g, '') + (endOfDay ? '235959' : '000000');
}

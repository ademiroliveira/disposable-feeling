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

/** `YYYYMMDDHHMMSS`, which is what GDELT wants. */
export function gdeltStamp(date: string, endOfDay = false): string {
  return date.replace(/-/g, '') + (endOfDay ? '235959' : '000000');
}

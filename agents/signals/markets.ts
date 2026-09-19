/**
 * CoinGecko — market volatility.
 *
 * Crypto rather than equities because it trades on weekends: a daily emission
 * cannot have two dead days a week. The free endpoint returns hourly prices
 * for any window inside the last year, which is exactly what backfill needs.
 */

import type { SignalReading } from '../../schema/mood-vector.ts';
import { parseIsoDate } from '../../lib/dates.ts';
import { getJson } from '../../lib/http.ts';

const BASE = 'https://api.coingecko.com/api/v3';

/** Two assets: one macro, one high-beta. Their disagreement is a signal too. */
const COINS = ['bitcoin', 'ethereum'] as const;

interface MarketChart {
  prices?: Array<[number, number]>;
}

function pctChange(prices: number[]): number {
  const first = prices.at(0);
  const last = prices.at(-1);
  if (first === undefined || last === undefined || first === 0) return 0;
  return ((last - first) / first) * 100;
}

/** Standard deviation of hour-over-hour returns, in percent. */
function realizedVolatility(prices: number[]): number {
  if (prices.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    if (prev === 0) continue;
    returns.push(((prices[i]! - prev) / prev) * 100);
  }
  if (returns.length < 2) return 0;
  const m = returns.reduce((a, b) => a + b, 0) / returns.length;
  return Math.sqrt(
    returns.reduce((a, b) => a + (b - m) ** 2, 0) / (returns.length - 1),
  );
}

async function fetchCoin(coin: string, date: string): Promise<number[]> {
  const start = parseIsoDate(date).getTime() / 1000;
  const end = start + 86_400;
  const key = process.env.COINGECKO_API_KEY;
  const params = new URLSearchParams({
    vs_currency: 'usd',
    from: String(start),
    to: String(end),
  });
  if (key) params.set('x_cg_demo_api_key', key);
  const res = await getJson<MarketChart>(
    `${BASE}/coins/${coin}/market_chart/range?${params.toString()}`,
    { retries: 3, timeoutMs: 30_000 },
  );
  return (res.prices ?? []).map(([, price]) => price).filter(Number.isFinite);
}

export async function fetchMarkets(date: string): Promise<SignalReading[]> {
  const readings: SignalReading[] = [];
  const changes: number[] = [];

  for (const coin of COINS) {
    const prices = await fetchCoin(coin, date);
    if (prices.length < 3) continue;
    const change = pctChange(prices);
    changes.push(change);
    readings.push({
      source: 'markets',
      metric: `${coin}_change_pct`,
      value: change,
      unit: '%',
      // Green day, marginally better mood. It is a weak claim, and the
      // baseline keeps it weak.
      affects: { valence: 0.5, arousal: 0.3 },
    });
    readings.push({
      source: 'markets',
      metric: `${coin}_volatility_pct`,
      value: realizedVolatility(prices),
      unit: '% hourly sd',
      affects: { volatility: 1, arousal: 0.5 },
    });
  }

  if (readings.length === 0) throw new Error('CoinGecko returned no usable prices');

  if (changes.length === 2) {
    // Both up or both down is consensus; a split is fragmentation.
    const agree = Math.sign(changes[0]!) === Math.sign(changes[1]!);
    readings.push({
      source: 'markets',
      metric: 'asset_agreement',
      value: agree ? 1 : -1,
      unit: 'sign',
      affects: { coherence: 1 },
    });
  }

  return readings;
}

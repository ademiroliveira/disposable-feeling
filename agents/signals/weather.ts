/**
 * OpenWeatherMap — regional weather.
 *
 * Present-day only. Historical weather is behind OWM's paid One Call plan,
 * which is why Phase 0's backfill runs without it (see the build plan) — the
 * collector records weather as `missing` for past dates rather than faking it.
 *
 * Until regions arrive in phase 4 there is one location, `DF_WEATHER_PLACE`.
 * The default is Reykjavík: high-latitude, fast-moving weather, so the signal
 * actually moves day to day instead of reporting a fortnight of the same
 * cloudless 24°C.
 */

import type { SignalReading } from '../../schema/mood-vector.ts';
import { isoDate } from '../../lib/dates.ts';
import { getJson } from '../../lib/http.ts';

const BASE = 'https://api.openweathermap.org/data/2.5/weather';

export interface WeatherPlace {
  name: string;
  lat: number;
  lon: number;
}

/** Named places, so `DF_WEATHER_PLACE=tokyo` works without coordinates. */
export const PLACES: Record<string, WeatherPlace> = {
  reykjavik: { name: 'Reykjavík', lat: 64.146, lon: -21.942 },
  london: { name: 'London', lat: 51.507, lon: -0.128 },
  'sao-paulo': { name: 'São Paulo', lat: -23.551, lon: -46.633 },
  'new-york': { name: 'New York', lat: 40.713, lon: -74.006 },
  tokyo: { name: 'Tokyo', lat: 35.676, lon: 139.65 },
  lagos: { name: 'Lagos', lat: 6.524, lon: 3.379 },
};

export function resolvePlace(): WeatherPlace {
  const key = (process.env.DF_WEATHER_PLACE ?? 'reykjavik').toLowerCase();
  const place = PLACES[key];
  if (!place) {
    throw new Error(
      `unknown DF_WEATHER_PLACE "${key}" (known: ${Object.keys(PLACES).join(', ')})`,
    );
  }
  return place;
}

interface OwmCurrent {
  weather?: Array<{ main?: string; description?: string }>;
  main?: { temp?: number; pressure?: number; humidity?: number };
  wind?: { speed?: number };
  clouds?: { all?: number };
}

export async function fetchWeather(date: string): Promise<SignalReading[]> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) throw new Error('OPENWEATHER_API_KEY is not set');
  if (date !== isoDate()) {
    throw new Error('OpenWeatherMap history is a paid plan; skipped for past dates');
  }

  const place = resolvePlace();
  const url = `${BASE}?lat=${place.lat}&lon=${place.lon}&units=metric&appid=${apiKey}`;
  const res = await getJson<OwmCurrent>(url, { retries: 2 });

  const temp = res.main?.temp;
  const pressure = res.main?.pressure;
  const wind = res.wind?.speed;
  const clouds = res.clouds?.all;
  const condition = res.weather?.[0]?.description ?? res.weather?.[0]?.main;

  const readings: SignalReading[] = [];
  if (Number.isFinite(temp)) {
    readings.push({
      source: 'weather',
      metric: 'temp_c',
      value: temp as number,
      unit: '°C',
      affects: { valence: 0.4 },
      note: `${place.name}${condition ? `, ${condition}` : ''}`,
    });
  }
  if (Number.isFinite(pressure)) {
    readings.push({
      source: 'weather',
      metric: 'pressure_hpa',
      value: pressure as number,
      unit: 'hPa',
      // Falling pressure is weather about to happen.
      affects: { arousal: -0.4, volatility: -0.3 },
    });
  }
  if (Number.isFinite(wind)) {
    readings.push({
      source: 'weather',
      metric: 'wind_ms',
      value: wind as number,
      unit: 'm/s',
      affects: { arousal: 0.6, volatility: 0.4 },
    });
  }
  if (Number.isFinite(clouds)) {
    readings.push({
      source: 'weather',
      metric: 'cloud_pct',
      value: clouds as number,
      unit: '%',
      affects: { valence: -0.4 },
    });
  }

  if (readings.length === 0) throw new Error('OpenWeatherMap returned nothing usable');
  return readings;
}

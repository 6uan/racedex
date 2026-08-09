// Weather normals (issue #5): what race morning has historically felt like
// at gun time. For every (grid cell, calendar day) a race starts in, pull
// that date across the last 10 years from Open-Meteo and store the median
// temp / dew point / humidity for each hour, plus a dew-point heat score.
//
// Work is keyed by cell-day, not by race: clustered races share fetches, and
// one day-fetch yields all 24 hours anyway, so all 24 are stored — a race
// changing its start time, or a new race landing in a known cell, needs no
// network at all. Cold run: ~161 cell-days × 10 years ≈ 1,610 calls, well
// under Open-Meteo's 10k/day.

import { db } from "../db/index";
import { CachedFetcher } from "../lib/fetch";
import { median } from "../lib/stats";
import { geoKey, heatScore, sampleDates } from "./normals";
import { archiveDayUrl, hourReadings } from "./openmeteo";
import type { ArchiveResponse } from "./openmeteo";

// Archive history is immutable, so cached responses stay valid for a year —
// same reasoning as zip centroids in lib/geocode.
const WEATHER_MAX_AGE_HOURS = 24 * 365;
const SAMPLE_YEARS = 10;

export type WeatherOptions = {
  limit?: number;
  recompute?: boolean;
};

export type WeatherSummary = {
  cellDays: number; // distinct (cell, calendar day) work items found
  skipped: number; // already present in weather_normals
  computed: number; // cell-days (re)computed this run
  rowsWritten: number;
  racesCovered: number;
  racesTotal: number;
  networkFetches: number;
  cacheHits: number;
  failedFetches: number;
};

// Every event that can be placed in space and time. '00:00' is RunSignup's
// "start time not set" placeholder, not a midnight race — those events get no
// normals rather than midnight weather (the schema's honest no-data state).
const startsStmt = db.prepare(`
  SELECT r.id AS race_id, r.lat, r.lon, r.timezone, e.date
  FROM events e
  JOIN races r ON r.id = e.race_id
  WHERE r.lat IS NOT NULL AND r.lon IS NOT NULL
    AND e.date IS NOT NULL AND e.start_time IS NOT NULL
    AND e.start_time != '00:00'
`);

const racesTotalStmt = db.prepare("SELECT COUNT(*) AS n FROM races");

// Skip-existing works at cell-day granularity: a day is always written as all
// 24 hour rows in one transaction, so its presence implies every hour is there.
const existingStmt = db.prepare(
  "SELECT DISTINCT geo_key, month_day FROM weather_normals",
);

const insertNormal = db.prepare(
  `INSERT OR REPLACE INTO weather_normals (
     geo_key, month_day, hour, temp_f, dew_point_f, humidity_pct,
     heat_score, years_sampled, computed_at
   ) VALUES (
     @geoKey, @monthDay, @hour, @tempF, @dewPointF, @humidityPct,
     @heatScore, @yearsSampled, @computedAt
   )`,
);

type NormalParams = {
  geoKey: string;
  monthDay: string;
  hour: number;
  tempF: number | null;
  dewPointF: number | null;
  humidityPct: number | null;
  heatScore: number | null;
  yearsSampled: number;
  computedAt: string;
};

const insertDayTx = db.transaction((rows: NormalParams[]): number => {
  for (const row of rows) insertNormal.run(row);
  return rows.length;
});

type StartRow = {
  race_id: string;
  lat: number;
  lon: number;
  timezone: string;
  date: string;
};

type CellDay = { cell: string; monthDay: string; timezone: string };

type HourSamples = {
  temps: number[];
  dews: number[];
  humidities: number[];
  years: number;
};

export async function runWeather(
  opts: WeatherOptions,
  log: (message: string) => void = console.log,
): Promise<WeatherSummary> {
  const fetcher = new CachedFetcher(WEATHER_MAX_AGE_HOURS);
  const currentYear = new Date().getFullYear();

  const starts = startsStmt.all() as StartRow[];
  const racesCovered = new Set<string>();
  const cellDays = new Map<string, CellDay>();
  for (const start of starts) {
    racesCovered.add(start.race_id);
    const cell = geoKey(start.lat, start.lon);
    const monthDay = start.date.slice(5); // '2026-10-17' → '10-17'
    cellDays.set(`${cell}|${monthDay}`, {
      cell,
      monthDay,
      timezone: start.timezone,
    });
  }

  const existing = new Set(
    (existingStmt.all() as { geo_key: string; month_day: string }[]).map(
      (row) => `${row.geo_key}|${row.month_day}`,
    ),
  );
  const missing = [...cellDays.entries()]
    .filter(([key]) => opts.recompute || !existing.has(key))
    .map(([, cellDay]) => cellDay);
  const pending = missing.slice(0, opts.limit);

  const summary: WeatherSummary = {
    cellDays: cellDays.size,
    skipped: cellDays.size - missing.length,
    computed: 0,
    rowsWritten: 0,
    racesCovered: racesCovered.size,
    racesTotal: (racesTotalStmt.get() as { n: number }).n,
    networkFetches: 0,
    cacheHits: 0,
    failedFetches: 0,
  };

  for (const [index, { cell, monthDay, timezone }] of pending.entries()) {
    const byHour = new Map<number, HourSamples>();
    for (const date of sampleDates(monthDay, currentYear, SAMPLE_YEARS)) {
      const data = await fetcher.getJson<ArchiveResponse>(
        archiveDayUrl(cell, date, timezone),
      );
      for (const reading of hourReadings(data)) {
        const samples = byHour.get(reading.hour) ?? {
          temps: [],
          dews: [],
          humidities: [],
          years: 0,
        };
        if (reading.temp !== null) samples.temps.push(reading.temp);
        if (reading.dew !== null) samples.dews.push(reading.dew);
        if (reading.humidity !== null)
          samples.humidities.push(reading.humidity);
        if (
          reading.temp !== null ||
          reading.dew !== null ||
          reading.humidity !== null
        ) {
          samples.years += 1;
        }
        byHour.set(reading.hour, samples);
      }
    }

    // A cell-day with zero usable samples (every fetch failed) writes nothing,
    // so the next run picks it up again — failed fetches aren't cached.
    const computedAt = new Date().toISOString();
    const rows = [...byHour.entries()]
      .filter(([, samples]) => samples.years > 0)
      .map(([hour, samples]): NormalParams => {
        const dewPointF = median(samples.dews);
        return {
          geoKey: cell,
          monthDay,
          hour,
          tempF: median(samples.temps),
          dewPointF,
          humidityPct: median(samples.humidities),
          heatScore: heatScore(dewPointF),
          yearsSampled: samples.years,
          computedAt,
        };
      });
    if (rows.length > 0) {
      summary.rowsWritten += insertDayTx(rows);
      summary.computed += 1;
    }

    if ((index + 1) % 10 === 0 || index === pending.length - 1) {
      log(`computed ${index + 1}/${pending.length} cell-days`);
    }
  }

  summary.networkFetches = fetcher.networkFetches;
  summary.cacheHits = fetcher.cacheHits;
  summary.failedFetches = fetcher.failedFetches;
  return summary;
}

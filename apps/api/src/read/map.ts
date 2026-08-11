// SQLite rows → the response types in @racedex/shared. Pure, and separate from
// races.ts, because this is where snake_case stops and the UI's contract
// begins — and because it's the half worth testing without a database.
//
// Everything the pipeline stores as JSON TEXT is parsed defensively: a single
// malformed row should degrade to an empty list, not 500 the whole endpoint.

import {
  distanceBucket,
  distanceLabel,
  raceUrl,
  TagSchema,
  type RaceCompetitivenessInputs,
  type RaceDetail,
  type RaceDistance,
  type RaceEvent,
  type RaceListItem,
  type RaceResult,
  type RaceWeather,
  type Tag,
} from "@racedex/shared";
import type { CompetitivenessInputs } from "../score/competitiveness";
import type {
  DetailRow,
  EventRow,
  ListRow,
  NormalRow,
  PriceRow,
  ResultRow,
} from "./rows";

function parseJson<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// The tag column is written by a Zod-validated pipeline, but it is still JSON
// TEXT in a public response — re-check it here so a hand-edited row can't put
// arbitrary strings on the UI's closed union.
function parseTags(text: string | null): Tag[] {
  const raw = parseJson<unknown[]>(text);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const parsed = TagSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * group_concat output → the printable distances a row matched on.
 *
 * Ascending because "5K · 10K · Half" is the order a runner reads, and
 * group_concat's is whatever the scan produced. Distinct is SQL's job; the
 * Set here is belt-and-braces for the empty string case.
 */
export function parseDistances(concatenated: string | null): RaceDistance[] {
  if (concatenated === null || concatenated === "") return [];
  const meters = [...new Set(concatenated.split(",").map(Number))]
    .filter((m) => Number.isFinite(m))
    .sort((a, b) => a - b);
  return meters.map((m) => ({
    meters: m,
    bucket: distanceBucket(m),
    label: distanceLabel(m),
  }));
}

export function toListItem(row: ListRow): RaceListItem {
  return {
    id: row.id,
    name: row.name,
    url: raceUrl(row),
    sourceUrl: row.url,
    city: row.city,
    state: row.state,
    lat: row.lat,
    lon: row.lon,
    nextDate: row.next_date,
    startTime: row.first_start === null ? null : row.first_start.slice(11, 16),
    distances: parseDistances(row.matched_distances),
    priceFromCents: row.price_from_cents,
    // A heat panel without a score is nothing to show, so the whole object is
    // null rather than an object of nulls — 8 races have no gun time to key on.
    heat:
      row.heat_score === null
        ? null
        : { score: row.heat_score, tempF: row.temp_f, dewPointF: row.dew_point_f },
    competitiveness: row.competitiveness,
    tags: parseTags(row.tags),
  };
}

/** Stored `competitiveness_inputs` (snake_case DB values) → the response. */
export function toCompetitivenessInputs(
  text: string | null,
): RaceCompetitivenessInputs | null {
  const stored = parseJson<CompetitivenessInputs>(text);
  if (stored === null) return null;
  return {
    version: stored.version,
    scoredAt: stored.scored_at,
    years: stored.years,
    eventName: stored.event_name,
    fieldSize: stored.field_size,
    distanceM: stored.distance_m,
    winnerSeconds: stored.winner_seconds,
    medianSeconds: stored.median_seconds,
    benchmarkSeconds: stored.benchmark_seconds,
    components: stored.components,
    weights: stored.weights,
  };
}

export function toEvents(events: EventRow[], prices: PriceRow[]): RaceEvent[] {
  const byEvent = new Map<string, PriceRow[]>();
  for (const price of prices) {
    byEvent.set(price.event_id, [...(byEvent.get(price.event_id) ?? []), price]);
  }
  return events.map((event) => ({
    id: event.id,
    name: event.name,
    distanceM: event.distance_m,
    bucket: distanceBucket(event.distance_m),
    label: event.distance_m === null ? null : distanceLabel(event.distance_m),
    date: event.date,
    startTime: event.start_time,
    prices: (byEvent.get(event.id) ?? []).map((price) => ({
      cents: price.price_cents,
      opensAt: price.opens_at,
      closesAt: price.closes_at,
    })),
  }));
}

export function toResults(rows: ResultRow[]): RaceResult[] {
  return rows.map((row) => ({
    year: row.year,
    eventName: row.event_name,
    distanceM: row.distance_m,
    finishers: row.finishers,
    winnerSeconds: row.winner_seconds,
    medianSeconds: row.median_seconds,
  }));
}

/**
 * The weather panel: the whole calendar day at the race's grid cell, with the
 * start hour marked. All 24 hours because the panel's job is to show that a
 * 07:00 gun time is the cool part of a hot day — one number can't say that.
 */
export function toWeather(
  firstStart: string | null,
  hours: NormalRow[],
): RaceWeather | null {
  const anchor = hours[0];
  if (firstStart === null || anchor === undefined) return null;
  return {
    geoKey: anchor.geo_key,
    monthDay: anchor.month_day,
    startHour: Number(firstStart.slice(11, 13)),
    yearsSampled: anchor.years_sampled,
    hours: hours.map((row) => ({
      hour: row.hour,
      tempF: row.temp_f,
      dewPointF: row.dew_point_f,
      humidityPct: row.humidity_pct,
      heatScore: row.heat_score,
    })),
  };
}

export function toDetail(
  row: DetailRow,
  parts: {
    events: EventRow[];
    prices: PriceRow[];
    results: ResultRow[];
    normals: NormalRow[];
  },
): RaceDetail {
  return {
    ...toListItem(row),
    description: row.description_text,
    address: row.address,
    zip: row.zip,
    timezone: row.timezone,
    events: toEvents(parts.events, parts.prices),
    weather: toWeather(row.first_start, parts.normals),
    results: toResults(parts.results),
    competitivenessInputs: toCompetitivenessInputs(row.competitiveness_inputs),
  };
}

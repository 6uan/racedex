// Shapes of what the read queries actually project — distinct from
// db/rows.ts, which types the tables themselves. These carry computed columns
// (first_start, the price and weather lookups) that exist in no table, so they
// can't be expressed as a Pick of RaceRow.

import type { RaceRow } from "../db/rows";

export type ListRow = Pick<
  RaceRow,
  | "id"
  | "name"
  | "url"
  | "city"
  | "state"
  | "lat"
  | "lon"
  | "next_date"
  | "tags"
  | "competitiveness"
> & {
  /** Earliest event with a real gun time, '2026-11-14T07:30'. */
  first_start: string | null;
  /** Comma-joined distinct distance_m over the matched events; NULLs dropped. */
  matched_distances: string | null;
  price_from_cents: number | null;
  heat_score: number | null;
  temp_f: number | null;
  dew_point_f: number | null;
};

export type DetailRow = ListRow &
  Pick<
    RaceRow,
    "description_text" | "address" | "zip" | "timezone" | "competitiveness_inputs"
  >;

export type EventRow = {
  id: string;
  name: string;
  distance_m: number | null;
  date: string | null;
  start_time: string | null;
};

export type PriceRow = {
  event_id: string;
  price_cents: number;
  opens_at: string | null;
  closes_at: string | null;
};

export type ResultRow = {
  year: number;
  event_name: string | null;
  distance_m: number | null;
  finishers: number | null;
  winner_seconds: number | null;
  median_seconds: number | null;
};

export type NormalRow = {
  geo_key: string;
  month_day: string;
  hour: number;
  temp_f: number | null;
  dew_point_f: number | null;
  humidity_pct: number | null;
  heat_score: number | null;
  years_sampled: number;
};

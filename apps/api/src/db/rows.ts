// Typed shapes of the tables in migrations/001_init.sql. These are DB-internal:
// the frontend only ever sees API response types (which live in @racedex/shared
// once the read API exists), so the schema can evolve without touching the UI.

export type RaceRow = {
  id: string;
  source: string;
  source_race_id: string;
  name: string;
  description_text: string | null;
  url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lon: number | null;
  next_date: string | null;
  timezone: string;
  tags: string | null;
  tag_meta: string | null;
  competitiveness: number | null;
  competitiveness_inputs: string | null;
  raw: string;
  first_seen_at: string;
  last_seen_at: string;
};

export type EventRow = {
  id: string;
  race_id: string;
  name: string;
  distance_m: number | null;
  date: string | null;
  start_time: string | null;
  raw: string;
};

export type PricePeriodRow = {
  event_id: string;
  price_cents: number;
  opens_at: string | null;
  closes_at: string | null;
};

export type RaceResultRow = {
  race_id: string;
  source_event_id: string;
  year: number;
  event_name: string | null;
  distance_m: number | null;
  finishers: number | null;
  winner_seconds: number | null;
  median_seconds: number | null;
  raw: string;
};

export type WeatherNormalRow = {
  geo_key: string;
  month_day: string;
  hour: number;
  temp_f: number | null;
  dew_point_f: number | null;
  humidity_pct: number | null;
  heat_score: number | null;
  years_sampled: number;
  computed_at: string;
};

export type FetchCacheRow = {
  url: string;
  fetched_at: string;
  status: number;
  body: string;
};

-- 001_init.sql — the pipeline schema.
--
-- Conventions (see PLAN.md for rationale):
--   STRICT tables         SQLite enforces column types instead of coercing.
--   Dates/times           ISO-8601 TEXT ('2026-02-08', '07:00') — sorts correctly.
--   Money                 INTEGER cents.
--   Booleans              INTEGER 0/1.
--   JSON                  TEXT, queried with SQLite's json_* functions.
--   IDs                   natural keys ('runsignup:12345') — stable across full
--                         DB rebuilds, safe to reference from PocketBase or URLs.
--
-- Everything except fetch_cache is rebuildable from fetch_cache + external
-- APIs. fetch_cache is the historical record: append-only, never dropped.

CREATE TABLE races (
  id TEXT PRIMARY KEY,                -- '<source>:<source_race_id>'
  source TEXT NOT NULL,               -- 'runsignup' (future: 'active', ...)
  source_race_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description_text TEXT,              -- HTML stripped; tagger input + display
  url TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  lat REAL,
  lon REAL,
  next_date TEXT,                     -- ISO date of next occurrence
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  tags TEXT,                          -- JSON array, written by the tagger
  tag_meta TEXT,                      -- JSON {provider, model, prompt_version, tagged_at}
  competitiveness INTEGER,            -- 0-100; NULL = honest no-data state
  competitiveness_inputs TEXT,        -- JSON: the raw numbers behind the score
  raw TEXT NOT NULL,                  -- source JSON this row was parsed from
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (source, source_race_id)
) STRICT;

CREATE INDEX idx_races_next_date ON races (next_date);
CREATE INDEX idx_races_competitiveness ON races (competitiveness);

CREATE TABLE events (
  id TEXT PRIMARY KEY,                -- '<source>:<source_event_id>'
  race_id TEXT NOT NULL REFERENCES races (id) ON DELETE CASCADE,
  name TEXT NOT NULL,                 -- free text from source ('5K Run/Walk')
  distance_m INTEGER,                 -- parsed; NULL = unparseable, never guessed
  date TEXT,                          -- ISO date
  start_time TEXT,                    -- local 'HH:MM' in the race's timezone
  raw TEXT NOT NULL
) STRICT;

CREATE INDEX idx_events_race ON events (race_id);
CREATE INDEX idx_events_date ON events (date);
CREATE INDEX idx_events_distance ON events (distance_m);

CREATE TABLE price_periods (
  event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL,
  opens_at TEXT,                      -- ISO datetime; NULL = since registration opened
  closes_at TEXT                      -- ISO datetime; NULL = until event
) STRICT;

CREATE INDEX idx_price_periods_event ON price_periods (event_id);

-- Prior-year results. Attached to the race (not the current event) because each
-- past year is a different source event; source_event_id records which one.
CREATE TABLE race_results (
  race_id TEXT NOT NULL REFERENCES races (id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  event_name TEXT,
  distance_m INTEGER,
  finishers INTEGER,
  winner_seconds INTEGER,
  median_seconds INTEGER,
  raw TEXT NOT NULL,
  PRIMARY KEY (race_id, source_event_id)
) STRICT;

CREATE INDEX idx_race_results_year ON race_results (year);

-- Weather normals keyed by grid cell, not race: races cluster, so rounding
-- coordinates to ~2dp (~1km) dedupes Open-Meteo calls across nearby races.
CREATE TABLE weather_normals (
  geo_key TEXT NOT NULL,              -- 'lat,lon' rounded to 2dp: '25.73,-80.24'
  month_day TEXT NOT NULL,            -- 'MM-DD'
  hour INTEGER NOT NULL,              -- local hour 0-23
  temp_f REAL,
  dew_point_f REAL,
  humidity_pct REAL,
  heat_score INTEGER,                 -- 1-5, dew-point driven
  years_sampled INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (geo_key, month_day, hour)
) STRICT;

-- Raw upstream responses, append-only. Keyed by (url, fetched_at) so refetches
-- accumulate history instead of overwriting it — prices change, races get
-- delisted; these snapshots are the only irreplaceable data in this file.
CREATE TABLE fetch_cache (
  url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (url, fetched_at)
) STRICT;

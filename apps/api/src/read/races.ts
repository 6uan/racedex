// The public read API (issue #9): GET /api/races and GET /api/races/:segment.
// Read-only and unauthenticated by design — auth lives entirely in PocketBase
// and Express never sees a token (PLAN.md). Nothing here writes.

import type { Request, Response } from "express";
import type { Statement } from "better-sqlite3";
import { ZodError } from "zod";
import {
  parseRaceUrl,
  raceSegment,
  RaceListQuerySchema,
  type ApiError,
  type RaceListResponse,
} from "@racedex/shared";
import { db } from "../db/index";
import { geoKey } from "../weather/normals";
import { buildListSql, metroNow } from "./query";
import { toDetail, toListItem } from "./map";
import type {
  DetailRow,
  EventRow,
  ListRow,
  NormalRow,
  PriceRow,
  ResultRow,
} from "./rows";

// The pipeline's own geoKey(), reachable from SQL. normals.ts is explicit that
// this function is the only place the grid key is derived and that readers
// must call it rather than re-round in SQL — a custom function is how a JOIN
// obeys that. Deterministic so SQLite may cache and reorder it freely.
db.function("geo_key", { deterministic: true }, (lat: unknown, lon: unknown) =>
  typeof lat === "number" && typeof lon === "number" ? geoKey(lat, lon) : null,
);

// List SQL varies with the filters, so it can't be a module-level constant.
// The distinct shapes are few and long-lived; cache by text rather than
// re-preparing per request.
const statementCache = new Map<string, Statement>();

function prepared(sql: string): Statement {
  const cached = statementCache.get(sql);
  if (cached !== undefined) return cached;
  const stmt = db.prepare(sql);
  statementCache.set(sql, stmt);
  return stmt;
}

function invalidQuery(error: ZodError): ApiError {
  return {
    error: "invalid_query",
    message: "one or more query parameters are invalid",
    issues: error.issues.map((issue) => ({
      // A strict-object rejection has an empty path — it's about the query as
      // a whole, and "" would render as nothing.
      path: issue.path.length > 0 ? issue.path.join(".") : "(query)",
      message: issue.message,
    })),
  };
}

function notFound(message: string): ApiError {
  return { error: "not_found", message };
}

export function raceList(req: Request, res: Response): void {
  const parsed = RaceListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(invalidQuery(parsed.error));
    return;
  }

  const query = parsed.data;
  const { sql, params, countSql, countParams } = buildListSql(query, new Date());
  const rows = prepared(sql).all(params) as ListRow[];
  const { total } = prepared(countSql).get(countParams) as { total: number };

  const body: RaceListResponse = {
    races: rows.map(toListItem),
    total,
    // Echoed so a default is never invisible: the UI can say "upcoming races,
    // excluding non-runs" instead of silently hiding 23 of them.
    applied: query,
  };
  res.json(body);
}

// Same projection as the list, with no filter to match against: every event
// counts, so the distances and the price cover the whole race.
const DETAIL_SQL = `
  WITH r AS (
    SELECT
      races.id, races.name, races.url, races.city, races.state,
      races.lat, races.lon, races.next_date, races.tags, races.competitiveness,
      races.description_text, races.address, races.zip, races.timezone,
      races.competitiveness_inputs,
      (SELECT e.date || 'T' || e.start_time FROM events e
        WHERE e.race_id = races.id AND e.date IS NOT NULL
          AND e.start_time IS NOT NULL AND e.start_time != '00:00'
        ORDER BY e.date, e.start_time LIMIT 1) AS first_start
    FROM races WHERE races.id = :id
  )
  SELECT
    r.*,
    (SELECT group_concat(DISTINCT e.distance_m) FROM events e
      WHERE e.race_id = r.id) AS matched_distances,
    (SELECT min(p.price_cents) FROM price_periods p
       JOIN events e ON e.id = p.event_id
      WHERE e.race_id = r.id AND p.closes_at >= :now) AS price_from_cents,
    wn.heat_score, wn.temp_f, wn.dew_point_f
  FROM r
  LEFT JOIN weather_normals wn
    ON wn.geo_key = geo_key(r.lat, r.lon)
   AND wn.month_day = substr(r.first_start, 6, 5)
   AND wn.hour = CAST(substr(r.first_start, 12, 2) AS INTEGER)`;

// Shortest distance first, then by name: a race's own list reads 1 Mile → 5K →
// 10K → Half, and unparsed events (a "Kids Dash", a volunteer slot) sit last
// rather than leading the card.
const DETAIL_EVENTS_SQL = `
  SELECT id, name, distance_m, date, start_time FROM events
  WHERE race_id = :id
  ORDER BY distance_m IS NULL, distance_m, name`;

const DETAIL_PRICES_SQL = `
  SELECT p.event_id, p.price_cents, p.opens_at, p.closes_at
  FROM price_periods p JOIN events e ON e.id = p.event_id
  WHERE e.race_id = :id
  ORDER BY p.opens_at`;

const DETAIL_RESULTS_SQL = `
  SELECT year, event_name, distance_m, finishers, winner_seconds, median_seconds
  FROM race_results WHERE race_id = :id
  ORDER BY year DESC, finishers DESC`;

// The whole calendar day at the race's cell — 24 rows. The panel's point is
// that a 07:00 start is the cool part of a hot day, which one hour can't show.
const DETAIL_NORMALS_SQL = `
  SELECT wn.geo_key, wn.month_day, wn.hour, wn.temp_f, wn.dew_point_f,
         wn.humidity_pct, wn.heat_score, wn.years_sampled
  FROM weather_normals wn
  WHERE wn.geo_key = :geoKey AND wn.month_day = :monthDay
  ORDER BY wn.hour`;

export function raceDetail(req: Request, res: Response): void {
  // Express types a route param as possibly repeated; a single `:segment`
  // never is, but narrow rather than assert.
  const raw = req.params.segment;
  const segment = typeof raw === "string" ? raw : "";

  // Resolve on the trailing ID, canonicalize on the name (PLAN.md). A segment
  // that can't name a race is a missing resource, not a bad parameter — a
  // crawler hitting a stray path should get 404, not 400.
  const id = parseRaceUrl(segment);
  if (id === null) {
    res.status(404).json(notFound(`'${segment}' is not a race URL`));
    return;
  }

  const { now } = metroNow(new Date());
  const row = prepared(DETAIL_SQL).get({ id, now }) as DetailRow | undefined;
  if (row === undefined) {
    res.status(404).json(notFound(`no race with id '${id}'`));
    return;
  }

  // The common case this serves is not a duplicate name — it's RunSignup
  // renaming a race between ingests, so the old link redirects instead of 404ing.
  const canonical = raceSegment(row);
  if (canonical !== segment) {
    res.redirect(301, `/api/races/${canonical}`);
    return;
  }

  const events = prepared(DETAIL_EVENTS_SQL).all({ id }) as EventRow[];
  const prices = prepared(DETAIL_PRICES_SQL).all({ id }) as PriceRow[];
  const results = prepared(DETAIL_RESULTS_SQL).all({ id }) as ResultRow[];
  const normals =
    row.lat === null || row.lon === null || row.first_start === null
      ? []
      : (prepared(DETAIL_NORMALS_SQL).all({
          geoKey: geoKey(row.lat, row.lon),
          monthDay: row.first_start.slice(5, 10),
        }) as NormalRow[]);

  res.json(toDetail(row, { events, prices, results, normals }));
}

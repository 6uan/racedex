// /debug — the interim window into the pipeline DB (issue #4). Plain HTML
// from template literals, zero framework: the data hasn't earned React yet.
// Each later pipeline step (weather, tags, score) grows a column here; the
// whole page is deleted in the final polish issue (#13).

import type { Request, Response } from "express";
import { db } from "./db/index";
import type { RaceRow, WeatherNormalRow } from "./db/rows";
import { geoKey } from "./weather/normals";

// Per-table row counts + freshness for the summary block. Freshness comes
// from whichever timestamp column the table has; tables without one just
// count. Names are our own constants, not user input, so interpolating them
// into SQL is safe (identifiers can't be bound as parameters anyway).
const TABLES: { name: string; freshnessCol?: string }[] = [
  { name: "races", freshnessCol: "last_seen_at" },
  { name: "events" },
  { name: "price_periods" },
  { name: "race_results" },
  { name: "weather_normals", freshnessCol: "computed_at" },
  { name: "fetch_cache", freshnessCol: "fetched_at" },
];

type TableStat = { name: string; rows: number; latest: string | null };

const statStmts = TABLES.map(({ name, freshnessCol }) => ({
  name,
  stmt: db.prepare(
    `SELECT COUNT(*) AS rows${
      freshnessCol ? `, MAX(${freshnessCol}) AS latest` : ", NULL AS latest"
    } FROM ${name}`,
  ),
}));

// One row per race with its child aggregates. Correlated subqueries instead
// of JOIN+GROUP BY so adding an aggregate never risks fanning out the row
// count; at 182 races SQLite runs these instantly.
const racesStmt = db.prepare(`
  SELECT
    r.id, r.name, r.url, r.city, r.state, r.next_date, r.lat, r.lon,
    (SELECT e.date || 'T' || e.start_time FROM events e
      WHERE e.race_id = r.id AND e.date IS NOT NULL
        AND e.start_time IS NOT NULL AND e.start_time != '00:00'
      ORDER BY e.date, e.start_time LIMIT 1) AS first_start,
    (SELECT COUNT(*) FROM events e WHERE e.race_id = r.id) AS events_n,
    (SELECT GROUP_CONCAT(DISTINCT e.distance_m) FROM events e
      WHERE e.race_id = r.id AND e.distance_m IS NOT NULL) AS distances,
    (SELECT MIN(p.price_cents) FROM price_periods p
      JOIN events e ON e.id = p.event_id WHERE e.race_id = r.id) AS price_min,
    (SELECT MAX(p.price_cents) FROM price_periods p
      JOIN events e ON e.id = p.event_id WHERE e.race_id = r.id) AS price_max,
    (SELECT COUNT(*) FROM race_results rr WHERE rr.race_id = r.id) AS results_n
  FROM races r
  ORDER BY r.next_date IS NULL, r.next_date, r.name
`);

type DebugRaceRow = Pick<
  RaceRow,
  "id" | "name" | "url" | "city" | "state" | "next_date" | "lat" | "lon"
> & {
  first_start: string | null; // earliest real gun time, '2026-10-17T07:30'
  events_n: number;
  distances: string | null; // comma-joined distance_m values
  price_min: number | null;
  price_max: number | null;
  results_n: number;
};

// All normals load into one Map per render (a few thousand small rows) and
// races look up their cell in JS — the grid key must come from the same
// geoKey() the pipeline writes with, and re-rounding floats in SQL could
// disagree with toFixed on edge cases.
const normalsStmt = db.prepare(
  "SELECT geo_key, month_day, hour, temp_f, dew_point_f, heat_score FROM weather_normals",
);

type DebugNormal = Pick<
  WeatherNormalRow,
  "geo_key" | "month_day" | "hour" | "temp_f" | "dew_point_f" | "heat_score"
>;

// The normal shown for a race is its first gun time's cell/day/hour; minutes
// truncate to the top of the hour ('07:30' → hour 7), matching the pipeline.
function raceNormal(
  r: DebugRaceRow,
  normals: Map<string, DebugNormal>,
): DebugNormal | undefined {
  if (r.lat === null || r.lon === null || r.first_start === null)
    return undefined;
  const monthDay = r.first_start.slice(5, 10);
  const hour = Number(r.first_start.slice(11, 13));
  return normals.get(`${geoKey(r.lat, r.lon)}|${monthDay}|${hour}`);
}

// Race names and URLs are upstream text — escape everything interpolated
// into the page, even on an internal debug view.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const NULL_CELL = `<span class="null">—</span>`;

function age(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (24 * 60))}d ago`;
}

// Display inverse of ingest's parseDistanceMeters: canonical race distances
// get their household names, everything else shows in the unit it divides
// evenly into.
function distanceLabel(m: number): string {
  if (m === 21097) return "Half";
  if (m === 42195) return "Marathon";
  if (m % 1000 === 0) return `${m / 1000}K`;
  const miles = m / 1609.344;
  if (Math.abs(miles - Math.round(miles)) < 0.01) return `${Math.round(miles)}mi`;
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}K`;
}

function money(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function degrees(f: number | null): string {
  return f === null ? NULL_CELL : `${Math.round(f)}°`;
}

function raceTr(r: DebugRaceRow, normals: Map<string, DebugNormal>): string {
  const name = r.url
    ? `<a href="${esc(r.url)}">${esc(r.name)}</a>`
    : esc(r.name);
  const place = [r.city, r.state].filter(Boolean).join(", ");
  const distances = r.distances
    ? r.distances
        .split(",")
        .map(Number)
        .sort((a, b) => a - b)
        .map(distanceLabel)
        .join(", ")
    : NULL_CELL;
  const price =
    r.price_min === null || r.price_max === null
      ? NULL_CELL
      : r.price_min === r.price_max
        ? money(r.price_min)
        : `${money(r.price_min)}–${money(r.price_max)}`;
  const normal = raceNormal(r, normals);
  return `<tr>
    <td><code>${esc(r.id)}</code></td>
    <td>${name}</td>
    <td>${place ? esc(place) : NULL_CELL}</td>
    <td>${r.next_date ?? NULL_CELL}</td>
    <td class="num">${r.events_n}</td>
    <td>${distances}</td>
    <td class="num">${price}</td>
    <td class="num">${r.results_n || NULL_CELL}</td>
    <td class="num">${degrees(normal?.temp_f ?? null)}</td>
    <td class="num">${degrees(normal?.dew_point_f ?? null)}</td>
    <td class="num">${normal?.heat_score ?? NULL_CELL}</td>
    <td>${r.lat === null ? NULL_CELL : "✓"}</td>
  </tr>`;
}

function statTr(s: TableStat): string {
  const latest = s.latest
    ? `<code>${esc(s.latest)}</code> · ${age(s.latest)}`
    : NULL_CELL;
  return `<tr><td><code>${s.name}</code></td><td class="num">${s.rows}</td><td>${latest}</td></tr>`;
}

function renderPage(): string {
  const stats: TableStat[] = statStmts.map(({ name, stmt }) => {
    const row = stmt.get() as { rows: number; latest: string | null };
    return { name, ...row };
  });
  const races = racesStmt.all() as DebugRaceRow[];
  const normals = new Map(
    (normalsStmt.all() as DebugNormal[]).map((n) => [
      `${n.geo_key}|${n.month_day}|${n.hour}`,
      n,
    ]),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>racedex /debug</title>
<style>
  body { font: 13px/1.5 system-ui, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0; }
  .meta { color: #666; margin: 4px 0 20px; }
  table { border-collapse: collapse; margin-bottom: 28px; }
  th, td { border: 1px solid #ddd; padding: 4px 10px; text-align: left; }
  th { background: #f4f4f4; position: sticky; top: 0; white-space: nowrap; }
  tbody tr:nth-child(even) { background: #fafafa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .null { color: #aaa; }
  code { font-size: 12px; }
  a { color: #0550ae; }
</style>
</head>
<body>
<h1>racedex /debug</h1>
<p class="meta">Pipeline DB as of ${new Date().toISOString()} — interim view, replaced by the real UI.</p>

<table>
  <thead><tr><th>table</th><th class="num">rows</th><th>freshest</th></tr></thead>
  <tbody>${stats.map(statTr).join("\n")}</tbody>
</table>

<table>
  <thead><tr>
    <th>id</th><th>name</th><th>where</th><th>next date</th>
    <th class="num">events</th><th>distances</th><th class="num">price</th>
    <th class="num">results</th><th class="num">temp</th>
    <th class="num">dew pt</th><th class="num">heat</th><th>geo</th>
  </tr></thead>
  <tbody>${races.map((r) => raceTr(r, normals)).join("\n")}</tbody>
</table>
</body>
</html>`;
}

export function debugPage(_req: Request, res: Response): void {
  res.type("html").send(renderPage());
}

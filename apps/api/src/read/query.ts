// The list query, built as text. No DB import on purpose: this is the module
// that decides what "the default list" means and how a filter compiles, so it
// has to be testable in CI, where racedex.db does not exist (it's gitignored,
// being rebuildable). Execution lives in races.ts.
//
// SQL is assembled per request rather than one giant prepared statement with
// `:param IS NULL OR ...` guards everywhere: those guards defeat the index on
// the very filter they're guarding, and they make the SQL unreadable. The
// distinct shapes are few and races.ts caches prepared statements by text.

import { bucketBySlug, type RaceListQuery, type RaceSort } from "@racedex/shared";

export type BindValue = string | number;

export type ListSql = {
  /** One page of races. */
  sql: string;
  /** Binds for sql. Named, so the shape self-documents in a test. */
  params: Record<string, BindValue>;
  /** Total matches — same FROM/WHERE, no projection, no paging. */
  countSql: string;
  /**
   * Binds for countSql. A strict subset: better-sqlite3 rejects a bound name
   * the statement never references, and the count query drops the SELECT-list
   * price subquery that `:now` otherwise lives in.
   */
  countParams: Record<string, BindValue>;
};

// Every race in the region runs on Eastern time (races.timezone defaults to it
// and the corpus is one metro), and price windows and start times from
// RunSignup are local wall-clock. Comparing them against a UTC "now" would put
// the cutover in the wrong place by 4-5 hours. 'sv-SE' formats as ISO, which
// is the cheapest way to get a local timestamp without a date library.
const METRO_TIMEZONE = "America/New_York";

/** Local `today` (YYYY-MM-DD) and `now` (to the minute) in the metro. */
export function metroNow(at: Date): { today: string; now: string } {
  const local = at.toLocaleString("sv-SE", { timeZone: METRO_TIMEZONE });
  return { today: local.slice(0, 10), now: `${local.slice(0, 10)}T${local.slice(11, 16)}` };
}

/** First day of the month after `month` ('2026-12' → '2027-01-01'). */
export function monthAfter(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(index + 1).padStart(2, "0")}-01`;
}

// first_start is the earliest event with a real gun time — the same rule
// /debug uses, and what the weather cell is keyed on. Computed in a CTE for
// all 182 races rather than per surviving row: it's one indexed lookup each,
// and inlining it would repeat the subquery in the SELECT list, the join and
// the ORDER BY.
const RACES_CTE = `
  WITH r AS (
    SELECT
      races.id, races.name, races.url, races.city, races.state,
      races.lat, races.lon, races.next_date, races.tags, races.competitiveness,
      (SELECT e.date || 'T' || e.start_time FROM events e
        WHERE e.race_id = races.id AND e.date IS NOT NULL
          AND e.start_time IS NOT NULL AND e.start_time != '00:00'
        ORDER BY e.date, e.start_time LIMIT 1) AS first_start
    FROM races
  )`;

// geo_key() is the pipeline's own function, registered on the connection —
// NOT printf('%.2f'). normals.ts states it is the only place the key is
// derived, so re-rounding floats here could disagree with the writer on an
// edge case and silently drop a race's weather.
const WEATHER_JOIN = `
  LEFT JOIN weather_normals wn
    ON wn.geo_key = geo_key(r.lat, r.lon)
   AND wn.month_day = substr(r.first_start, 6, 5)
   AND wn.hour = CAST(substr(r.first_start, 12, 2) AS INTEGER)`;

// Each sort's direction is baked in (see RACE_SORTS). NULLS LAST everywhere is
// the load-bearing part: competitiveness is NULL for 107 of 171 upcoming
// races, and those must sort after the scored ones rather than as a 0 — or,
// worse, vanish.
const SORT_ORDER: Record<RaceSort, string> = {
  date: "r.next_date ASC NULLS LAST",
  price: "price_from_cents ASC NULLS LAST",
  competitiveness: "r.competitiveness DESC NULLS LAST",
  heat: "wn.heat_score ASC NULLS LAST",
};

// Appended to every sort so a page boundary can't shuffle between requests.
const TIE_BREAK = "r.next_date ASC, r.name ASC, r.id ASC";

export function buildListSql(query: RaceListQuery, at: Date): ListSql {
  const { today, now } = metroNow(at);
  const where: string[] = [];
  // Binds are accumulated where their clause is, so the count query — which
  // has the WHERE but not the projection — gets exactly what it references.
  const params: Record<string, BindValue> = {};

  // THE band, inlined as a range on distance_m so the predicate stays
  // index-eligible. Never a bucket column on races: at 3.85 events per race a
  // race is not a distance, and Move for Hope belongs on 5k, 10k AND
  // half-marathon at once.
  const band = query.distance ? bucketBySlug(query.distance) : null;
  let matchesBand = "";
  if (band) {
    matchesBand = " AND e.distance_m BETWEEN :distLo AND :distHi";
    params.distLo = band.min;
    params.distHi = band.max;
  }

  // Cheapest entry a runner can still buy, over the events that matched.
  //   - `closes_at >= :now` drops expired tiers: 32 upcoming races would
  //     otherwise report an early-bird price that closed months ago (the
  //     Fort Lauderdale A1A 10K's $30 closed in Nov 2025).
  //   - It does NOT require the window to be open yet — 14 races have
  //     registration opening later, and "$40 from Oct 1" is a price, not a
  //     missing one.
  //   - Scoped to matched events, so ?distance=5k&maxPriceCents=2500 can't be
  //     answered by a race's $10 kids' dash while its 5K costs $45.
  const priceFrom = `(SELECT min(p.price_cents) FROM price_periods p
      JOIN events e ON e.id = p.event_id
     WHERE e.race_id = r.id${matchesBand} AND p.closes_at >= :now)`;

  if (!query.includePast) {
    where.push("r.next_date >= :today");
    params.today = today;
  }
  if (query.month) {
    // A range, not substr(next_date,1,7): only the range form can use
    // idx_races_next_date. Combines with the upcoming filter by intersection,
    // which is what makes ?month=<this month> mean "the rest of this month".
    where.push("r.next_date >= :monthStart AND r.next_date < :monthEnd");
    params.monthStart = `${query.month}-01`;
    params.monthEnd = monthAfter(query.month);
  }
  if (band) {
    where.push(`EXISTS (SELECT 1 FROM events e WHERE e.race_id = r.id${matchesBand})`);
  }
  // AND across tags: these are checkboxes in a filter panel, and ticking a
  // second box should narrow the list, not widen it.
  query.tags?.forEach((tag, i) => {
    where.push(`EXISTS (SELECT 1 FROM json_each(r.tags) j WHERE j.value = :tag${i})`);
    params[`tag${i}`] = tag;
  });
  if (query.exclude.length > 0) {
    const binds = query.exclude.map((tag, i) => {
      params[`ex${i}`] = tag;
      return `:ex${i}`;
    });
    where.push(
      `NOT EXISTS (SELECT 1 FROM json_each(r.tags) j WHERE j.value IN (${binds.join(", ")}))`,
    );
  }
  if (query.maxPriceCents !== undefined) {
    where.push(`${priceFrom} <= :maxPriceCents`);
    params.maxPriceCents = query.maxPriceCents;
    params.now = now;
  }
  if (query.maxHeat !== undefined) {
    // Excludes the 8 races with no gun time to key a normal on. Asking for a
    // cool morning is asking about a known one.
    where.push("wn.heat_score <= :maxHeat");
    params.maxHeat = query.maxHeat;
  }
  if (query.minCompetitiveness !== undefined) {
    // Necessarily drops every unscored race. That's the honest reading, and
    // the reason there is no default floor.
    where.push("r.competitiveness >= :minCompetitiveness");
    params.minCompetitiveness = query.minCompetitiveness;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join("\n     AND ")}` : "";

  const sql = `${RACES_CTE}
  SELECT
    r.id, r.name, r.url, r.city, r.state, r.lat, r.lon, r.next_date,
    r.tags, r.competitiveness, r.first_start,
    (SELECT group_concat(DISTINCT e.distance_m) FROM events e
      WHERE e.race_id = r.id${matchesBand}) AS matched_distances,
    ${priceFrom} AS price_from_cents,
    wn.heat_score, wn.temp_f, wn.dew_point_f
  FROM r${WEATHER_JOIN}
  ${whereSql}
  ORDER BY ${SORT_ORDER[query.sort]}, ${TIE_BREAK}
  LIMIT :limit OFFSET :offset`;

  // Counted separately rather than with COUNT(*) OVER (), which would be one
  // round trip but reports 0 when an offset lands past the end — exactly when
  // a paginating UI most needs the real total.
  const countSql = `${RACES_CTE}
  SELECT COUNT(*) AS total
  FROM r${WEATHER_JOIN}
  ${whereSql}`;

  return {
    sql,
    params: { ...params, now, limit: query.limit, offset: query.offset },
    countSql,
    countParams: params,
  };
}

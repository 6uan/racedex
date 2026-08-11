import test from "node:test";
import assert from "node:assert/strict";
import { RaceListQuerySchema, type RaceListQuery } from "@racedex/shared";
import { buildListSql, metroNow, monthAfter } from "./query";

// A fixed instant so the date-dependent assertions below are about the query
// builder, not about when the suite ran. 14:23 UTC is 10:23 in the metro.
const AT = new Date("2026-08-11T14:23:00Z");

function build(raw: Record<string, string> = {}) {
  return buildListSql(RaceListQuerySchema.parse(raw), AT);
}

// Whitespace in the generated SQL is presentational; these assertions are
// about which predicates are present, not how they're laid out.
function flat(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

test("today is the metro's today, not UTC's", () => {
  // Eastern time is what RunSignup's start times and price windows are in, so
  // a UTC cutover would move the boundary by four hours. 00:30 UTC on the 12th
  // is still the 11th at the start line.
  assert.deepEqual(metroNow(new Date("2026-08-12T00:30:00Z")), {
    today: "2026-08-11",
    now: "2026-08-11T20:30",
  });
});

test("the default list asks only for upcoming races that are runs", () => {
  const { countSql, countParams } = build();
  assert.match(flat(countSql), /r\.next_date >= :today/);
  assert.match(
    flat(countSql),
    /NOT EXISTS \(SELECT 1 FROM json_each\(r\.tags\) j WHERE j\.value IN \(:ex0\)\)/,
  );
  assert.deepEqual(countParams, { today: "2026-08-11", ex0: "not_a_run" });
});

test("a caller can turn each default filter off independently", () => {
  assert.doesNotMatch(flat(build({ includePast: "true" }).sql), /next_date >= :today/);
  assert.doesNotMatch(flat(build({ exclude: "" }).sql), /NOT EXISTS/);

  // With both off nothing filters, so the count query binds nothing at all.
  const wideOpen = build({ includePast: "true", exclude: "" });
  assert.deepEqual(wideOpen.countParams, {});
});

test("filtering by distance stays an EXISTS over events with the band inlined", () => {
  // Never a bucket column on races: at 3.85 events per race a race is not a
  // distance, and the 111-event Move for Hope belongs on 5k, 10k and
  // half-marathon at once. The band is a range so the predicate stays
  // index-eligible.
  const { sql, params } = build({ distance: "5k" });
  assert.match(
    flat(sql),
    /EXISTS \(SELECT 1 FROM events e WHERE e\.race_id = r\.id AND e\.distance_m BETWEEN :distLo AND :distHi\)/,
  );
  assert.equal(params.distLo, 4800);
  assert.equal(params.distHi, 5200);
  assert.doesNotMatch(sql, /r\.distance/);
  assert.doesNotMatch(sql, /r\.bucket/);
});

test("a distance filter narrows the price to the events that matched", () => {
  // ?distance=5k&maxPriceCents=2500 must not be answered by a race's $10
  // kids' dash while its 5K costs $45.
  const filtered = flat(build({ distance: "5k", maxPriceCents: "2500" }).sql);
  const priceOverMatched =
    /min\(p\.price_cents\).*?WHERE e\.race_id = r\.id AND e\.distance_m BETWEEN :distLo AND :distHi AND p\.closes_at >= :now/;
  assert.match(priceOverMatched.exec(filtered)?.[0] ?? "", priceOverMatched);

  // Both the shown price and the filtered one — the SELECT list and the WHERE.
  assert.equal(filtered.match(/min\(p\.price_cents\)/g)?.length, 2);
});

test("a price ceiling ignores tiers that have already closed", () => {
  // The Fort Lauderdale A1A 10K has ten tiers from $30 to $70; its $30 closed
  // in Nov 2025. A naive MIN over all periods reports an expired price for 32
  // upcoming races.
  const { sql, params } = build({ maxPriceCents: "3500" });
  assert.match(flat(sql), /p\.closes_at >= :now/);
  assert.equal(params.now, "2026-08-11T10:23");
  assert.equal(params.maxPriceCents, 3500);
});

test("a price ceiling still counts registration that has not opened yet", () => {
  // 14 upcoming races open later — Girls on the Run Miami 5K is $40 from Oct 1.
  // "$40 from Oct 1" is a price, so the window is not required to be live.
  assert.doesNotMatch(flat(build({ maxPriceCents: "5000" }).sql), /opens_at/);
});

test("unscored races keep their place in a competitiveness sort", () => {
  // NULL for 107 of 171 upcoming races — the majority case. It must not sort
  // as 0 and must not vanish.
  const { sql } = build({ sort: "competitiveness" });
  assert.match(flat(sql), /ORDER BY r\.competitiveness DESC NULLS LAST/);
  // Not coalesced to 0, and sorting on it never adds a filter on it.
  assert.doesNotMatch(sql, /COALESCE\(r\.competitiveness/);
  assert.doesNotMatch(sql, /r\.competitiveness >=/);
});

test("asking for a minimum score is the only thing that drops unscored races", () => {
  const { sql, params } = build({ minCompetitiveness: "50" });
  assert.match(flat(sql), /r\.competitiveness >= :minCompetitiveness/);
  assert.equal(params.minCompetitiveness, 50);
});

test("every sort ends in the same tie-break so pages do not shuffle", () => {
  for (const sort of ["date", "price", "competitiveness", "heat"] as const) {
    const { sql } = build({ sort });
    assert.match(
      flat(sql),
      /ORDER BY .*r\.next_date ASC, r\.name ASC, r\.id ASC LIMIT :limit OFFSET :offset$/,
      sort,
    );
    // Coolest, cheapest, most competitive, soonest — each direction baked in.
    assert.match(flat(sql), /NULLS LAST/, sort);
  }
});

test("heat sorts coolest first and filters out races with no known heat", () => {
  assert.match(flat(build({ sort: "heat" }).sql), /ORDER BY wn\.heat_score ASC NULLS LAST/);
  assert.match(flat(build({ maxHeat: "3" }).sql), /wn\.heat_score <= :maxHeat/);
});

test("the weather join derives its key with the pipeline's own function", () => {
  // normals.ts is explicit that geoKey() is the only place the grid key is
  // derived; re-rounding with printf here could disagree on a float edge case
  // and silently drop a race's weather.
  const { sql } = build();
  assert.match(flat(sql), /wn\.geo_key = geo_key\(r\.lat, r\.lon\)/);
  assert.doesNotMatch(sql, /printf/);
});

test("a month compiles to a date range, not a substring", () => {
  // Only the range form can use idx_races_next_date.
  const { params, countSql } = build({ month: "2026-11" });
  assert.match(flat(countSql), /r\.next_date >= :monthStart AND r\.next_date < :monthEnd/);
  assert.doesNotMatch(countSql, /substr\(r\.next_date/);
  assert.equal(params.monthStart, "2026-11-01");
  assert.equal(params.monthEnd, "2026-12-01");
});

test("the current month means the rest of it, not all of it", () => {
  // Both predicates survive, and their intersection starts today.
  const { countParams } = build({ month: "2026-08" });
  assert.equal(countParams.monthStart, "2026-08-01");
  assert.equal(countParams.today, "2026-08-11");
});

test("December rolls into the next year", () => {
  assert.equal(monthAfter("2026-12"), "2027-01-01");
  assert.equal(monthAfter("2026-09"), "2026-10-01");
});

test("ticking a second tag narrows the list rather than widening it", () => {
  const { sql, params } = build({ tags: "trail,competitive" });
  const clauses = flat(sql).match(
    /EXISTS \(SELECT 1 FROM json_each\(r\.tags\) j WHERE j\.value = :tag\d\)/g,
  );
  assert.equal(clauses?.length, 2);
  assert.doesNotMatch(flat(sql), /j\.value = :tag0 OR/);
  assert.equal(params.tag0, "trail");
  assert.equal(params.tag1, "competitive");
});

test("excluding every tag binds each one separately", () => {
  // Eleven-plus exclusions are legal, and :ex1 must not be confused with :ex10.
  const all = "road,trail,track,holiday,charity,themed,kids,relay,obstacle,competitive,fun_run,virtual";
  const { countParams } = build({ exclude: all });
  assert.equal(Object.keys(countParams).length, 13); // 12 tags + today
  assert.equal(countParams.ex11, "virtual");
});

test("the count query binds only what its WHERE references", () => {
  // better-sqlite3 rejects a bound name the statement never mentions, and the
  // count query drops the SELECT-list price subquery that :now lives in.
  const { countSql, countParams, params } = build({ distance: "5k" });
  for (const key of Object.keys(countParams)) {
    assert.ok(countSql.includes(`:${key}`), `countSql never uses :${key}`);
  }
  assert.ok(!("now" in countParams));
  assert.ok(!("limit" in countParams));
  assert.equal(params.limit, 50);
  assert.equal(params.offset, 0);
});

test("the page query binds every name it uses", () => {
  const every: RaceListQuery = RaceListQuerySchema.parse({
    month: "2026-11",
    distance: "half-marathon",
    maxPriceCents: "9000",
    maxHeat: "4",
    tags: "road",
    exclude: "not_a_run,series",
    minCompetitiveness: "30",
    sort: "price",
    limit: "10",
    offset: "20",
  });
  const { sql, params } = buildListSql(every, AT);
  for (const name of new Set(sql.match(/:[a-zA-Z]\w*/g))) {
    assert.ok(name.slice(1) in params, `${name} is not bound`);
  }
});

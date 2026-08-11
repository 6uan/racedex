import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDistances,
  toCompetitivenessInputs,
  toEvents,
  toListItem,
  toWeather,
} from "./map";
import type { ListRow } from "./rows";

// Every row below is real: the values come from the first South Florida
// ingest, so what these assert is what the endpoint actually returns.

// AVDA's 27th Annual Race for Hope — runsignup:10519, Lake Worth, score 40.
// The stable-id pattern: one race row carrying 2023-2025 results.
const AVDA: ListRow = {
  id: "runsignup:10519",
  name: "AVDA's 27th Annual Race for Hope",
  url: "https://runsignup.com/Race/FL/LakeWorth/AVDARaceforHope",
  city: "Lake Worth",
  state: "FL",
  lat: 26.6153,
  lon: -80.0937,
  next_date: "2026-11-14",
  tags: '["road","charity","kids","competitive","virtual"]',
  competitiveness: 40,
  first_start: "2026-11-14T07:30",
  matched_distances: "5000,1609",
  price_from_cents: 2000,
  heat_score: 4,
  temp_f: 74.15,
  dew_point_f: 68.35,
};

test("a race carries the distances that matched the filter", () => {
  // The response-shape half of the distance filter: filter to 5k, get "Miami
  // Marathon Weekend", and without this line the filter looks broken.
  assert.deepEqual(toListItem(AVDA).distances, [
    { meters: 1609, bucket: "mile", label: "1mi" },
    { meters: 5000, bucket: "5k", label: "5K" },
  ]);
});

test("a race with three 5K entries prints one 5K", () => {
  // Bagel Run sells "5K Registration", "5K/10K/13.1 Eco-Registration" and
  // "Virtual Run Registration (5K/10K/13.1)" — three events, 5000m each.
  assert.deepEqual(parseDistances("5000,5000,5000").map((d) => d.label), ["5K"]);
});

test("distances read shortest first, whatever order SQL produced", () => {
  // group_concat's order is whatever the scan gave; a runner reads 5K → 10K → Half.
  const labels = parseDistances("21097,5000,10000,1609").map((d) => d.label);
  assert.deepEqual(labels, ["1mi", "5K", "10K", "Half"]);
});

test("a distance outside every running band is still printable", () => {
  // The 8690m "5.4 Funky Run" and the 51338m Olympic Triathlon land in no
  // bucket, but a race card still has to say something.
  assert.deepEqual(parseDistances("8690"), [
    { meters: 8690, bucket: null, label: "8.7K" },
  ]);
  assert.equal(parseDistances("51338")[0]?.bucket, null);
});

test("a race whose events never parsed shows no distances", () => {
  // 63 events have a null distance_m — stair climbs, curling, a plane pull.
  // group_concat drops them, leaving an empty column rather than a zero.
  assert.deepEqual(parseDistances(null), []);
  assert.deepEqual(parseDistances(""), []);
});

test("a race exposes its canonical URL, not just its upstream listing", () => {
  const item = toListItem(AVDA);
  // Apostrophes fold away without leaving a separator: "AVDA's" → "avdas".
  assert.equal(item.url, "/south-florida/avdas-27th-annual-race-for-hope-10519");
  assert.equal(item.sourceUrl, "https://runsignup.com/Race/FL/LakeWorth/AVDARaceforHope");
  // The natural key, not a rowid — it survives a full pipeline rebuild.
  assert.equal(item.id, "runsignup:10519");
});

test("the start time comes off the first real gun time", () => {
  assert.equal(toListItem(AVDA).startTime, "07:30");
  assert.equal(toListItem({ ...AVDA, first_start: null }).startTime, null);
});

test("an unscored race reports null, never zero", () => {
  // 116 of 182 races publish no results at all. The distinction matters: 0 is
  // a real score (three races have it), null is "we don't know".
  const unscored = toListItem({ ...AVDA, competitiveness: null });
  assert.equal(unscored.competitiveness, null);
  assert.notEqual(unscored.competitiveness, 0);
  assert.equal(toListItem({ ...AVDA, competitiveness: 0 }).competitiveness, 0);
});

test("a race with no weather cell has no heat panel at all", () => {
  // 8 races publish no gun time to key a normal on. An object of nulls would
  // render as an empty panel; null renders as no panel.
  assert.equal(toListItem({ ...AVDA, heat_score: null, temp_f: null, dew_point_f: null }).heat, null);
  assert.deepEqual(toListItem(AVDA).heat, { score: 4, tempF: 74.15, dewPointF: 68.35 });
});

test("a hand-edited tag column cannot put junk on the UI's closed union", () => {
  assert.deepEqual(toListItem({ ...AVDA, tags: '["road","not-a-real-tag"]' }).tags, ["road"]);
  assert.deepEqual(toListItem({ ...AVDA, tags: "not json at all" }).tags, []);
  assert.deepEqual(toListItem({ ...AVDA, tags: null }).tags, []);
});

test("an event carries its whole price timeline", () => {
  // The Fort Lauderdale A1A 10K climbs $30 → $70 across ten windows, with a
  // $40 flash sale in June. A single "price" field would lose all of it.
  const events = toEvents(
    [
      {
        id: "runsignup:1159830",
        name: "Fort Lauderdale A1A 10K",
        distance_m: 10000,
        date: "2026-11-08",
        start_time: "06:00",
      },
    ],
    [
      {
        event_id: "runsignup:1159830",
        price_cents: 3000,
        opens_at: "2025-11-10T00:00",
        closes_at: "2025-11-16T23:59",
      },
      {
        event_id: "runsignup:1159830",
        price_cents: 7000,
        opens_at: "2026-11-08T00:00",
        closes_at: "2026-11-08T07:00",
      },
    ],
  );
  assert.equal(events[0]?.bucket, "10k");
  assert.equal(events[0]?.label, "10K");
  assert.deepEqual(events[0]?.prices.map((p) => p.cents), [3000, 7000]);
});

test("an event with no parsed distance still appears on the detail page", () => {
  const [event] = toEvents(
    [
      {
        id: "runsignup:1",
        name: "Kids Fun Run",
        distance_m: null,
        date: "2026-11-14",
        start_time: "09:00",
      },
    ],
    [],
  );
  assert.equal(event?.distanceM, null);
  assert.equal(event?.bucket, null);
  assert.equal(event?.label, null);
  assert.deepEqual(event?.prices, []);
});

test("the weather panel marks the hour the race actually starts", () => {
  const hours = [6, 7, 8].map((hour) => ({
    geo_key: "26.62,-80.09",
    month_day: "11-14",
    hour,
    temp_f: 74.6,
    dew_point_f: 67.85,
    humidity_pct: 82,
    heat_score: 4,
    years_sampled: 10,
  }));
  const panel = toWeather("2026-11-14T07:30", hours);
  assert.equal(panel?.startHour, 7);
  assert.equal(panel?.geoKey, "26.62,-80.09");
  assert.equal(panel?.monthDay, "11-14");
  assert.equal(panel?.yearsSampled, 10);
  assert.equal(panel?.hours.length, 3);
});

test("a race outside every weather cell has no panel", () => {
  assert.equal(toWeather("2026-11-14T07:30", []), null);
  assert.equal(toWeather(null, []), null);
});

test("the score's inputs cross the wire with it", () => {
  // PLAN.md: a bare 40 is not something a runner should have to trust blind.
  const inputs = toCompetitivenessInputs(
    JSON.stringify({
      version: 1,
      scored_at: "2026-08-09T05:12:03.114Z",
      years: [2023, 2024, 2025],
      event_name: "5K Run/Walk",
      field_size: 215,
      distance_m: 5000,
      winner_seconds: 1127,
      median_seconds: 2367,
      benchmark_seconds: 900,
      components: { field: 66, pace: 12, depth: 40 },
      weights: { field: 0.4, pace: 0.35, depth: 0.25 },
    }),
  );
  assert.equal(inputs?.fieldSize, 215);
  assert.equal(inputs?.scoredAt, "2026-08-09T05:12:03.114Z");
  assert.deepEqual(inputs?.years, [2023, 2024, 2025]);
  assert.deepEqual(inputs?.components, { field: 66, pace: 12, depth: 40 });
});

test("a race with no stored inputs reports none rather than failing", () => {
  assert.equal(toCompetitivenessInputs(null), null);
  assert.equal(toCompetitivenessInputs("{truncated"), null);
});

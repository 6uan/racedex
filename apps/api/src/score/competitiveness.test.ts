import test from "node:test";
import assert from "node:assert/strict";
import {
  benchmarkSeconds,
  primaryEvent,
  scoreRace,
  type ResultRow,
} from "./competitiveness";

const result = (row: Partial<ResultRow>): ResultRow => ({
  year: 2025,
  event_name: "5K Run",
  distance_m: 5000,
  finishers: 100,
  winner_seconds: 1000,
  median_seconds: 2000,
  ...row,
});

test("benchmarkSeconds scales the 15:00 5K by Riegel", () => {
  assert.equal(Math.round(benchmarkSeconds(5000)), 900);
  assert.equal(Math.round(benchmarkSeconds(10000)), 1876); // 31:16
  assert.equal(Math.round(benchmarkSeconds(21097)), 4140); // 1:09:00
  assert.equal(Math.round(benchmarkSeconds(42195)), 8632); // 2:23:52
});

// Every component present, from the real dataset's flagship field: a 1,822
// finisher turkey trot with a 16:29 winner and a 34:43 median.
test("scoreRace weights all three components when available", () => {
  const result = scoreRace({
    fieldSize: 1822,
    distanceM: 5000,
    winnerSeconds: 989,
    medianSeconds: 2083,
  });
  assert.ok(result);
  assert.deepEqual(result.components, { field: 93, pace: 78, depth: 45 });
  assert.equal(result.benchmarkSeconds, 900);
  // 0.4*93.1 + 0.35*77.5 + 0.25*44.9, weights summing to 1
  assert.equal(result.score, 76);
});

test("field size is log-scaled between 25 and 2500 finishers", () => {
  const at = (fieldSize: number) =>
    scoreRace({
      fieldSize,
      distanceM: null,
      winnerSeconds: null,
      medianSeconds: null,
    })?.components.field;
  assert.equal(at(25), 0);
  assert.equal(at(10), 0); // clamped, not negative
  assert.equal(at(250), 50); // log-midpoint
  assert.equal(at(2500), 100);
  assert.equal(at(5000), 100); // clamped
});

test("pace is graded against the distance benchmark", () => {
  const at = (distanceM: number, winnerSeconds: number) =>
    scoreRace({
      fieldSize: null,
      distanceM,
      winnerSeconds,
      medianSeconds: null,
    })?.components.pace;
  assert.equal(at(5000, 900), 100); // hits the benchmark
  assert.equal(at(5000, 1500), 0); // 25:00 5K — the floor
  assert.equal(at(5000, 1800), 0); // clamped, not negative
  assert.equal(at(10000, 1876), 100); // benchmark scales with distance
  assert.equal(at(21097, 4140), 100);
});

test("pace is skipped where the benchmark would be fiction", () => {
  const at = (distanceM: number | null, winnerSeconds: number) =>
    scoreRace({
      fieldSize: 100,
      distanceM,
      winnerSeconds,
      medianSeconds: null,
    })?.components.pace;
  assert.equal(at(null, 900), null); // triathlon: distance never parsed
  assert.equal(at(160934, 30000), null); // 100-miler: Riegel doesn't reach
  assert.equal(at(800, 200), null); // below the band
  assert.equal(at(5000, 232), null); // virtual "5K" logged at 3:52 — junk
  assert.equal(at(25347, 3915), null); // sprint tri: swim+bike+run summed
  assert.equal(at(1609, 765), null); // youth triathlon parsed as a 1-mile race
  assert.equal(at(5000, 867), 100); // a real 14:27 5K winner still scores
  assert.equal(at(5000, 2251), null); // 37:31 "winner": the distance is wrong
  assert.equal(at(5000, 2250), 0); // exactly 0.4x — inside the band, scored 0
});

test("depth grades the median finisher against the winner", () => {
  // fieldSize keeps a result alive even when depth itself comes back null.
  const at = (winnerSeconds: number, medianSeconds: number, fieldSize = 100) =>
    scoreRace({
      fieldSize,
      distanceM: null,
      winnerSeconds,
      medianSeconds,
    })?.components.depth;
  assert.equal(at(1000, 1500), 100); // 1.5x — everyone is racing
  assert.equal(at(1000, 1400), 100); // clamped
  assert.equal(at(1000, 2050), 50);
  assert.equal(at(1000, 2600), 0); // 2.6x — stroller parade
  assert.equal(at(1000, 5000), 0); // clamped
  assert.equal(at(1000, 900), null); // median faster than the winner: junk
  assert.equal(at(1000, 1500, 10), 100); // the smallest field a median means
  assert.equal(at(1000, 1500, 9), null); // below it, one person moves the median
  assert.equal(at(1000, 1000, 1), null); // a field of one: median IS the winner
});

test("missing components renormalize instead of scoring zero", () => {
  // Field only (a triathlon: no parsed distance, no usable pace or depth).
  const fieldOnly = scoreRace({
    fieldSize: 250,
    distanceM: null,
    winnerSeconds: null,
    medianSeconds: null,
  });
  assert.deepEqual(fieldOnly?.components, { field: 50, pace: null, depth: null });
  assert.equal(fieldOnly?.score, 50); // not 50 * 0.4

  // Field + depth, no parsed distance (a triathlon): pace drops out.
  const noDistance = scoreRace({
    fieldSize: 250,
    distanceM: null,
    winnerSeconds: 1000,
    medianSeconds: 2050,
  });
  assert.deepEqual(noDistance?.components, { field: 50, pace: null, depth: 50 });
  assert.equal(noDistance?.score, 50); // 0.4 and 0.25 renormalized to 0.65

  // No field size at all: depth can't be trusted without one either, so the
  // benchmark winner is the only thing left standing.
  const noField = scoreRace({
    fieldSize: null,
    distanceM: 5000,
    winnerSeconds: 900,
    medianSeconds: 1350,
  });
  assert.deepEqual(noField?.components, { field: null, pace: 100, depth: null });
  assert.equal(noField?.score, 100);
});

test("scoreRace returns null when nothing is usable", () => {
  assert.equal(
    scoreRace({
      fieldSize: 0,
      distanceM: null,
      winnerSeconds: null,
      medianSeconds: null,
    }),
    null,
  );
});

test("primaryEvent picks the race's biggest event, not its first", () => {
  const event = primaryEvent([
    result({ year: 2025, distance_m: 5000, finishers: 800 }),
    result({ year: 2025, distance_m: 10000, finishers: 200, event_name: "10K" }),
    result({ year: 2024, distance_m: 5000, finishers: 600 }),
    result({ year: 2024, distance_m: 10000, finishers: 150, event_name: "10K" }),
  ]);
  assert.equal(event?.distanceM, 5000);
  assert.equal(event?.fieldSize, 700); // median of the 5K's two years
  assert.deepEqual(event?.years, [2024, 2025]);
});

test("primaryEvent groups by distance across years, name when unparsed", () => {
  // A triathlon and a duathlon both parse to NULL distance; blending them
  // would invent an event that never happened.
  const event = primaryEvent([
    result({ distance_m: null, event_name: "Sprint Triathlon", finishers: 220 }),
    result({
      year: 2024,
      distance_m: null,
      event_name: "Sprint Triathlon",
      finishers: 140,
    }),
    result({ distance_m: null, event_name: "Sprint Duathlon", finishers: 70 }),
  ]);
  assert.equal(event?.eventName, "Sprint Triathlon");
  assert.equal(event?.fieldSize, 180);
});

test("primaryEvent takes distance and name from the latest edition", () => {
  const event = primaryEvent([
    result({ year: 2023, event_name: "The 5K", winner_seconds: 1100 }),
    result({ year: 2025, event_name: "The 5K presented by a sponsor" }),
  ]);
  assert.equal(event?.eventName, "The 5K presented by a sponsor");
  assert.equal(event?.winnerSeconds, 1050); // median of both years
});

test("primaryEvent survives rows with missing numbers", () => {
  const event = primaryEvent([
    result({ finishers: null, winner_seconds: null, median_seconds: null }),
  ]);
  assert.deepEqual(event, {
    fieldSize: null,
    distanceM: 5000,
    winnerSeconds: null,
    medianSeconds: null,
    years: [2025],
    eventName: "5K Run",
  });
  assert.equal(scoreRace(event!), null); // nothing usable → the NULL state
});

test("primaryEvent returns null for no rows", () => {
  assert.equal(primaryEvent([]), null);
});

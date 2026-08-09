import test from "node:test";
import assert from "node:assert/strict";
import { geoKey, heatScore, sampleDates } from "./normals";

test("geoKey", () => {
  assert.equal(geoKey(25.7867, -80.18), "25.79,-80.18");
  assert.equal(geoKey(26.1793, -80.2746), "26.18,-80.27");
  assert.equal(geoKey(25.7, -80.2), "25.70,-80.20");
  assert.equal(geoKey(-0.001, 0.001), "0.00,0.00");
});

test("sampleDates", () => {
  assert.deepEqual(sampleDates("10-17", 2026, 3), [
    "2023-10-17",
    "2024-10-17",
    "2025-10-17",
  ]);
  assert.equal(sampleDates("10-17", 2026).length, 10);
  assert.equal(sampleDates("10-17", 2026)[0], "2016-10-17");
  // Feb 29 exists only in leap years — the window shrinks honestly.
  assert.deepEqual(sampleDates("02-29", 2026, 6), [
    "2020-02-29",
    "2024-02-29",
  ]);
});

test("heatScore", () => {
  assert.equal(heatScore(null), null);
  assert.equal(heatScore(48), 1);
  assert.equal(heatScore(55), 1);
  assert.equal(heatScore(55.1), 2);
  assert.equal(heatScore(60), 2);
  assert.equal(heatScore(65), 3);
  assert.equal(heatScore(67.6), 4);
  assert.equal(heatScore(70.1), 5);
  assert.equal(heatScore(78), 5);
});
